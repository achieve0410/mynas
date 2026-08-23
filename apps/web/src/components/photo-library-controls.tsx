import { RefreshCw, Search } from "lucide-react";

import type { LibraryRefreshState } from "./file-library-controls";

type PhotoDensity = "large" | "medium" | "small";
type PhotoSort = "filename" | "newest" | "oldest" | "type";

type PhotoLibraryControlsProps = {
  readonly density: PhotoDensity;
  readonly onDensityChange: (value: PhotoDensity) => void;
  readonly onRefresh: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly onSortChange: (value: PhotoSort) => void;
  readonly refreshState: LibraryRefreshState;
  readonly search: string;
  readonly sort: PhotoSort;
};

export const PhotoLibraryControls = ({
  density,
  onDensityChange,
  onRefresh,
  onSearchChange,
  onSortChange,
  refreshState,
  search,
  sort,
}: PhotoLibraryControlsProps) => (
  <section aria-label="Photo discovery controls" className="library-toolbar">
    <label className="library-search">
      <Search aria-hidden="true" size={18} />
      <span>Find photos</span>
      <input
        data-testid="photo-search"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search by filename"
        type="search"
        value={search}
      />
    </label>
    <label>
      Sort by
      <select
        data-testid="photo-sort"
        onChange={(event) => {
          const value = event.target.value;
          onSortChange(
            value === "filename" || value === "oldest" || value === "type" ? value : "newest",
          );
        }}
        value={sort}
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="filename">Filename</option>
        <option value="type">File type</option>
      </select>
    </label>
    <fieldset className="density-control">
      <legend>Photo preview size</legend>
      {(["small", "medium", "large"] as const).map((option) => (
        <button
          aria-pressed={density === option}
          className="density-button"
          data-testid={`photo-density-${option}`}
          key={option}
          onClick={() => onDensityChange(option)}
          type="button"
        >
          {option[0]?.toUpperCase()}
          {option.slice(1)}
        </button>
      ))}
    </fieldset>
    <button
      className="button secondary"
      data-testid="refresh-photos"
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
);
