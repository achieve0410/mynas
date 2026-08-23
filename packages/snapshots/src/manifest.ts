import { SnapshotError, type SnapshotManifest, snapshotManifestSchema } from "./models";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type CanonicalValue =
  | boolean
  | null
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const canonicalize = (value: CanonicalValue): CanonicalValue => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

const sameBytes = (first: Uint8Array, second: Uint8Array): boolean =>
  first.byteLength === second.byteLength && first.every((value, index) => value === second[index]);

export const sha256 = (contents: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(contents).digest("hex");

export const canonicalJsonBytes = (value: CanonicalValue): Uint8Array =>
  encoder.encode(JSON.stringify(canonicalize(value)));

export const canonicalManifestBytes = (value: SnapshotManifest): Uint8Array =>
  canonicalJsonBytes(snapshotManifestSchema.parse(value));

export const parseCanonicalManifest = (contents: Uint8Array): SnapshotManifest => {
  try {
    const parsed = snapshotManifestSchema.parse(JSON.parse(decoder.decode(contents)));
    if (!sameBytes(contents, canonicalManifestBytes(parsed))) {
      throw new SnapshotError("invalid", "manifest must use canonical JSON");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SnapshotError) {
      throw error;
    }
    throw new SnapshotError("invalid", "manifest is invalid");
  }
};
