import { ArrowLeft, ArrowRight, Download, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { api } from "../api";
import type { Photo } from "../schemas";
import { ProtectedImage } from "./protected-image";

type PhotoLightboxProps = {
  readonly onClose: () => void;
  readonly onNext: (() => void) | undefined;
  readonly onPrevious: (() => void) | undefined;
  readonly photo: Photo;
};

export const PhotoLightbox = ({ onClose, onNext, onPrevious, photo }: PhotoLightboxProps) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    closeButton.current?.focus();
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        onPrevious?.();
      }
      if (event.key === "ArrowRight") {
        onNext?.();
      }
    };
    window.addEventListener("keydown", navigate);
    return () => {
      window.removeEventListener("keydown", navigate);
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, [onNext, onPrevious]);

  const closeDialog = () => {
    dialog.current?.close();
    onClose();
  };

  const downloadOriginal = async () => {
    const blob = await api.download(`/api/v1/photos/${photo.id}/original`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = photo.filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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
          <strong title={photo.filename}>{photo.filename}</strong>
          <span className="mono">
            {photo.width} x {photo.height}
          </span>
        </div>
        <div className="button-row">
          <button
            aria-label="Previous photo"
            className="button icon-button quiet"
            disabled={onPrevious === undefined}
            onClick={onPrevious}
            type="button"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            aria-label="Next photo"
            className="button icon-button quiet"
            disabled={onNext === undefined}
            onClick={onNext}
            type="button"
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="button secondary"
            data-testid="download-original"
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
      <div className="lightbox-stage">
        <ProtectedImage alt={photo.filename} path={`/api/v1/photos/${photo.id}/preview`} />
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
      </details>
    </dialog>
  );
};
