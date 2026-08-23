const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const result = new ArrayBuffer(contents.byteLength);
  new Uint8Array(result).set(contents);
  return result;
};

export const signManifest = async (
  privateKey: Uint8Array,
  manifest: Uint8Array,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    exactArrayBuffer(privateKey),
    "Ed25519",
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("Ed25519", key, exactArrayBuffer(manifest)));
};

export const verifyManifestSignature = async (
  publicKey: Uint8Array,
  manifest: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> => {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      exactArrayBuffer(publicKey),
      "Ed25519",
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "Ed25519",
      key,
      exactArrayBuffer(signature),
      exactArrayBuffer(manifest),
    );
  } catch {
    return false;
  }
};

export const generateSigningKeyPair = async (): Promise<{
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}> => {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return {
    privateKey: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
};
