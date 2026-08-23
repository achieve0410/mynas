import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeArchive } from "./archive";
import { collectSlackArchive, withQuiescedWriters } from "./collector";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Slack snapshot collector", () => {
  test("collects MySQL first and approved roots in stable path order", async () => {
    const root = await mkdtemp(join(tmpdir(), "slack-snapshot-collector-"));
    temporaryPaths.push(root);
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "z.json"), "z");
    await writeFile(join(root, "nested", "a.json"), "a");
    await writeFile(join(root, "mysql.env"), "MYSQL_PASSWORD=secret");
    await symlink(join(root, "z.json"), join(root, "linked.json"));
    const restored = new Map<string, Uint8Array[]>();

    await decodeArchive(
      collectSlackArchive({
        mysqlDump: (async function* () {
          yield encoder.encode("logical mysql dump");
        })(),
        files: [{ archivePath: "secrets/mysql.env", path: join(root, "mysql.env") }],
        roots: [{ archivePrefix: "platform-artifacts", root }],
      }),
      {
        end: async () => undefined,
        start: async ({ path }) => {
          restored.set(path, []);
        },
        write: async (part) => {
          [...restored.values()].at(-1)?.push(part);
        },
      },
    );

    expect([...restored.keys()]).toEqual([
      "database/mysql.sql",
      "secrets/mysql.env",
      "platform-artifacts/mysql.env",
      "platform-artifacts/nested/a.json",
      "platform-artifacts/z.json",
    ]);
    expect(decoder.decode(Buffer.concat(restored.get("database/mysql.sql") ?? []))).toBe(
      "logical mysql dump",
    );
  });

  test("always resumes writers after a quiesced operation fails", async () => {
    const events: string[] = [];

    await expect(
      withQuiescedWriters(
        async () => {
          events.push("stop");
        },
        async () => {
          events.push("start");
        },
        async () => {
          events.push("collect");
          throw new Error("collection failed");
        },
      ),
    ).rejects.toThrow("collection failed");

    expect(events).toEqual(["stop", "collect", "start"]);
  });
});
