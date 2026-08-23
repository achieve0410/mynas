import { CheckCheck, Download, Plus, SquareX, Trash2, X } from "lucide-react";
import type { RefObject } from "react";

type PhotoSelectionToolbarProps = {
  readonly albumTrigger: RefObject<HTMLButtonElement | null>;
  readonly allVisibleSelected: boolean;
  readonly deleteTrigger: RefObject<HTMLButtonElement | null>;
  readonly isDownloading: boolean;
  readonly onClear: () => void;
  readonly onCreateAlbum: () => void;
  readonly onDelete: () => void;
  readonly onDownload: () => void;
  readonly onToggleVisible: () => void;
  readonly selectedCount: number;
  readonly visibleCount: number;
  readonly visibleSelectedCount: number;
};

export const PhotoSelectionToolbar = ({
  albumTrigger,
  allVisibleSelected,
  deleteTrigger,
  isDownloading,
  onClear,
  onCreateAlbum,
  onDelete,
  onDownload,
  onToggleVisible,
  selectedCount,
  visibleCount,
  visibleSelectedCount,
}: PhotoSelectionToolbarProps) => {
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;

  return (
    <section
      aria-label="Photo selection controls"
      className="photo-selection-toolbar"
      data-has-selection={selectedCount > 0}
    >
      <div className="photo-selection-status" data-testid="photo-selection-summary">
        <span className="eyebrow">Selection</span>
        <strong>
          {selectedCount} selected
          {hiddenSelectedCount > 0 ? ` · ${hiddenSelectedCount} outside current results` : ""}
        </strong>
        <span>
          {visibleCount === 0
            ? "No visible photos to select."
            : `${visibleSelectedCount} of ${visibleCount} visible selected.`}
        </span>
      </div>
      <div className="button-row photo-selection-actions">
        <button
          className="button secondary"
          data-testid="photo-toggle-visible"
          disabled={visibleCount === 0}
          onClick={onToggleVisible}
          type="button"
        >
          {allVisibleSelected ? <SquareX size={16} /> : <CheckCheck size={16} />}
          {allVisibleSelected ? "Deselect visible" : "Select visible"}
        </button>
        <button
          className="button quiet"
          data-testid="photo-clear-selection"
          disabled={selectedCount === 0}
          onClick={onClear}
          type="button"
        >
          <X size={16} /> Clear selection
        </button>
        <button
          className="button secondary"
          data-testid="create-album"
          disabled={selectedCount === 0}
          onClick={onCreateAlbum}
          ref={albumTrigger}
          type="button"
        >
          <Plus size={16} /> Album
        </button>
        <button
          className="button secondary"
          disabled={selectedCount === 0 || isDownloading}
          onClick={onDownload}
          type="button"
        >
          <Download size={16} /> Download selected
        </button>
        <button
          className="button danger-text photo-delete-selected"
          data-testid="photo-delete-selected"
          disabled={selectedCount === 0}
          onClick={onDelete}
          ref={deleteTrigger}
          type="button"
        >
          <Trash2 size={16} /> Delete selected
        </button>
      </div>
    </section>
  );
};
