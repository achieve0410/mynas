import { FileText, Folder, FolderOpen } from "lucide-react";

import type { FileListEntry } from "../schemas";

type FileBrowserProps = {
  readonly entries: readonly FileListEntry[];
  readonly error: Error | null;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isLoading: boolean;
  readonly onFileSelect: (path: string) => void;
  readonly onFolderSelect: (prefix: string) => void;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly prefix: string;
  readonly selectedPath: string | null;
};

const nameOf = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

const breadcrumbPrefixes = (prefix: string): readonly { label: string; prefix: string }[] => {
  const segments = prefix.split("/").filter(Boolean);
  return segments.map((label, index) => ({
    label,
    prefix: `${segments.slice(0, index + 1).join("/")}/`,
  }));
};

const formatBytes = (size: number): string => {
  if (size < 1_024) {
    return `${size} B`;
  }
  if (size < 1_024 * 1_024) {
    return `${(size / 1_024).toFixed(1)} KiB`;
  }
  return `${(size / (1_024 * 1_024)).toFixed(1)} MiB`;
};

export const FileBrowser = ({
  entries,
  error,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  onFileSelect,
  onFolderSelect,
  onLoadMore,
  onRetry,
  prefix,
  selectedPath,
}: FileBrowserProps) => (
  <section aria-labelledby="file-browser-title" className="section-block file-browser">
    <div className="section-heading compact">
      <div>
        <span className="eyebrow">Catalog view</span>
        <h2 id="file-browser-title">Browse protected files</h2>
      </div>
    </div>
    <nav aria-label="File path" className="file-breadcrumbs">
      <button
        aria-current={prefix === "" ? "page" : undefined}
        className="breadcrumb-button"
        onClick={() => onFolderSelect("")}
        type="button"
      >
        Root
      </button>
      {breadcrumbPrefixes(prefix).map((breadcrumb) => (
        <span className="breadcrumb-segment" key={breadcrumb.prefix}>
          <span aria-hidden="true">/</span>
          <button
            aria-current={breadcrumb.prefix === prefix ? "page" : undefined}
            className="breadcrumb-button"
            onClick={() => onFolderSelect(breadcrumb.prefix)}
            type="button"
          >
            {breadcrumb.label}
          </button>
        </span>
      ))}
    </nav>
    {isLoading ? (
      <div aria-label="Loading files" className="file-browser-loading" role="status">
        <span />
        <span />
        <span />
      </div>
    ) : error !== null ? (
      <div className="error-state compact-state">
        <strong>Catalog browsing failed</strong>
        <span>{error.message}</span>
        <button className="button secondary" onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    ) : entries.length === 0 ? (
      <div className="empty-state compact-state">
        <FolderOpen aria-hidden="true" size={28} />
        <strong>This folder is empty</strong>
        <span>Upload an object below to add protected content.</span>
      </div>
    ) : (
      <>
        <ul className="data-list file-entry-list">
          {entries.map((entry) => {
            const name = nameOf(entry.path);
            return (
              <li className="data-row file-entry-row" key={`${entry.kind}:${entry.path}`}>
                <button
                  aria-label={name}
                  className="file-entry-button"
                  data-selected={entry.kind === "file" && entry.path === selectedPath}
                  onClick={() =>
                    entry.kind === "folder"
                      ? onFolderSelect(`${entry.path}/`)
                      : onFileSelect(entry.path)
                  }
                  type="button"
                >
                  <span className="action-icon">
                    {entry.kind === "folder" ? (
                      <Folder aria-hidden="true" size={18} />
                    ) : (
                      <FileText aria-hidden="true" size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {entry.kind === "folder"
                        ? "Folder"
                        : `${formatBytes(entry.size)} · ${new Date(entry.createdAt).toLocaleString()}`}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {hasNextPage ? (
          <button
            className="button secondary load-more"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
            type="button"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </>
    )}
  </section>
);
