import { z } from "zod";

import { canonicalJsonBytes } from "../../snapshots/src/manifest";

const MAGIC = new TextEncoder().encode("MYSLAR01");
const FRAME_START = 1;
const FRAME_DATA = 2;
const FRAME_END = 3;
const FRAME_ARCHIVE_END = 4;
const MAX_DATA_FRAME = 1_024 * 1_024;
const MAX_METADATA_FRAME = 4_096;

const recordHeaderSchema = z
  .object({
    mode: z.number().int().min(0).max(0o777),
    path: z.string(),
  })
  .strict();

export type SnapshotArchiveRecord = {
  readonly contents: AsyncIterable<Uint8Array>;
  readonly mode: number;
  readonly path: string;
};

export type SnapshotArchiveSink = {
  end(): Promise<void>;
  start(record: { readonly mode: number; readonly path: string }): Promise<void>;
  write(contents: Uint8Array): Promise<void>;
};

const safePath = (value: string): string => {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error("snapshot archive path is unsafe");
  }
  return value;
};

const frame = (kind: number, payload: Uint8Array = new Uint8Array()): Uint8Array => {
  const result = new Uint8Array(5 + payload.byteLength);
  result[0] = kind;
  new DataView(result.buffer).setUint32(1, payload.byteLength);
  result.set(payload, 5);
  return result;
};

const toAsyncIterator = <Value>(
  values: Iterable<Value> | AsyncIterable<Value>,
): AsyncIterator<Value> => {
  if (Symbol.asyncIterator in values) {
    return values[Symbol.asyncIterator]();
  }
  const iterator = values[Symbol.iterator]();
  return {
    next: async () => iterator.next(),
  };
};

const validateRecord = (record: SnapshotArchiveRecord): SnapshotArchiveRecord => ({
  ...record,
  mode: recordHeaderSchema.shape.mode.parse(record.mode),
  path: safePath(record.path),
});

export const encodeArchive = async function* (
  records: Iterable<SnapshotArchiveRecord> | AsyncIterable<SnapshotArchiveRecord>,
): AsyncIterable<Uint8Array> {
  const iterator = toAsyncIterator(records);
  let current = await iterator.next();
  if (current.done === true) {
    throw new Error("snapshot archive requires at least one record");
  }
  let record = validateRecord(current.value);
  yield MAGIC;
  while (true) {
    yield frame(FRAME_START, canonicalJsonBytes({ mode: record.mode, path: record.path }));
    for await (const contents of record.contents) {
      for (let offset = 0; offset < contents.byteLength; offset += MAX_DATA_FRAME) {
        yield frame(FRAME_DATA, contents.subarray(offset, offset + MAX_DATA_FRAME));
      }
    }
    yield frame(FRAME_END);
    current = await iterator.next();
    if (current.done === true) {
      break;
    }
    record = validateRecord(current.value);
  }
  yield frame(FRAME_ARCHIVE_END);
};

class AsyncByteReader {
  private buffer = new Uint8Array();
  private done = false;
  private readonly iterator: AsyncIterator<Uint8Array>;

  public constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  public async hasRemaining(): Promise<boolean> {
    await this.fill(1);
    return this.buffer.byteLength !== 0;
  }

  public async read(length: number): Promise<Uint8Array> {
    await this.fill(length);
    if (this.buffer.byteLength < length) {
      throw new Error("snapshot archive is truncated");
    }
    const result = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return result;
  }

  private async fill(length: number): Promise<void> {
    while (!this.done && this.buffer.byteLength < length) {
      const next = await this.iterator.next();
      if (next.done === true) {
        this.done = true;
        break;
      }
      if (next.value.byteLength !== 0) {
        const combined = new Uint8Array(this.buffer.byteLength + next.value.byteLength);
        combined.set(this.buffer);
        combined.set(next.value, this.buffer.byteLength);
        this.buffer = combined;
      }
    }
  }
}

const sameBytes = (first: Uint8Array, second: Uint8Array): boolean =>
  first.byteLength === second.byteLength && first.every((value, index) => value === second[index]);

export const decodeArchive = async (
  source: AsyncIterable<Uint8Array>,
  sink: SnapshotArchiveSink,
): Promise<void> => {
  const reader = new AsyncByteReader(source);
  if (!sameBytes(await reader.read(MAGIC.byteLength), MAGIC)) {
    throw new Error("snapshot archive magic is invalid");
  }
  let open = false;
  while (true) {
    const header = await reader.read(5);
    const kind = header[0];
    const length = new DataView(header.buffer).getUint32(1);
    if (kind === FRAME_ARCHIVE_END) {
      if (open || length !== 0 || (await reader.hasRemaining())) {
        throw new Error("snapshot archive end is invalid");
      }
      return;
    }
    if (kind === FRAME_START) {
      if (open || length === 0 || length > MAX_METADATA_FRAME) {
        throw new Error("snapshot archive record start is invalid");
      }
      const parsed = recordHeaderSchema.parse(
        JSON.parse(new TextDecoder().decode(await reader.read(length))),
      );
      await sink.start({ mode: parsed.mode, path: safePath(parsed.path) });
      open = true;
      continue;
    }
    if (kind === FRAME_DATA) {
      if (!open || length > MAX_DATA_FRAME) {
        throw new Error("snapshot archive data frame is invalid");
      }
      if (length !== 0) {
        await sink.write(await reader.read(length));
      }
      continue;
    }
    if (kind === FRAME_END && open && length === 0) {
      await sink.end();
      open = false;
      continue;
    }
    throw new Error("snapshot archive frame is invalid");
  }
};
