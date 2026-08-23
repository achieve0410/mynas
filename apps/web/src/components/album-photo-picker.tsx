import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import type { Album } from "../schemas";
import { ProtectedImage } from "./protected-image";

type AlbumPhotoPickerProps = {
  readonly album: Album;
  readonly onClose: (updated: boolean) => void;
};

export const AlbumPhotoPicker = ({ album, onClose }: AlbumPhotoPickerProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const photos = useQuery({ queryFn: api.listPhotos, queryKey: ["photos"] });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const currentPhotoIds = useMemo(
    () => new Set(album.photos.map((photo) => photo.id)),
    [album.photos],
  );
  const candidates = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return (photos.data ?? []).filter(
      (photo) =>
        !currentPhotoIds.has(photo.id) &&
        photo.filename.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [currentPhotoIds, photos.data, search]);

  const closeDialog = (updated: boolean): void => {
    dialog.current?.close();
    onClose(updated);
  };
  const addPhotos = useMutation({
    mutationFn: async () => {
      for (const photoId of selected) {
        await api.addPhotoToAlbum(album.id, photoId);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["albums"] });
      closeDialog(true);
    },
  });

  useEffect(() => {
    dialog.current?.showModal();
    searchInput.current?.focus();
    return () => {
      if (dialog.current?.open) {
        dialog.current.close();
      }
    };
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await addPhotos.mutateAsync();
  };

  return (
    <dialog
      aria-label={`Add existing photos to ${album.name}`}
      className="modal-backdrop"
      data-testid="album-existing-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog(false);
      }}
      ref={dialog}
    >
      <form className="modal-panel album-picker-panel" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow">Protected library</span>
            <h2>Add existing photos</h2>
          </div>
          <button
            aria-label="Close existing photo picker"
            className="button icon-button quiet"
            onClick={() => closeDialog(false)}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <label className="search-field">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">Search existing photos</span>
          <input
            data-testid="album-existing-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search filenames"
            ref={searchInput}
            type="search"
            value={search}
          />
        </label>
        <div className="album-picker-results">
          {photos.isPending ? (
            <section aria-busy="true" className="loading-state">
              <span className="image-skeleton" />
              <span className="image-skeleton" />
            </section>
          ) : photos.isError ? (
            <section className="error-state">
              <ImagePlus size={24} />
              <h3>Photos could not be loaded</h3>
              <p>{photos.error.message}</p>
              <button className="button secondary" onClick={() => photos.refetch()} type="button">
                Retry
              </button>
            </section>
          ) : candidates.length === 0 ? (
            <section className="empty-state compact" data-testid="album-existing-empty">
              <ImagePlus size={24} />
              <h3>No photos to add</h3>
              <p>Every matching photo is already in this album.</p>
            </section>
          ) : (
            <div className="album-picker-grid">
              {candidates.map((photo) => (
                <label className="album-picker-item" key={photo.id}>
                  <input
                    checked={selected.has(photo.id)}
                    data-testid={`album-existing-select-${photo.id}`}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(photo.id);
                        } else {
                          next.delete(photo.id);
                        }
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="album-picker-preview">
                    <ProtectedImage
                      alt={photo.filename}
                      path={`/api/v1/photos/${photo.id}/preview`}
                    />
                    <span className="album-picker-check">
                      <Check size={14} />
                    </span>
                  </span>
                  <span title={photo.filename}>{photo.filename}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {addPhotos.isError ? (
          <p aria-live="polite" className="form-error">
            {addPhotos.error.message}
          </p>
        ) : null}
        <footer className="modal-actions">
          <button className="button secondary" onClick={() => closeDialog(false)} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            data-testid="album-existing-submit"
            disabled={selected.size === 0 || addPhotos.isPending}
            type="submit"
          >
            {addPhotos.isPending
              ? "Adding..."
              : `Add ${selected.size} ${selected.size === 1 ? "photo" : "photos"}`}
          </button>
        </footer>
      </form>
    </dialog>
  );
};
