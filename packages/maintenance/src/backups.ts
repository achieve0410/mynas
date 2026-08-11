import { constants } from "node:fs";
import { mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { isPhysicalPathOutside } from "./paths";

const timestamp = (date: Date): string =>
  date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");

export class ManagedBackupStore {
  public constructor(
    private readonly dataDir: string,
    private readonly ownerId: string,
  ) {}

  public outputPath(directory: string, now: Date): string {
    return resolve(
      directory,
      `mynas-auto-${this.ownerId}-${timestamp(now)}-${crypto.randomUUID()}.sqlite`,
    );
  }

  public async prepare(
    directory: string,
    destinationId: string,
    createMarker: boolean,
  ): Promise<void> {
    this.assertOutside(directory);
    if (createMarker) {
      await mkdir(directory, { mode: 0o700, recursive: true });
    }
    this.assertOutside(directory);
    await this.verifyMarker(directory, destinationId, createMarker);
  }

  public async prune(
    directory: string,
    retentionCount: number,
    currentPath: string,
  ): Promise<number> {
    const pattern = new RegExp(
      `^mynas-auto-${this.ownerId}-\\d{8}T\\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.sqlite$`,
    );
    const currentName = basename(currentPath);
    const owned = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    if (!owned.includes(currentName)) {
      throw new Error("completed catalog backup is missing");
    }
    const removed = owned
      .filter((name) => name !== currentName)
      .slice(Math.max(0, retentionCount - 1));
    await Promise.all(removed.map((name) => rm(resolve(directory, name))));
    return removed.length;
  }

  public async verify(directory: string, destinationId: string): Promise<void> {
    this.assertOutside(directory);
    await this.verifyMarker(directory, destinationId, false);
  }

  private assertOutside(directory: string): void {
    if (!isPhysicalPathOutside(this.dataDir, directory)) {
      throw new Error("backup directory must be absolute and outside the data directory");
    }
  }

  private async verifyMarker(
    directory: string,
    destinationId: string,
    create: boolean,
  ): Promise<void> {
    const markerPath = resolve(directory, `.mynas-maintenance-${this.ownerId}-${destinationId}`);
    if (create) {
      try {
        await writeFile(markerPath, destinationId, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }
    }
    const marker = await open(
      markerPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const metadata = await marker.stat();
      if (!metadata.isFile() || metadata.size !== 32) {
        throw new Error("backup identity marker is not a 32-byte regular file");
      }
      const contents = Buffer.alloc(32);
      const { bytesRead } = await marker.read(contents, 0, contents.length, 0);
      if (bytesRead !== contents.length || contents.toString("utf8") !== destinationId) {
        throw new Error("backup identity marker content does not match");
      }
    } finally {
      await marker.close();
    }
  }
}
