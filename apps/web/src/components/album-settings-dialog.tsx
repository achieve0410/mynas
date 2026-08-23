import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { Album } from "../schemas";

type AlbumSettingsDialogProps = {
  readonly album: Album;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
};

export const AlbumSettingsDialog = ({ album, onClose, onDeleted }: AlbumSettingsDialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [name, setName] = useState(album.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const closeDialog = (): void => {
    dialog.current?.close();
    onClose();
  };
  const rename = useMutation({
    mutationFn: () => api.updateAlbum(album.id, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["albums"] });
      closeDialog();
    },
  });
  const deleteAlbum = useMutation({
    mutationFn: () => api.deleteAlbum(album.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["albums"] });
      dialog.current?.close();
      onDeleted();
    },
  });

  useEffect(() => {
    dialog.current?.showModal();
    nameInput.current?.focus();
    nameInput.current?.select();
    return () => {
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await rename.mutateAsync();
  };

  return (
    <dialog
      aria-label={`Album settings for ${album.name}`}
      className="modal-backdrop"
      data-testid="album-settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      ref={dialog}
    >
      <form className="modal-panel album-settings-panel" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow">Album settings</span>
            <h2>Manage album</h2>
          </div>
          <button
            aria-label="Close album settings"
            className="button icon-button quiet"
            onClick={closeDialog}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <label>
          Album name
          <input
            data-testid="album-edit-name"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            ref={nameInput}
            required
            value={name}
          />
        </label>
        {rename.isError ? (
          <p aria-live="polite" className="form-error">
            {rename.error.message}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="button secondary" onClick={closeDialog} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            data-testid="album-rename-submit"
            disabled={rename.isPending || name.trim() === album.name}
            type="submit"
          >
            {rename.isPending ? "Saving..." : "Save name"}
          </button>
        </div>
        <section className="album-danger-zone">
          <div>
            <AlertTriangle aria-hidden="true" size={18} />
            <div>
              <strong>Delete this album</strong>
              <p>The protected photos and originals will not be deleted.</p>
            </div>
          </div>
          {confirmingDelete ? (
            <div className="album-delete-confirmation">
              <p>
                Delete <strong>{album.name}</strong>? Protected photos will stay in your library.
              </p>
              {deleteAlbum.isError ? (
                <p aria-live="polite" className="form-error">
                  {deleteAlbum.error.message}
                </p>
              ) : null}
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setConfirmingDelete(false)}
                  type="button"
                >
                  Keep album
                </button>
                <button
                  className="button danger"
                  data-testid="album-delete-confirm"
                  disabled={deleteAlbum.isPending}
                  onClick={() => deleteAlbum.mutate()}
                  type="button"
                >
                  <Trash2 size={16} />
                  {deleteAlbum.isPending ? "Deleting..." : "Delete album"}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button danger-text"
              data-testid="album-delete-start"
              onClick={() => setConfirmingDelete(true)}
              type="button"
            >
              <Trash2 size={16} /> Delete album
            </button>
          )}
        </section>
      </form>
    </dialog>
  );
};
