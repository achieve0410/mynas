import { ArrowLeft, ArrowRight, Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDownloadTransfer } from "../hooks/use-download-transfer";
import type { Photo } from "../schemas";
import { ProtectedImage } from "./protected-image";
import { TransferProgressList } from "./transfer-progress-list";

type PhotoLightboxProps = {
  readonly index: number;
  readonly onClose: () => void;
  readonly onNext: (() => void) | undefined;
  readonly onPrevious: (() => void) | undefined;
  readonly photo: Photo;
  readonly total: number;
};

export const PhotoLightbox = ({
  index,
  onClose,
  onNext,
  onPrevious,
  photo,
  total,
}: PhotoLightboxProps) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef(onNext);
  const pointerStart = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const previous = useRef(onPrevious);
  const [zoom, setZoom] = useState(100);
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);
  const originalDownload = useDownloadTransfer();
  next.current = onNext;
  previous.current = onPrevious;

  const move = useCallback(
    (nextDirection: "next" | "previous", callback: (() => void) | undefined): void => {
      setDirection(nextDirection);
      setZoom(100);
      callback?.();
    },
    [],
  );

  useEffect(() => {
    dialog.current?.showModal();
    closeButton.current?.focus();
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        move("previous", previous.current);
      }
      if (event.key === "ArrowRight") {
        move("next", next.current);
      }
    };
    window.addEventListener("keydown", navigate);
    return () => {
      window.removeEventListener("keydown", navigate);
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, [move]);

  const closeDialog = () => {
    dialog.current?.close();
    onClose();
  };

  const downloadOriginal = async () => {
    await originalDownload.download({
      filename: photo.filename,
      id: `original:${photo.id}`,
      label: photo.filename,
      path: `/api/v1/photos/${photo.id}/original`,
    });
  };

  return (
    <dialog
      aria-label={`Photo viewer for ${photo.filename}`}
      className="lightbox"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      ref={dialog}
    >
      <header className="lightbox-toolbar">
        <div>
          <strong data-testid="photo-viewer-filename" title={photo.filename}>
            {photo.filename}
          </strong>
          <span className="mono">
            {photo.width} x {photo.height}
          </span>
          <span className="mono lightbox-position" data-testid="photo-viewer-position">
            {index + 1} / {total}
          </span>
        </div>
        <div className="button-row">
          <button
            aria-label="Previous photo"
            className="button icon-button quiet"
            disabled={onPrevious === undefined}
            onClick={() => {
              move("previous", onPrevious);
            }}
            type="button"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            aria-label="Next photo"
            className="button icon-button quiet"
            data-testid="photo-next"
            disabled={onNext === undefined}
            onClick={() => {
              move("next", onNext);
            }}
            type="button"
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="button secondary"
            data-testid="download-original"
            disabled={originalDownload.isDownloading}
            onClick={downloadOriginal}
            type="button"
          >
            <Download size={16} /> Download original
          </button>
          <button
            aria-label="Close photo viewer"
            className="button icon-button quiet"
            onClick={closeDialog}
            ref={closeButton}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div
        className="lightbox-stage"
        data-testid="photo-lightbox-stage"
        onPointerDownCapture={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUpCapture={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (start === null) {
            return;
          }
          const horizontal = event.clientX - start.x;
          const vertical = event.clientY - start.y;
          if (Math.abs(horizontal) < 64 || Math.abs(horizontal) <= Math.abs(vertical)) {
            return;
          }
          if (horizontal < 0) {
            move("next", onNext);
          } else {
            move("previous", onPrevious);
          }
        }}
      >
        <div
          className="lightbox-image-frame"
          data-direction={direction ?? "initial"}
          key={photo.id}
        >
          <ProtectedImage
            alt={photo.filename}
            draggable={false}
            path={`/api/v1/photos/${photo.id}/preview`}
            style={{ transform: `scale(${zoom / 100})` }}
          />
        </div>
      </div>
      <details className="lightbox-meta" open>
        <summary>Protected original</summary>
        <dl className="definition-list compact">
          <div>
            <dt>Imported</dt>
            <dd>{new Date(photo.importedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="mono checksum">{photo.checksum}</dd>
          </div>
        </dl>
        <TransferProgressList kind="photo" operation="download" rows={originalDownload.rows} />
      </details>
      <fieldset className="lightbox-zoom">
        <legend className="sr-only">Photo zoom</legend>
        <button
          aria-label="Zoom out"
          className="button icon-button quiet"
          disabled={zoom <= 50}
          onClick={() => setZoom((value) => Math.max(50, value - 25))}
          type="button"
        >
          <Minus size={18} />
        </button>
        <button
          aria-label="Reset zoom"
          className="button secondary zoom-value"
          data-testid="photo-zoom-value"
          onClick={() => setZoom(100)}
          type="button"
        >
          <RotateCcw size={15} /> {zoom}%
        </button>
        <button
          aria-label="Zoom in"
          className="button icon-button quiet"
          data-testid="photo-zoom-in"
          disabled={zoom >= 300}
          onClick={() => setZoom((value) => Math.min(300, value + 25))}
          type="button"
        >
          <Plus size={18} />
        </button>
      </fieldset>
    </dialog>
  );
};
