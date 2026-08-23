import { ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useRef } from "react";

export type PhotoReviewStatus =
  | "already-protected"
  | "checking"
  | "new"
  | "oversize"
  | "unsupported";

export type PhotoReviewItem = {
  readonly file: File;
  readonly id: string;
  readonly path: string;
  readonly photoId?: string | undefined;
  readonly status: PhotoReviewStatus;
};

type PhotoImportReviewProps = {
  readonly allowProtectedConfirmation?: boolean | undefined;
  readonly error?: string | undefined;
  readonly items: readonly PhotoReviewItem[];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

const VISIBLE_ITEM_LIMIT = 40;
const statusLabel: Readonly<Record<PhotoReviewStatus, string>> = {
  "already-protected": "Already protected",
  checking: "Checking protection",
  new: "New",
  oversize: "Over 25 MiB",
  unsupported: "Unsupported",
};

export const PhotoImportReview = ({
  allowProtectedConfirmation = false,
  error,
  items,
  onCancel,
  onConfirm,
}: PhotoImportReviewProps) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const counts = Object.fromEntries(
    Object.keys(statusLabel).map((status) => [
      status,
      items.filter((item) => item.status === status).length,
    ]),
  ) as Readonly<Record<PhotoReviewStatus, number>>;
  const checking = counts.checking > 0;
  const canConfirm =
    counts.new > 0 || (allowProtectedConfirmation && counts["already-protected"] > 0);
  const confirmLabel =
    counts.new > 0 ? `Upload ${counts.new} new` : `Add ${counts["already-protected"]} protected`;

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    closeButton.current?.focus();
    return () => {
      if (dialog.current?.open) {
        dialog.current.close();
      }
      returnFocus?.focus();
    };
  }, []);

  const cancelReview = (): void => {
    dialog.current?.close();
    onCancel();
  };
  const confirmReview = (): void => {
    dialog.current?.close();
    onConfirm();
  };

  return (
    <dialog
      aria-labelledby="photo-import-review-title"
      aria-modal="true"
      className="photo-import-dialog"
      data-testid="photo-import-review"
      onCancel={(event) => {
        event.preventDefault();
        cancelReview();
      }}
      ref={dialog}
    >
      <div className="photo-import-card">
        <header>
          <div>
            <span className="eyebrow">Before upload</span>
            <h2 id="photo-import-review-title">Review selected photos</h2>
          </div>
          <button
            aria-label="Cancel photo import"
            className="button quiet icon-button"
            onClick={cancelReview}
            ref={closeButton}
            title="Cancel photo import"
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <p className="form-note">
          Exact protected photos stay in your library and will not upload again.
        </p>
        <dl className="photo-import-summary">
          {Object.entries(statusLabel).map(([status, label]) => (
            <div data-review-summary={status} key={status}>
              <dt>{label}</dt>
              <dd>{counts[status as PhotoReviewStatus]}</dd>
            </div>
          ))}
        </dl>
        <ul aria-label="Selected photo review" className="photo-import-items">
          {items.slice(0, VISIBLE_ITEM_LIMIT).map((item) => (
            <li data-review-status={item.status} key={item.id}>
              <span className="mono">{item.path}</span>
              <strong>
                {item.status === "already-protected" ? <ShieldCheck size={15} /> : null}
                {statusLabel[item.status]}
              </strong>
            </li>
          ))}
        </ul>
        {items.length <= VISIBLE_ITEM_LIMIT ? null : (
          <p className="form-note">
            Showing {VISIBLE_ITEM_LIMIT} of {items.length}; all items are included in the counts.
          </p>
        )}
        {error === undefined ? null : (
          <p aria-live="polite" className="form-error">
            {error}
          </p>
        )}
        <footer className="button-row">
          <button className="button quiet" onClick={cancelReview} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            disabled={checking || !canConfirm}
            onClick={confirmReview}
            type="button"
          >
            <Upload size={16} /> {confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
};
