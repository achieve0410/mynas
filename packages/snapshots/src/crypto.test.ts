import { describe, expect, test } from "bun:test";

import {
  decryptChunk,
  deriveSnapshotKey,
  encryptChunk,
  signManifest,
  verifyManifestSignature,
} from "./crypto";
import { sha256 } from "./manifest";

const fromHex = (value: string): Uint8Array => Uint8Array.fromHex(value);
const toHex = (value: Uint8Array): string => value.toHex();

const root = fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
const snapshotId = "00112233445566778899aabbccddeeff";
const plaintext = new TextEncoder().encode("hello world");
const signingSeed = fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const signingPkcs8 = new Uint8Array([
  ...fromHex("302e020100300506032b657004220420"),
  ...signingSeed,
]);
const signingPublic = fromHex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");

describe("snapshot cryptography", () => {
  test("matches the fixed HKDF and AES-GCM chunk vector", async () => {
    expect(toHex(await deriveSnapshotKey(root, snapshotId))).toBe(
      "16a5606114afea7805bd2be96a2e703bbff4352c1780f0c9c805566304ea6548",
    );

    const encrypted = await encryptChunk({
      encryptionKeyId: "enc-v1",
      index: 0,
      plaintext,
      root,
      snapshotId,
    });

    expect(encrypted.byteLength).toBe(202);
    expect(sha256(encrypted)).toBe(
      "61a1ccf5f37c6f06fcfa213fe9b366d0d3379800d8b31572a71088d9f15a0101",
    );
    expect(
      await decryptChunk({
        encrypted,
        encryptionKeyId: "enc-v1",
        index: 0,
        root,
        snapshotId,
      }),
    ).toEqual(plaintext);
  });

  test("matches the fixed Ed25519 manifest signature vector", async () => {
    const manifest = new Uint8Array();
    const signature = await signManifest(signingPkcs8, manifest);

    expect(toHex(signature)).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
    expect(await verifyManifestSignature(signingPublic, manifest, signature)).toBe(true);
  });

  test("fails closed for AAD, ciphertext, signature, key, and index mutations", async () => {
    const encrypted = await encryptChunk({
      encryptionKeyId: "enc-v1",
      index: 0,
      plaintext,
      root,
      snapshotId,
    });
    for (const index of [20, encrypted.byteLength - 1]) {
      const mutated = encrypted.slice();
      mutated[index] = (mutated[index] ?? 0) ^ 1;
      await expect(
        decryptChunk({
          encrypted: mutated,
          encryptionKeyId: "enc-v1",
          index: 0,
          root,
          snapshotId,
        }),
      ).rejects.toThrow();
    }
    await expect(
      decryptChunk({
        encrypted,
        encryptionKeyId: "enc-v1",
        index: 1,
        root,
        snapshotId,
      }),
    ).rejects.toThrow("index");
    const wrongRoot = root.slice();
    wrongRoot[0] = (wrongRoot[0] ?? 0) ^ 1;
    await expect(
      decryptChunk({
        encrypted,
        encryptionKeyId: "enc-v1",
        index: 0,
        root: wrongRoot,
        snapshotId,
      }),
    ).rejects.toThrow();

    const message = new TextEncoder().encode("manifest");
    const signature = await signManifest(signingPkcs8, message);
    signature[0] = (signature[0] ?? 0) ^ 1;
    expect(await verifyManifestSignature(signingPublic, message, signature)).toBe(false);
  });
});
