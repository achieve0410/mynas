import { Share2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDownloadTransfer } from "../hooks/use-download-transfer";
import type { Photo } from "../schemas";
import { PhotoDetails } from "./photo-details";
import { ProtectedImage } from "./protected-image";

type PhotoLightboxProps = {
  readonly albumNames: readonly string[];
  readonly index: number;
  readonly onClose: () => void;
  readonly onNext: (() => void) | undefined;
  readonly onPrevious: (() => void) | undefined;
  readonly photo: Photo;
  readonly total: number;
};

export const PhotoLightbox = ({
  albumNames,
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
  const pointers = useRef(new Map<number, { readonly x: number; readonly y: number }>());
  const pinchDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef(1);
  const pinching = useRef(false);
  const previous = useRef(onPrevious);
  const [zoom, setZoom] = useState(1);
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);
  const originalDownload = useDownloadTransfer();
  next.current = onNext;
  previous.current = onPrevious;

  const move = useCallback(
    (nextDirection: "next" | "previous", callback: (() => void) | undefined): void => {
      setDirection(nextDirection);
      setZoom(1);
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
      delivery: "share",
      filename: photo.filename,
      id: `original:${photo.id}`,
      kind: "photo",
      label: photo.filename,
      path: `/api/v1/photos/${photo.id}/original`,
    });
  };
  const ratioDivisor = (left: number, right: number): number => {
    let a = left;
    let b = right;
    while (b !== 0) {
      [a, b] = [b, a % b];
    }
    return a;
  };
  const divisor = ratioDivisor(photo.width, photo.height);
  const ratio = `${photo.width / divisor}:${photo.height / divisor}`;
  const pointerDistance = (): number | null => {
    const [first, second] = [...pointers.current.values()];
    return first === undefined || second === undefined
      ? null
      : Math.hypot(second.x - first.x, second.y - first.y);
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
        <div className="lightbox-toolbar-row" data-testid="photo-viewer-primary-row">
          <div className="lightbox-identity">
            <strong data-testid="photo-viewer-filename" title={photo.filename}>
              {photo.filename}
            </strong>
            <span className="mono lightbox-dimensions" data-testid="photo-viewer-dimensions">
              {photo.width}×{photo.height} ({ratio})
            </span>
          </div>
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
        <div className="lightbox-toolbar-row" data-testid="photo-viewer-secondary-row">
          <span className="mono lightbox-position" data-testid="photo-viewer-position">
            {index + 1} / {total}
          </span>
          <button
            className="button secondary"
            data-testid="download-original"
            onClick={downloadOriginal}
            type="button"
          >
            <Share2 size={16} /> Save photo
          </button>
        </div>
      </header>
      <div
        className="lightbox-stage"
        data-testid="photo-lightbox-stage"
        onPointerDownCapture={(event) => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 1) {
            pointerStart.current = { x: event.clientX, y: event.clientY };
          } else if (pointers.current.size === 2) {
            pinching.current = true;
            pointerStart.current = null;
            pinchDistance.current = pointerDistance();
            pinchStartZoom.current = zoom;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMoveCapture={(event) => {
          if (!pointers.current.has(event.pointerId)) {
            return;
          }
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const distance = pointerDistance();
          if (distance !== null && pinchDistance.current !== null) {
            setZoom(
              Math.min(4, Math.max(1, pinchStartZoom.current * (distance / pinchDistance.current))),
            );
          }
        }}
        onPointerUpCapture={(event) => {
          pointers.current.delete(event.pointerId);
          if (pinching.current) {
            pointerStart.current = null;
            pinchDistance.current = null;
            if (pointers.current.size === 0) {
              pinching.current = false;
            }
            return;
          }
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
        onPointerCancelCapture={(event) => {
          pointers.current.delete(event.pointerId);
          pointerStart.current = null;
          pinchDistance.current = null;
          if (pointers.current.size === 0) {
            pinching.current = false;
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
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </div>
      <PhotoDetails albumNames={albumNames} key={photo.id} photo={photo} />
    </dialog>
  );
};
