import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { encodeArchive, type SnapshotArchiveRecord } from "./archive";

type CollectOptions = {
  readonly files?: readonly { readonly archivePath: string; readonly path: string }[];
  readonly mysqlDump: AsyncIterable<Uint8Array>;
  readonly roots: readonly { readonly archivePrefix: string; readonly root: string }[];
};

const fileContents = async function* (path: string): AsyncIterable<Uint8Array> {
  for await (const contents of createReadStream(path)) {
    yield new Uint8Array(contents);
  }
};

const walkFiles = async (root: string): Promise<readonly string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files;
};

const records = async function* (options: CollectOptions): AsyncIterable<SnapshotArchiveRecord> {
  yield {
    contents: options.mysqlDump,
    mode: 0o600,
    path: "database/mysql.sql",
  };
  for (const file of [...(options.files ?? [])].sort((first, second) =>
    first.archivePath.localeCompare(second.archivePath),
  )) {
    const status = await lstat(file.path);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new Error(`snapshot source is not a regular file: ${file.archivePath}`);
    }
    yield {
      contents: fileContents(file.path),
      mode: status.mode & 0o777,
      path: file.archivePath,
    };
  }
  for (const root of options.roots) {
    for (const path of await walkFiles(root.root)) {
      const status = await lstat(path);
      if (!status.isFile()) {
        continue;
      }
      yield {
        contents: fileContents(path),
        mode: status.mode & 0o777,
        path: `${root.archivePrefix}/${relative(root.root, path).split(sep).join("/")}`,
      };
    }
  }
};

export const collectSlackArchive = (options: CollectOptions): AsyncIterable<Uint8Array> =>
  encodeArchive(records(options));

export const withQuiescedWriters = async <Result>(
  stop: () => Promise<void>,
  start: () => Promise<void>,
  operation: () => Promise<Result>,
): Promise<Result> => {
  await stop();
  try {
    return await operation();
  } finally {
    await start();
  }
};
