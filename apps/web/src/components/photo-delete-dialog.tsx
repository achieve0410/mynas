import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderMinus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { Album, Photo } from "../schemas";

type PhotoDeleteDialogProps = {
  readonly album?: Pick<Album, "id" | "name"> | undefined;
  readonly onClose: () => void;
  readonly onDeleted: (scope: "album" | "library") => void;
  readonly photos: readonly Photo[];
};

export const PhotoDeleteDialog = ({
  album,
  onClose,
  onDeleted,
  photos,
}: PhotoDeleteDialogProps) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const safeActionButton = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const [confirmingLibrary, setConfirmingLibrary] = useState(album === undefined);
  const countLabel = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;

  const refreshLibraries = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["albums"] }),
      queryClient.invalidateQueries({ queryKey: ["photos"] }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
    ]);
  };
  const finish = async (scope: "album" | "library"): Promise<void> => {
    await refreshLibraries();
    dialog.current?.close();
    onDeleted(scope);
  };
  const removeFromAlbum = useMutation({
    mutationFn: async () => {
      const photo = photos[0];
      if (album === undefined || photo === undefined || photos.length !== 1) {
        throw new Error("one album photo is required");
      }
      await api.removePhotoFromAlbum(album.id, photo.id);
    },
    onSuccess: async () => finish("album"),
  });
  const deleteFromLibrary = useMutation({
    mutationFn: async () => {
      const failures: unknown[] = [];
      for (const photo of photos) {
        try {
          await api.deletePhoto(photo.id);
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error("photo deletion failed"));
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `${photos.length - failures.length} of ${photos.length} deleted; ${failures.length} failed. The remaining photos stay selected.`,
          { cause: failures[0] },
        );
      }
    },
    onError: refreshLibraries,
    onSuccess: async () => finish("library"),
  });
  const busy = removeFromAlbum.isPending || deleteFromLibrary.isPending;
  const error = removeFromAlbum.error ?? deleteFromLibrary.error;

  useEffect(() => {
    dialog.current?.showModal();
    closeButton.current?.focus();
    return () => {
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, []);
  useEffect(() => {
    if (confirmingLibrary) {
      safeActionButton.current?.focus();
    } else {
      closeButton.current?.focus();
    }
  }, [confirmingLibrary]);

  const closeDialog = (): void => {
    if (busy) {
      return;
    }
    dialog.current?.close();
    onClose();
  };

  return (
    <dialog
      aria-label={
        confirmingLibrary ? `Delete ${countLabel}?` : `Manage ${photos[0]?.filename ?? "photo"}`
      }
      className="modal-backdrop"
      data-testid="photo-delete-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      ref={dialog}
    >
      <section className="modal-panel photo-delete-panel">
        <header>
          <div>
            <span className="eyebrow">{album === undefined ? "Library deletion" : album.name}</span>
            <h2>{confirmingLibrary ? `Delete ${countLabel}?` : "Manage photo"}</h2>
          </div>
          <button
            aria-label="Close photo deletion"
            className="button icon-button quiet"
            data-testid="photo-delete-close"
            disabled={busy}
            onClick={closeDialog}
            ref={closeButton}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        {confirmingLibrary ? (
          <div className="photo-delete-confirmation">
            <div className="photo-delete-warning" data-testid="photo-delete-library-warning">
              <Trash2 aria-hidden="true" size={20} />
              <p>
                {album === undefined
                  ? `This removes ${countLabel} from Photos and all albums.`
                  : `This removes ${photos[0]?.filename ?? "this photo"} from Photos and every album.`}{" "}
                Current originals and previews become unavailable. Storage history may retain
                recoverable versions.
              </p>
            </div>
            {error === null ? null : (
              <p aria-live="polite" className="form-error">
                {error.message}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                data-testid="photo-delete-safe-action"
                disabled={busy}
                onClick={album === undefined ? closeDialog : () => setConfirmingLibrary(false)}
                ref={safeActionButton}
                type="button"
              >
                {album === undefined ? "Cancel" : "Back"}
              </button>
              <button
                className="button danger"
                data-testid="photo-delete-library-confirm"
                disabled={busy}
                onClick={() => deleteFromLibrary.mutate()}
                type="button"
              >
                <Trash2 size={16} />
                {deleteFromLibrary.isPending ? "Deleting..." : "Delete from library"}
              </button>
            </div>
          </div>
        ) : (
          <div className="photo-delete-options">
            <p className="form-note">
              Choose whether this photo leaves only <strong>{album?.name}</strong> or your entire
              protected library.
            </p>
            <section className="photo-delete-option">
              <div>
                <strong>Remove from this album</strong>
                <p>The photo stays in Photos and any other albums.</p>
              </div>
              <button
                className="button secondary"
                data-testid="photo-remove-from-album"
                disabled={busy}
                onClick={() => removeFromAlbum.mutate()}
                type="button"
              >
                <FolderMinus size={16} /> Remove from album
              </button>
            </section>
            <section className="photo-delete-option danger-option">
              <div>
                <strong>Delete from library</strong>
                <p>Continue to a final warning before deleting this photo everywhere.</p>
              </div>
              <button
                className="button danger-text"
                data-testid="photo-delete-library-start"
                disabled={busy}
                onClick={() => setConfirmingLibrary(true)}
                type="button"
              >
                <Trash2 size={16} /> Delete from library
              </button>
            </section>
            {error === null ? null : (
              <p aria-live="polite" className="form-error">
                {error.message}
              </p>
            )}
          </div>
        )}
      </section>
    </dialog>
  );
};
