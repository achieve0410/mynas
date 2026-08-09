import {
  stat as fileStat,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

import type { BackendHealth, ByteRange, StorageBackend, StoredObject } from "./adapter";
import { filesystemIdentity, localBackendHealth } from "./local-health";

export type LocalStorageErrorCode =
  | "backend_unavailable"
  | "invalid_object_key"
  | "invalid_range"
  | "symlink_rejected";

export class LocalStorageError extends Error {
  public constructor(
    public readonly code: LocalStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalStorageError";
  }
}

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const parseKey = (key: string): readonly string[] => {
  if (key.length === 0 || key.includes("\0") || key.includes("\\") || isAbsolute(key)) {
    throw new LocalStorageError("invalid_object_key", "invalid object key");
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new LocalStorageError("invalid_object_key", "invalid object key");
  }
  return segments;
};

export class LocalDirectoryBackend implements StorageBackend {
  public readonly kind = "local";

  // Mutable lifecycle state is set once by initialize().
  private canonicalRoot: string | null = null;
  private rootIdentity: string | null = null;

  public constructor(
    public readonly id: string,
    private readonly configuredRoot: string,
    private readonly expectedIdentity?: string,
  ) {}

  public get replicaIdentity(): string {
    if (this.rootIdentity === null) {
      throw new LocalStorageError("backend_unavailable", "backend is not initialized");
    }
    return `local:${this.rootIdentity}`;
  }

  public async initialize(): Promise<void> {
    const rootInfo = await lstat(this.configuredRoot);
    if (rootInfo.isSymbolicLink()) {
      throw new LocalStorageError("symlink_rejected", "backend root cannot be a symlink");
    }
    if (!rootInfo.isDirectory()) {
      throw new LocalStorageError("backend_unavailable", "backend root is not a directory");
    }

    this.canonicalRoot = await realpath(this.configuredRoot);
    const canonicalInfo = await fileStat(this.canonicalRoot);
    this.rootIdentity =
      this.expectedIdentity ?? filesystemIdentity(canonicalInfo.dev, canonicalInfo.ino);
  }

  public async delete(key: string): Promise<void> {
    await this.requireHealthy();
    const objectPath = await this.resolveExistingObject(key);
    try {
      await rm(objectPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  public async get(key: string, range?: ByteRange): Promise<Uint8Array> {
    await this.requireHealthy();
    const objectPath = await this.resolveExistingObject(key);
    const contents = new Uint8Array(await readFile(objectPath));
    if (range === undefined) {
      return contents;
    }
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.endExclusive) ||
      range.start < 0 ||
      range.endExclusive <= range.start ||
      range.endExclusive > contents.byteLength
    ) {
      throw new LocalStorageError("invalid_range", "invalid byte range");
    }
    return contents.slice(range.start, range.endExclusive);
  }

  public async probe(): Promise<BackendHealth> {
    if (this.canonicalRoot === null || this.rootIdentity === null) {
      return { reason: "backend is not initialized", status: "unavailable" };
    }
    try {
      const configuredInfo = await lstat(this.configuredRoot);
      if (configuredInfo.isSymbolicLink() || !configuredInfo.isDirectory()) {
        return { reason: "backend root changed type", status: "unavailable" };
      }
      const currentRoot = await realpath(this.configuredRoot);
      const currentInfo = await fileStat(currentRoot);
      const currentIdentity = filesystemIdentity(currentInfo.dev, currentInfo.ino);
      if (currentRoot !== this.canonicalRoot || currentIdentity !== this.rootIdentity) {
        return { reason: "backend filesystem identity changed", status: "unavailable" };
      }
      return localBackendHealth(currentRoot, currentIdentity);
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
        return { reason: "backend root is unavailable", status: "unavailable" };
      }
      throw error;
    }
  }

  public async put(key: string, contents: Uint8Array): Promise<StoredObject> {
    await this.requireHealthy();
    const segments = parseKey(key);
    const root = this.requireInitializedRoot();
    const parent = await this.ensureSafeParent(segments.slice(0, -1), true);
    const leaf = segments.at(-1);
    if (leaf === undefined) {
      throw new LocalStorageError("invalid_object_key", "invalid object key");
    }
    const target = join(parent, leaf);
    await this.rejectSymlinkIfPresent(target);

    const temporary = join(parent, `.tmp-${crypto.randomUUID()}`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporary, target);
      const directoryHandle = await open(dirname(target), "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    if (!target.startsWith(`${root}${sep}`)) {
      throw new LocalStorageError("invalid_object_key", "invalid object key");
    }
    return { key, size: contents.byteLength };
  }

  public async stat(key: string): Promise<StoredObject | null> {
    await this.requireHealthy();
    try {
      const objectPath = await this.resolveExistingObject(key);
      const info = await lstat(objectPath);
      if (!info.isFile()) {
        throw new LocalStorageError("backend_unavailable", "stored object is not a file");
      }
      return { key, size: info.size };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async ensureSafeParent(
    segments: readonly string[],
    createMissing: boolean,
  ): Promise<string> {
    let current = this.requireInitializedRoot();
    for (const segment of segments) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          throw new LocalStorageError("symlink_rejected", "object path contains a symlink");
        }
        if (!info.isDirectory()) {
          throw new LocalStorageError("backend_unavailable", "object parent is not a directory");
        }
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT" && createMissing) {
          await mkdir(current, { mode: 0o700 });
          continue;
        }
        throw error;
      }
    }
    return current;
  }

  private async rejectSymlinkIfPresent(path: string): Promise<void> {
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        throw new LocalStorageError("symlink_rejected", "stored object cannot be a symlink");
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private async requireHealthy(): Promise<void> {
    const health = await this.probe();
    if (health.status === "unavailable") {
      throw new LocalStorageError("backend_unavailable", `backend unavailable: ${health.reason}`);
    }
  }

  private requireInitializedRoot(): string {
    if (this.canonicalRoot === null) {
      throw new LocalStorageError("backend_unavailable", "backend is not initialized");
    }
    return this.canonicalRoot;
  }

  private async resolveExistingObject(key: string): Promise<string> {
    const segments = parseKey(key);
    const parent = await this.ensureSafeParent(segments.slice(0, -1), false);
    const leaf = segments.at(-1);
    if (leaf === undefined) {
      throw new LocalStorageError("invalid_object_key", "invalid object key");
    }
    const objectPath = join(parent, leaf);
    await this.rejectSymlinkIfPresent(objectPath);
    return objectPath;
  }
}
