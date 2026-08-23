import type { Album, Photo } from "../schemas";

export type PhotoSort = "filename" | "newest" | "oldest" | "type";

export const albumNamesForPhoto = (albums: readonly Album[], photoId?: string): string[] =>
  albums.filter((album) => album.photos.some(({ id }) => id === photoId)).map(({ name }) => name);

export const filterAndSortPhotos = (
  photos: readonly Photo[],
  search: string,
  sort: PhotoSort,
): Photo[] => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = photos.filter((photo) =>
    photo.filename.toLocaleLowerCase().includes(normalizedSearch),
  );
  return [...filtered].sort((left, right) => {
    if (sort === "filename") {
      return left.filename.localeCompare(right.filename);
    }
    if (sort === "type") {
      return left.format.localeCompare(right.format) || left.filename.localeCompare(right.filename);
    }
    const timeOrder = left.capturedAt.localeCompare(right.capturedAt);
    return sort === "oldest" ? timeOrder : -timeOrder;
  });
};

const timelineDayKey = (date: string): string => {
  const local = new Date(date);
  return [local.getFullYear(), local.getMonth() + 1, local.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
};

export const groupPhotosByCapturedDay = (photos: readonly Photo[]): Photo[][] => {
  const grouped = new Map<string, Photo[]>();
  for (const photo of photos) {
    const day = timelineDayKey(photo.capturedAt);
    grouped.set(day, [...(grouped.get(day) ?? []), photo]);
  }
  return [...grouped.values()];
};
