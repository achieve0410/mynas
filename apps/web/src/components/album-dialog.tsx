import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";

type AlbumDialogProps = {
  readonly onClose: (created: boolean) => void;
  readonly photoIds: readonly string[];
};

export const AlbumDialog = ({ onClose, photoIds }: AlbumDialogProps) => {
  const [name, setName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const closeDialog = (created: boolean) => {
    dialog.current?.close();
    onClose(created);
  };
  const create = useMutation({
    mutationFn: async () => {
      const album = await api.createAlbum(name);
      for (const photoId of photoIds) {
        await api.addPhotoToAlbum(album.id, photoId);
      }
      return album;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["albums"] });
      closeDialog(true);
    },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await create.mutateAsync();
  };

  useEffect(() => {
    dialog.current?.showModal();
    nameInput.current?.focus();
    return () => {
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, []);

  return (
    <dialog
      aria-label="Create album"
      className="modal-backdrop"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog(false);
      }}
      ref={dialog}
    >
      <form className="modal-panel" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow">New collection</span>
            <h2>Create an album</h2>
          </div>
          <button
            aria-label="Close album dialog"
            className="button icon-button quiet"
            onClick={() => closeDialog(false)}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <label>
          Album name
          <input
            data-testid="album-name"
            onChange={(event) => setName(event.target.value)}
            ref={nameInput}
            required
            value={name}
          />
        </label>
        <p className="form-note">
          {photoIds.length} selected {photoIds.length === 1 ? "photo" : "photos"} will be added.
        </p>
        {create.isError ? (
          <p aria-live="polite" className="form-error">
            {create.error.message}
          </p>
        ) : null}
        <button
          className="button primary"
          data-testid="album-submit"
          disabled={create.isPending}
          type="submit"
        >
          {create.isPending ? "Creating..." : "Create album"}
        </button>
      </form>
    </dialog>
  );
};
