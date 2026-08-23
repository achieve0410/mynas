import { z } from "zod";

import { canonicalJsonBytes } from "./manifest";

const MAGIC = new TextEncoder().encode("MYSLK001");
const HEADER_LIMIT = 4_096;
const HKDF_INFO = new TextEncoder().encode("mynas-slack-snapshot/v1/aead");
const decoder = new TextDecoder("utf-8", { fatal: true });

const keyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const snapshotIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const chunkHeaderSchema = z
  .object({
    alg: z.literal("A256GCM"),
    chunk_index: z.number().int().nonnegative(),
    encryption_key_id: keyIdSchema,
    nonce: z.string(),
    plaintext_len: z.number().int().nonnegative(),
    snapshot_id: snapshotIdSchema,
    v: z.literal(1),
  })
  .strict();

type ChunkHeader = z.infer<typeof chunkHeaderSchema>;

export type EncryptChunkOptions = {
  readonly encryptionKeyId: string;
  readonly index: number;
  readonly plaintext: Uint8Array;
  readonly root: Uint8Array;
  readonly snapshotId: string;
};

export type DecryptChunkOptions = {
  readonly encrypted: Uint8Array;
  readonly encryptionKeyId: string;
  readonly index: number;
  readonly root: Uint8Array;
  readonly snapshotId: string;
};

export class SnapshotCryptoError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SnapshotCryptoError";
  }
}

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const result = new ArrayBuffer(contents.byteLength);
  new Uint8Array(result).set(contents);
  return result;
};

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const sameBytes = (first: Uint8Array, second: Uint8Array): boolean =>
  first.byteLength === second.byteLength && first.every((value, index) => value === second[index]);

const snapshotIdBytes = (snapshotId: string): Uint8Array =>
  Uint8Array.fromHex(snapshotIdSchema.parse(snapshotId));

const nonceFor = (index: number): Uint8Array => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new SnapshotCryptoError("snapshot chunk index is invalid");
  }
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(index));
  return nonce;
};

const encodedHeader = (header: ChunkHeader): Uint8Array => canonicalJsonBytes(header);

const assertRoot = (root: Uint8Array): void => {
  if (root.byteLength !== 32) {
    throw new SnapshotCryptoError("snapshot encryption root must be 32 bytes");
  }
};

export const deriveSnapshotKey = async (
  root: Uint8Array,
  snapshotId: string,
): Promise<Uint8Array> => {
  assertRoot(root);
  const source = await crypto.subtle.importKey("raw", exactArrayBuffer(root), "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        hash: "SHA-256",
        info: exactArrayBuffer(HKDF_INFO),
        name: "HKDF",
        salt: exactArrayBuffer(snapshotIdBytes(snapshotId)),
      },
      source,
      256,
    ),
  );
};

export const encryptChunk = async (options: EncryptChunkOptions): Promise<Uint8Array> => {
  const nonce = nonceFor(options.index);
  const header = chunkHeaderSchema.parse({
    alg: "A256GCM",
    chunk_index: options.index,
    encryption_key_id: keyIdSchema.parse(options.encryptionKeyId),
    nonce: Buffer.from(nonce).toString("base64"),
    plaintext_len: options.plaintext.byteLength,
    snapshot_id: snapshotIdSchema.parse(options.snapshotId),
    v: 1,
  });
  const headerBytes = encodedHeader(header);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.byteLength);
  const additionalData = concatenate(MAGIC, length, headerBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(await deriveSnapshotKey(options.root, options.snapshotId)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        additionalData: exactArrayBuffer(additionalData),
        iv: exactArrayBuffer(nonce),
        name: "AES-GCM",
        tagLength: 128,
      },
      key,
      exactArrayBuffer(options.plaintext),
    ),
  );
  return concatenate(additionalData, ciphertext);
};

const decodeHeader = (
  encrypted: Uint8Array,
): {
  readonly additionalData: Uint8Array;
  readonly header: ChunkHeader;
  readonly offset: number;
} => {
  if (encrypted.byteLength < MAGIC.byteLength + 4 + 16) {
    throw new SnapshotCryptoError("snapshot chunk is truncated");
  }
  if (!sameBytes(encrypted.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new SnapshotCryptoError("snapshot chunk magic is invalid");
  }
  const headerLength = new DataView(
    encrypted.buffer,
    encrypted.byteOffset + MAGIC.byteLength,
    4,
  ).getUint32(0);
  if (headerLength === 0 || headerLength > HEADER_LIMIT) {
    throw new SnapshotCryptoError("snapshot chunk header length is invalid");
  }
  const offset = MAGIC.byteLength + 4 + headerLength;
  if (encrypted.byteLength < offset + 16) {
    throw new SnapshotCryptoError("snapshot chunk ciphertext is truncated");
  }
  const headerBytes = encrypted.subarray(MAGIC.byteLength + 4, offset);
  let header: ChunkHeader;
  try {
    header = chunkHeaderSchema.parse(JSON.parse(decoder.decode(headerBytes)));
  } catch {
    throw new SnapshotCryptoError("snapshot chunk header is invalid");
  }
  if (!sameBytes(headerBytes, encodedHeader(header))) {
    throw new SnapshotCryptoError("snapshot chunk header is not canonical");
  }
  return { additionalData: encrypted.subarray(0, offset), header, offset };
};

export const decryptChunk = async (options: DecryptChunkOptions): Promise<Uint8Array> => {
  const { additionalData, header, offset } = decodeHeader(options.encrypted);
  const expectedNonce = nonceFor(options.index);
  if (header.chunk_index !== options.index) {
    throw new SnapshotCryptoError("snapshot chunk index does not match");
  }
  if (header.snapshot_id !== options.snapshotId) {
    throw new SnapshotCryptoError("snapshot id does not match");
  }
  if (header.encryption_key_id !== options.encryptionKeyId) {
    throw new SnapshotCryptoError("snapshot encryption key id does not match");
  }
  if (!sameBytes(new Uint8Array(Buffer.from(header.nonce, "base64")), expectedNonce)) {
    throw new SnapshotCryptoError("snapshot chunk nonce does not match index");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(await deriveSnapshotKey(options.root, options.snapshotId)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: exactArrayBuffer(additionalData),
          iv: exactArrayBuffer(expectedNonce),
          name: "AES-GCM",
          tagLength: 128,
        },
        key,
        exactArrayBuffer(options.encrypted.subarray(offset)),
      ),
    );
  } catch {
    throw new SnapshotCryptoError("snapshot chunk authentication failed");
  }
  if (plaintext.byteLength !== header.plaintext_len) {
    throw new SnapshotCryptoError("snapshot chunk plaintext length does not match");
  }
  return plaintext;
};

export const generateEncryptionRoot = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export { generateSigningKeyPair, signManifest, verifyManifestSignature } from "./signing";
