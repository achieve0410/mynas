import { Database, Download, RefreshCw, Search, ShieldCheck } from "lucide-react";

export type LibraryRefreshState = "complete" | "failed" | "idle" | "refreshing";

type FilePageHeaderProps = {
  readonly onDownloadSelected: () => void;
  readonly selectionCount: number;
};

export const FilePageHeader = ({ onDownloadSelected, selectionCount }: FilePageHeaderProps) => (
  <header className="page-heading">
    <div>
      <span className="eyebrow">Verified recovery workspace</span>
      <h1>Files</h1>
      <p>Browse cataloged objects, inspect immutable versions, and recover protected bytes.</p>
    </div>
    <div className="button-row">
      <button
        className="button secondary"
        disabled={selectionCount === 0}
        onClick={onDownloadSelected}
        type="button"
      >
        <Download aria-hidden="true" size={16} /> Download selected
      </button>
      <span className="action-icon large">
        <ShieldCheck aria-hidden="true" size={24} />
      </span>
    </div>
  </header>
);

type FileLibraryControlsProps = {
  readonly onRefresh: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSortChange: (value: "name" | "type") => void;
  readonly onVolumeChange: (value: string) => void;
  readonly refreshState: LibraryRefreshState;
  readonly search: string;
  readonly sort: "name" | "type";
  readonly volumeId: string;
  readonly volumes: readonly { readonly id: string }[];
  readonly volumesLoading: boolean;
};

export const FileLibraryControls = ({
  onRefresh,
  onSearchChange,
  onSortChange,
  onVolumeChange,
  refreshState,
  search,
  sort,
  volumeId,
  volumes,
  volumesLoading,
}: FileLibraryControlsProps) => (
  <>
    <section className="file-volume-bar">
      <label>
        Volume
        <select
          disabled={volumesLoading || volumes.length === 0}
          onChange={(event) => onVolumeChange(event.target.value)}
          value={volumeId}
        >
          {volumes.map((volume) => (
            <option key={volume.id} value={volume.id}>
              {volume.id}
            </option>
          ))}
        </select>
      </label>
      <div className="status-strip">
        <Database aria-hidden="true" size={18} />
        <div>
          <strong>Catalog-first browsing</strong>
          <span>Folders and history remain visible without scanning replica storage.</span>
        </div>
      </div>
    </section>

    <section aria-label="File discovery controls" className="library-toolbar">
      <label className="library-search">
        <Search aria-hidden="true" size={18} />
        <span>Find files or folders</span>
        <input
          data-testid="file-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search this folder"
          type="search"
          value={search}
        />
      </label>
      <label>
        Sort by
        <select
          data-testid="file-sort"
          onChange={(event) => onSortChange(event.target.value === "type" ? "type" : "name")}
          value={sort}
        >
          <option value="name">Name</option>
          <option value="type">Folders, then files</option>
        </select>
      </label>
      <button
        className="button secondary"
        data-testid="refresh-files"
        disabled={refreshState === "refreshing"}
        onClick={onRefresh}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={16} />
        {refreshState === "refreshing"
          ? "Refreshing..."
          : refreshState === "failed"
            ? "Refresh failed"
            : "Refresh"}
      </button>
    </section>
  </>
);
