import { join } from "node:path";
import type { Command } from "commander";
import { z } from "zod";

import { parseCanonicalManifest, sha256 } from "../../../packages/snapshots/src/manifest";
import { SnapshotError, snapshotBundleSchema } from "../../../packages/snapshots/src/models";
import type { CliDependencies } from "./cli";
import { request, writeJson } from "./commands";

const snapshotIdSchema = z.uuid();
const snapshotListSchema = z.array(snapshotBundleSchema);

const requiredFilesystem = (
  dependencies: CliDependencies,
): {
  readonly mkdir: (path: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
} => {
  if (
    dependencies.mkdir === undefined ||
    dependencies.remove === undefined ||
    dependencies.rename === undefined
  ) {
    throw new Error("snapshot filesystem dependencies are unavailable");
  }
  return {
    mkdir: dependencies.mkdir,
    remove: dependencies.remove,
    rename: dependencies.rename,
  };
};

const responseBytes = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

const downloadSnapshot = async (
  dependencies: CliDependencies,
  idValue: string,
  destination: string,
): Promise<void> => {
  const id = snapshotIdSchema.parse(idValue);
  const filesystem = requiredFilesystem(dependencies);
  const staging = `${destination}.partial-${crypto.randomUUID()}`;
  await filesystem.mkdir(join(staging, "chunks"));
  try {
    const manifestBytes = await responseBytes(
      await request(dependencies, `/api/v1/snapshot-bundles/${id}/manifest`),
    );
    const manifest = parseCanonicalManifest(manifestBytes);
    if (manifest.bundleId !== id) {
      throw new SnapshotError("invalid", "downloaded manifest bundle id does not match");
    }
    const signature = await responseBytes(
      await request(dependencies, `/api/v1/snapshot-bundles/${id}/signature`),
    );
    if (signature.byteLength !== 64) {
      throw new SnapshotError("invalid", "downloaded signature must be 64 bytes");
    }
    for (const chunk of manifest.chunks) {
      const contents = await responseBytes(
        await request(dependencies, `/api/v1/snapshot-bundles/${id}/chunks/${chunk.index}`),
      );
      if (contents.byteLength !== chunk.size || sha256(contents) !== chunk.checksum) {
        throw new SnapshotError("invalid", `snapshot chunk ${chunk.index} checksum mismatch`);
      }
      await dependencies.writeFile(
        join(staging, "chunks", `${String(chunk.index).padStart(8, "0")}.bin`),
        contents,
      );
    }
    await dependencies.writeFile(join(staging, "manifest.sig"), signature);
    await dependencies.writeFile(join(staging, "manifest.json"), manifestBytes);
    await filesystem.rename(staging, destination);
  } catch (error) {
    await filesystem.remove(staging);
    throw error;
  }
};

export const registerSnapshotCommands = (program: Command, dependencies: CliDependencies): void => {
  const snapshot = program.command("snapshot").description("manage verified snapshot bundles");

  snapshot.command("list").action(async () => {
    const response = await request(dependencies, "/api/v1/snapshot-bundles");
    writeJson(dependencies, snapshotListSchema.parse(await response.json()));
  });

  snapshot
    .command("download")
    .argument("<id>")
    .argument("<directory>")
    .action(async (id: string, directory: string) => downloadSnapshot(dependencies, id, directory));

  snapshot
    .command("delete")
    .argument("<id>")
    .action(async (idValue: string) => {
      const id = snapshotIdSchema.parse(idValue);
      await request(dependencies, `/api/v1/snapshot-bundles/${id}`, { method: "DELETE" });
      writeJson(dependencies, { deleted: id });
    });
};
