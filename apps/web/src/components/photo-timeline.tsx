import { Check, ImagePlus, Images, Search } from "lucide-react";

import type { Photo } from "../schemas";
import { ProtectedImage } from "./protected-image";

type PhotoTimelineProps = {
  readonly error: Error | null;
  readonly groups: readonly (readonly Photo[])[];
  readonly isPending: boolean;
  readonly onOpen: (photo: Photo, trigger: HTMLElement) => void;
  readonly onRetry: () => void;
  readonly onToggle: (photoId: string, checked: boolean) => void;
  readonly selected: ReadonlySet<string>;
  readonly totalCount: number;
};

const timelineLabel = (date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));

export const PhotoTimeline = ({
  error,
  groups,
  isPending,
  onOpen,
  onRetry,
  onToggle,
  selected,
  totalCount,
}: PhotoTimelineProps) => {
  if (isPending) {
    return (
      <section aria-busy="true" className="loading-state">
        <span className="image-skeleton" />
        <span className="image-skeleton" />
      </section>
    );
  }
  if (error !== null) {
    return (
      <section className="error-state">
        <ImagePlus size={24} />
        <h2>The timeline could not be loaded</h2>
        <p>{error.message}</p>
        <button className="button secondary" onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }
  if (groups.length === 0) {
    return totalCount === 0 ? (
      <section className="empty-state">
        <Images size={30} />
        <h2>Your timeline is ready</h2>
        <p>Upload JPEG, PNG, or HEIC originals to create lightweight WebP previews.</p>
      </section>
    ) : (
      <section className="empty-state">
        <Search size={30} />
        <h2>No photos match this search</h2>
        <p>Try a different filename or clear the search field.</p>
      </section>
    );
  }
  return groups.map((group) => (
    <section className="timeline" key={group[0]?.capturedAt}>
      <header className="timeline-date">
        <span>{timelineLabel(group[0]?.capturedAt ?? new Date().toISOString())}</span>
        <small>{group.length} originals</small>
      </header>
      <div className="photo-grid" data-testid="photo-grid">
        {group.map((photo) => (
          <div
            className="photo-item"
            key={photo.id}
            style={{
              aspectRatio: `${photo.width} / ${photo.height}`,
              flexGrow: photo.width / photo.height,
            }}
          >
            <button
              aria-label={`Open ${photo.filename}`}
              className="photo-button"
              data-testid={`photo-${photo.id}`}
              onClick={(event) => onOpen(photo, event.currentTarget)}
              title={photo.filename}
              type="button"
            >
              <ProtectedImage alt={photo.filename} path={`/api/v1/photos/${photo.id}/preview`} />
              <span className="photo-caption">{photo.filename}</span>
            </button>
            <label className="photo-select">
              <input
                aria-label={`Select ${photo.filename}`}
                checked={selected.has(photo.id)}
                data-testid={`photo-select-${photo.id}`}
                onChange={(event) => onToggle(photo.id, event.target.checked)}
                type="checkbox"
              />
              <span>
                <Check size={14} />
              </span>
            </label>
          </div>
        ))}
      </div>
    </section>
  ));
};
