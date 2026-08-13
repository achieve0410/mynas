type ZipEntry = {
  readonly contents: Uint8Array;
  readonly path: string;
};

const encoder = new TextEncoder();

const assertSafePath = (path: string): void => {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("unsafe ZIP entry path");
  }
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let result = value;
  for (let bit = 0; bit < 8; bit += 1) {
    result = (result & 1) === 1 ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
  }
  return result >>> 0;
});

const crc32 = (contents: Uint8Array): number => {
  let result = 0xffffffff;
  for (const byte of contents) {
    const lookup = crcTable[(result ^ byte) & 0xff];
    if (lookup === undefined) {
      throw new Error("CRC table lookup failed");
    }
    result = lookup ^ (result >>> 8);
  }
  return (result ^ 0xffffffff) >>> 0;
};

const localHeader = (path: Uint8Array, contents: Uint8Array, crc: number): Uint8Array => {
  const header = new Uint8Array(30 + path.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, contents.byteLength, true);
  view.setUint32(22, contents.byteLength, true);
  view.setUint16(26, path.byteLength, true);
  header.set(path, 30);
  return header;
};

const centralHeader = (
  path: Uint8Array,
  contents: Uint8Array,
  crc: number,
  offset: number,
): Uint8Array => {
  const header = new Uint8Array(46 + path.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, contents.byteLength, true);
  view.setUint32(24, contents.byteLength, true);
  view.setUint16(28, path.byteLength, true);
  view.setUint32(42, offset, true);
  header.set(path, 46);
  return header;
};

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

export const createZip = (entries: readonly ZipEntry[]): Uint8Array => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    assertSafePath(entry.path);
    const path = encoder.encode(entry.path);
    const crc = crc32(entry.contents);
    const local = localHeader(path, entry.contents, crc);
    localParts.push(local, entry.contents);
    centralParts.push(centralHeader(path, entry.contents, crc, localOffset));
    localOffset += local.byteLength + entry.contents.byteLength;
  }
  const central = concatenate(centralParts);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, central.byteLength, true);
  view.setUint32(16, localOffset, true);
  return concatenate([...localParts, central, end]);
};
