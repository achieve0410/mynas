import type { ByteRange } from "../../../packages/storage/src/adapter";
import type { FileVersion } from "../../../packages/storage/src/catalog";
import { MirrorError } from "../../../packages/storage/src/mirror";

export class InvalidRangeError extends Error {
  public readonly code = "invalid_range";
}

export const currentBlob = (versions: readonly FileVersion[]) => {
  const current = versions.at(-1);
  if (current?.blob === null || current === undefined) {
    throw new MirrorError("not_found", "file not found");
  }
  return current.blob;
};

export type FileTransfer = {
  readonly blob: ReturnType<typeof currentBlob>;
  readonly contents: Uint8Array;
  readonly range: ByteRange | null;
};

export const parseRange = (
  header: string | undefined,
  size: number,
): ByteRange | "invalid" | null => {
  if (header === undefined) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (match === null) {
    return "invalid";
  }
  const start = Number(match[1]);
  const inclusiveEnd = match[2] === "" ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(inclusiveEnd) ||
    start < 0 ||
    inclusiveEnd < start ||
    inclusiveEnd >= size
  ) {
    return "invalid";
  }
  return { endExclusive: inclusiveEnd + 1, start };
};

export const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};
