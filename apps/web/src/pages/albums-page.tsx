import { useQuery } from "@tanstack/react-query";
import { Album as AlbumIcon, Images, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { AlbumDetail } from "../components/album-detail";
import { AlbumDialog } from "../components/album-dialog";
import { ProtectedImage } from "../components/protected-image";

export const AlbumsPage = () => {
  const albums = useQuery({ queryFn: api.listAlbums, queryKey: ["albums"] });
  const [creating, setCreating] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const albumTriggers = useRef(new Map<string, HTMLButtonElement>());
  const returnAlbumId = useRef<string | null>(null);
  const closeDialog = useCallback((_created: boolean) => {
    setCreating(false);
    createTrigger.current?.focus();
  }, []);
  useEffect(() => {
    if (selectedAlbumId === null && returnAlbumId.current !== null) {
      albumTriggers.current.get(returnAlbumId.current)?.focus();
    }
  }, [selectedAlbumId]);

  const selectedAlbum = albums.data?.find((album) => album.id === selectedAlbumId);
  if (selectedAlbum !== undefined) {
    return <AlbumDetail album={selectedAlbum} onBack={() => setSelectedAlbumId(null)} />;
  }

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
              <button
                className="album-card-button"
                data-testid={`album-open-${album.id}`}
                onClick={() => {
                  returnAlbumId.current = album.id;
                  setSelectedAlbumId(album.id);
                }}
                ref={(element) => {
                  if (element === null) {
                    albumTriggers.current.delete(album.id);
                  } else {
                    albumTriggers.current.set(album.id, element);
                  }
                }}
                type="button"
              >
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
              </button>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <AlbumIcon size={28} />
          <h2>No albums yet</h2>
          <p>Create an album, then add protected photos or upload new originals inside it.</p>
        </section>
      )}
      {creating ? <AlbumDialog onClose={closeDialog} photoIds={[]} /> : null}
    </div>
  );
};
