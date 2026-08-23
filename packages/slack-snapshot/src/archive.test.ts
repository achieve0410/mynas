import { describe, expect, test } from "bun:test";

import { decodeArchive, encodeArchive, type SnapshotArchiveRecord } from "./archive";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const contents = async function* (...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield encoder.encode(value);
  }
};

describe("Slack snapshot logical archive", () => {
  test("round-trips split record streams without needing sizes up front", async () => {
    const records: readonly SnapshotArchiveRecord[] = [
      {
        contents: contents("CREATE ", "TABLE;\n"),
        mode: 0o600,
        path: "database/mysql.sql",
      },
      {
        contents: contents("artifact"),
        mode: 0o640,
        path: "platform-artifacts/report.json",
      },
    ];
    const restored = new Map<string, { mode: number; parts: Uint8Array[] }>();

    await decodeArchive(encodeArchive(records), {
      end: async () => undefined,
      start: async ({ mode, path }) => {
        restored.set(path, { mode, parts: [] });
      },
      write: async (part) => {
        const current = [...restored.values()].at(-1);
        if (current === undefined) {
          throw new Error("record was not started");
        }
        current.parts.push(part);
      },
    });

    expect(
      [...restored.entries()].map(([path, value]) => ({
        contents: decoder.decode(Buffer.concat(value.parts)),
        mode: value.mode,
        path,
      })),
    ).toEqual([
      { contents: "CREATE TABLE;\n", mode: 0o600, path: "database/mysql.sql" },
      {
        contents: "artifact",
        mode: 0o640,
        path: "platform-artifacts/report.json",
      },
    ]);
  });

  test("rejects unsafe archive paths before emitting plaintext", async () => {
    for (const path of ["/absolute", "../escape", "safe/../../escape", ""]) {
      const record: SnapshotArchiveRecord = {
        contents: contents("secret"),
        mode: 0o600,
        path,
      };
      const iterator = encodeArchive([record])[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow("path");
    }
  });
});
