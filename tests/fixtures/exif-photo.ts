import { syntheticJpeg } from "./synthetic-photo";

type ExifFixtureOptions = {
  readonly dateTimeOriginal: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly offsetTimeOriginal?: string;
};

type AsciiEntry = {
  readonly bytes: Uint8Array;
  readonly tag: number;
};

type GpsEntry =
  | {
      readonly bytes: Uint8Array;
      readonly kind: "reference";
      readonly tag: number;
    }
  | {
      readonly kind: "coordinate";
      readonly rationals: readonly number[];
      readonly tag: number;
    };

const ascii = (value: string): Uint8Array => new TextEncoder().encode(`${value}\0`);

const coordinateEntries = (
  coordinate: number,
  coordinateTag: number,
  positiveReference: string,
  referenceTag: number,
): readonly GpsEntry[] => {
  const absolute = Math.abs(coordinate);
  const degrees = Math.floor(absolute);
  const minutesTotal = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesTotal);
  const seconds = Math.round((minutesTotal - minutes) * 60 * 1_000_000);
  return [
    {
      bytes: ascii(coordinate < 0 ? (positiveReference === "N" ? "S" : "W") : positiveReference),
      kind: "reference",
      tag: referenceTag,
    },
    {
      kind: "coordinate",
      rationals: [degrees, 1, minutes, 1, seconds, 1_000_000],
      tag: coordinateTag,
    },
  ];
};

const buildExifPayload = (options: ExifFixtureOptions): Uint8Array => {
  const exifEntries: readonly AsciiEntry[] = [
    { bytes: ascii(options.dateTimeOriginal), tag: 0x9003 },
    ...(options.offsetTimeOriginal === undefined
      ? []
      : [{ bytes: ascii(options.offsetTimeOriginal), tag: 0x9011 }]),
  ];
  const gpsEntries: readonly GpsEntry[] = [
    ...(options.latitude === undefined ? [] : coordinateEntries(options.latitude, 2, "N", 1)),
    ...(options.longitude === undefined ? [] : coordinateEntries(options.longitude, 4, "E", 3)),
  ];
  const ifd0Offset = 8;
  const ifd0Entries = 1 + (gpsEntries.length === 0 ? 0 : 1);
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifIfdSize = 2 + exifEntries.length * 12 + 4;
  let dataOffset = exifIfdOffset + exifIfdSize;
  const exifDataOffsets = exifEntries.map(({ bytes }) => {
    const offset = dataOffset;
    dataOffset += bytes.length;
    return offset;
  });
  const gpsIfdOffset = dataOffset + (dataOffset % 2);
  const gpsIfdSize = gpsEntries.length === 0 ? 0 : 2 + gpsEntries.length * 12 + 4;
  let gpsDataOffset = gpsIfdOffset + gpsIfdSize;
  const gpsDataOffsets = gpsEntries.map((entry) => {
    if (entry.kind === "reference") {
      return null;
    }
    const offset = gpsDataOffset;
    gpsDataOffset += 24;
    return offset;
  });
  const tiff = new Uint8Array(gpsDataOffset);
  const view = new DataView(tiff.buffer);
  const set16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const set32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const writeEntry = (offset: number, tag: number, type: number, count: number, value: number) => {
    set16(offset, tag);
    set16(offset + 2, type);
    set32(offset + 4, count);
    set32(offset + 8, value);
  };

  tiff.set([0x49, 0x49], 0);
  set16(2, 42);
  set32(4, ifd0Offset);
  set16(ifd0Offset, ifd0Entries);
  writeEntry(ifd0Offset + 2, 0x8769, 4, 1, exifIfdOffset);
  if (gpsEntries.length !== 0) {
    writeEntry(ifd0Offset + 14, 0x8825, 4, 1, gpsIfdOffset);
  }

  set16(exifIfdOffset, exifEntries.length);
  exifEntries.forEach((entry, index) => {
    writeEntry(
      exifIfdOffset + 2 + index * 12,
      entry.tag,
      2,
      entry.bytes.length,
      exifDataOffsets[index] ?? 0,
    );
    tiff.set(entry.bytes, exifDataOffsets[index] ?? 0);
  });

  if (gpsEntries.length !== 0) {
    set16(gpsIfdOffset, gpsEntries.length);
    gpsEntries.forEach((entry, index) => {
      const entryOffset = gpsIfdOffset + 2 + index * 12;
      if (entry.kind === "reference") {
        writeEntry(entryOffset, entry.tag, 2, entry.bytes.length, 0);
        tiff.set(entry.bytes, entryOffset + 8);
        return;
      }
      const valueOffset = gpsDataOffsets[index] ?? 0;
      writeEntry(entryOffset, entry.tag, 5, 3, valueOffset);
      entry.rationals.forEach((value, rationalIndex) => {
        set32(valueOffset + rationalIndex * 4, value);
      });
    });
  }

  const payload = new Uint8Array(6 + tiff.length);
  payload.set(ascii("Exif").slice(0, 5), 0);
  payload.set(tiff, 6);
  return payload;
};

const insertApp1 = (payload: Uint8Array): Uint8Array => {
  const source = syntheticJpeg();
  const result = new Uint8Array(source.length + payload.length + 4);
  const segmentLength = payload.length + 2;
  result.set(source.slice(0, 2), 0);
  result.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], 2);
  result.set(payload, 6);
  result.set(source.slice(2), 6 + payload.length);
  return result;
};

export const syntheticExifJpeg = (options: ExifFixtureOptions): Uint8Array =>
  insertApp1(buildExifPayload(options));

export const syntheticMalformedExifJpeg = (): Uint8Array =>
  insertApp1(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a]));
