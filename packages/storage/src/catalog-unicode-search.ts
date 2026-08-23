import type { FileListCursor, FileListEntry, FileListPage } from "./catalog-listing";

type UnicodeSearchOptions = {
  readonly cursor: FileListCursor | null;
  readonly fetchPage: (cursor: FileListCursor | null) => FileListPage;
  readonly limit: number;
  readonly prefix: string;
  readonly search: string;
};

export const listUnicodeCurrentFiles = ({
  cursor,
  fetchPage,
  limit,
  prefix,
  search,
}: UnicodeSearchOptions): FileListPage => {
  const matches: FileListEntry[] = [];
  let scanCursor = cursor;
  while (matches.length <= limit) {
    const page = fetchPage(scanCursor);
    matches.push(
      ...page.entries.filter((entry) =>
        entry.path.slice(prefix.length).toLocaleLowerCase().includes(search),
      ),
    );
    if (page.nextCursor === null) {
      break;
    }
    scanCursor = page.nextCursor;
  }
  const entries = matches.slice(0, limit);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor:
      matches.length > limit && last !== undefined ? { kind: last.kind, path: last.path } : null,
    prefix,
  };
};
