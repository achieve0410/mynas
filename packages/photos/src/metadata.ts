import ExifReader from "exifreader";
import { z } from "zod";

import type { PhotoLocation } from "./models";

export type PhotoMetadata = {
  readonly capturedAt: string;
  readonly location: PhotoLocation | null;
};

const exifTagSchema = z.object({ description: z.string() });
const parsedMetadataSchema = z.object({
  exif: z
    .object({
      DateTimeOriginal: exifTagSchema.optional(),
      OffsetTimeOriginal: exifTagSchema.optional(),
    })
    .optional(),
  gps: z
    .object({
      Latitude: z.number().finite().optional(),
      Longitude: z.number().finite().optional(),
    })
    .optional(),
});
const exifDatePattern =
  /^(?<year>\d{4}):(?<month>\d{2}):(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/;
const offsetPattern = /^(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2})$/;

const parseInteger = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const captureTimestamp = (dateValue: string | undefined, offsetValue: string | undefined) => {
  if (dateValue === undefined) {
    return null;
  }
  const dateMatch = exifDatePattern.exec(dateValue.trim());
  if (dateMatch?.groups === undefined) {
    return null;
  }
  const values = {
    day: parseInteger(dateMatch.groups.day),
    hour: parseInteger(dateMatch.groups.hour),
    minute: parseInteger(dateMatch.groups.minute),
    month: parseInteger(dateMatch.groups.month),
    second: parseInteger(dateMatch.groups.second),
    year: parseInteger(dateMatch.groups.year),
  };
  if (Object.values(values).some((value) => value === null)) {
    return null;
  }
  const { day, hour, minute, month, second, year } = values as Record<keyof typeof values, number>;
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(wallTime);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    return null;
  }
  if (offsetValue === undefined) {
    return roundTrip.toISOString().slice(0, -1);
  }
  const offsetMatch = offsetPattern.exec(offsetValue.trim());
  if (offsetMatch?.groups === undefined) {
    return null;
  }
  const offsetHour = parseInteger(offsetMatch.groups.hour);
  const offsetMinute = parseInteger(offsetMatch.groups.minute);
  if (
    offsetHour === null ||
    offsetMinute === null ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }
  const direction = offsetMatch.groups.sign === "+" ? 1 : -1;
  const offsetMilliseconds = direction * (offsetHour * 60 + offsetMinute) * 60_000;
  return new Date(wallTime - offsetMilliseconds).toISOString();
};

const location = (
  latitude: number | undefined,
  longitude: number | undefined,
): PhotoLocation | null => {
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
};

export const extractPhotoMetadata = (contents: Uint8Array, importedAt: string): PhotoMetadata => {
  try {
    const parsed = parsedMetadataSchema.parse(
      ExifReader.load(Buffer.from(contents), {
        expanded: true,
        includeTags: {
          exif: [
            "DateTimeOriginal",
            "OffsetTimeOriginal",
            "GPSLatitudeRef",
            "GPSLatitude",
            "GPSLongitudeRef",
            "GPSLongitude",
          ],
          gps: ["Latitude", "Longitude"],
        },
      }),
    );
    return {
      capturedAt:
        captureTimestamp(
          parsed.exif?.DateTimeOriginal?.description,
          parsed.exif?.OffsetTimeOriginal?.description,
        ) ?? importedAt,
      location: location(parsed.gps?.Latitude, parsed.gps?.Longitude),
    };
  } catch {
    return { capturedAt: importedAt, location: null };
  }
};
