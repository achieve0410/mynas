import { api } from "./api";
import type { PhotoReviewItem } from "./components/photo-import-review";
import { checksumPhotoFile } from "./photo-checksum";
import { loadPhotoReceipts, photoReceiptKey } from "./photo-receipts";

const MAX_PHOTO_BYTES = 25 * 1_024 * 1_024;
const LOOKUP_BATCH_SIZE = 500;
const supportedExtensions = /\.(?:heic|heif|jpe?g|png)$/i;
const supportedTypes = new Set(["", "image/heic", "image/heif", "image/jpeg", "image/png"]);

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException("Photo review cancelled", "AbortError");
  }
};

export const createPhotoReviewItems = (
  files: FileList | null,
  kind: "directory" | "files",
): readonly PhotoReviewItem[] =>
  Array.from(files ?? []).map((file) => {
    const path =
      kind === "directory" && file.webkitRelativePath.length > 0
        ? file.webkitRelativePath
        : file.name;
    const status =
      file.size > MAX_PHOTO_BYTES
        ? "oversize"
        : !supportedExtensions.test(path) || !supportedTypes.has(file.type.toLowerCase())
          ? "unsupported"
          : "checking";
    return { file, id: crypto.randomUUID(), path, status };
  });

export const fallbackPhotoReviewItems = (
  items: readonly PhotoReviewItem[],
): readonly PhotoReviewItem[] =>
  items.map((item) => (item.status === "checking" ? { ...item, status: "new" } : item));

export const resolvePhotoReviewItems = async (
  items: readonly PhotoReviewItem[],
  signal: AbortSignal,
): Promise<readonly PhotoReviewItem[]> => {
  const receipts = await loadPhotoReceipts();
  throwIfAborted(signal);
  const pathsWithoutReceipts = items.flatMap((item) =>
    item.status === "checking" && !receipts.has(photoReceiptKey(item)) ? [item.path] : [],
  );
  const protectedPaths =
    pathsWithoutReceipts.length === 0
      ? new Set<string>()
      : new Set((await api.listPhotos()).map((photo) => photo.filename));
  throwIfAborted(signal);
  const candidates = new Set<string>();
  const withCandidates = items.map((item) => {
    if (item.status !== "checking") {
      return item;
    }
    const receipt = receipts.get(photoReceiptKey(item));
    if (receipt === undefined && !protectedPaths.has(item.path)) {
      return { ...item, status: "new" as const };
    }
    candidates.add(item.id);
    return item;
  });
  const checksums = new Map<string, string>();
  for (const item of withCandidates) {
    if (!candidates.has(item.id)) {
      continue;
    }
    checksums.set(item.id, await checksumPhotoFile(item.file, signal));
    throwIfAborted(signal);
  }
  const matches = new Map<string, string>();
  const uniqueChecksums = [...new Set(checksums.values())];
  for (let offset = 0; offset < uniqueChecksums.length; offset += LOOKUP_BATCH_SIZE) {
    const response = await api.lookupPhotoChecksums(
      uniqueChecksums.slice(offset, offset + LOOKUP_BATCH_SIZE),
    );
    for (const match of response.matches) {
      matches.set(match.checksum, match.id);
    }
    throwIfAborted(signal);
  }
  return withCandidates.map((item) => {
    const checksum = checksums.get(item.id);
    if (checksum === undefined) {
      return item;
    }
    const photoId = matches.get(checksum);
    return photoId === undefined
      ? { ...item, status: "new" }
      : { ...item, photoId, status: "already-protected" };
  });
};
