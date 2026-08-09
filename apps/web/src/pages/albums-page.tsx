import { useQuery } from "@tanstack/react-query";
import { Album as AlbumIcon, Images, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { api } from "../api";
import { AlbumDialog } from "../components/album-dialog";
import { ProtectedImage } from "../components/protected-image";

export const AlbumsPage = () => {
  const albums = useQuery({ queryFn: api.listAlbums, queryKey: ["albums"] });
  const [creating, setCreating] = useState(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const closeDialog = useCallback((_created: boolean) => {
    setCreating(false);
    createTrigger.current?.focus();
  }, []);

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Curated originals</span>
          <h1>Albums</h1>
          <p>Small collections that never move or duplicate the protected original.</p>
        </div>
        <button
          className="button primary"
          onClick={() => setCreating(true)}
          ref={createTrigger}
          type="button"
        >
          <Plus size={16} /> Create album
        </button>
      </header>
      {albums.isPending ? (
        <section aria-busy="true" className="loading-state">
          <span className="image-skeleton" />
          <span className="image-skeleton" />
        </section>
      ) : albums.isError ? (
        <section className="error-state">
          <AlbumIcon size={28} />
          <h2>Albums could not be loaded</h2>
          <p>{albums.error.message}</p>
          <button className="button secondary" onClick={() => albums.refetch()} type="button">
            Retry
          </button>
        </section>
      ) : albums.data?.length ? (
        <div className="album-grid">
          {albums.data.map((album) => (
            <article className="album-card" key={album.id}>
              <div className="album-cover">
                {album.photos[0] === undefined ? (
                  <Images aria-hidden="true" size={28} />
                ) : (
                  <div data-testid={`album-photo-${album.photos[0].id}`}>
                    <ProtectedImage
                      alt={album.photos[0].filename}
                      path={`/api/v1/photos/${album.photos[0].id}/preview`}
                    />
                  </div>
                )}
              </div>
              <div className="album-meta">
                <div>
                  <h2>{album.name}</h2>
                  <span>
                    <strong data-testid="album-photo-count">{album.photos.length}</strong>{" "}
                    {album.photos.length === 1 ? "photo" : "photos"}
                  </span>
                </div>
                <AlbumIcon aria-hidden="true" size={18} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <AlbumIcon size={28} />
          <h2>No albums yet</h2>
          <p>Select photos in the timeline and create your first collection.</p>
        </section>
      )}
      {creating ? <AlbumDialog onClose={closeDialog} photoIds={[]} /> : null}
    </div>
  );
};
