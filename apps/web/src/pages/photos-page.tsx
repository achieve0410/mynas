import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Images, Plus, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { AlbumDialog } from "../components/album-dialog";
import { PhotoLightbox } from "../components/photo-lightbox";
import { ProtectedImage } from "../components/protected-image";
import { useVolumeHealth } from "../hooks/use-volume-health";
import type { Photo } from "../schemas";

const timelineLabel = (date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));

const timelineDayKey = (date: string): string => {
  const local = new Date(date);
  return [local.getFullYear(), local.getMonth() + 1, local.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
};

export const PhotosPage = () => {
  const queryClient = useQueryClient();
  const photos = useQuery({ queryFn: api.listPhotos, queryKey: ["photos"] });
  const writeAvailability = useVolumeHealth("photos");
  const timelineGroups = useMemo(() => {
    const grouped = new Map<string, Photo[]>();
    for (const photo of photos.data ?? []) {
      const day = timelineDayKey(photo.capturedAt);
      grouped.set(day, [...(grouped.get(day) ?? []), photo]);
    }
    return [...grouped.values()];
  }, [photos.data]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const albumTrigger = useRef<HTMLButtonElement>(null);
  const lightboxTrigger = useRef<HTMLElement | null>(null);

  const upload = useMutation({
    mutationFn: api.uploadPhoto,
    onSuccess: async ({ photo }) => {
      await queryClient.invalidateQueries({ queryKey: ["photos"] });
      setAnnouncement(`${photo.filename} is protected and ready.`);
    },
  });
  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
    lightboxTrigger.current?.focus();
  }, []);
  const closeAlbumDialog = useCallback((created: boolean) => {
    albumTrigger.current?.focus();
    setShowAlbumDialog(false);
    if (created) {
      setSelected(new Set());
    }
  }, []);

  const toggleSelected = (photoId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(photoId);
      } else {
        next.delete(photoId);
      }
      return next;
    });
  };
  const lightboxIndex = photos.data?.findIndex(({ id }) => id === lightboxPhoto?.id) ?? -1;

  return (
    <div className="page photo-page">
      <header className="page-heading photo-heading">
        <div>
          <span className="eyebrow">Protected memories</span>
          <h1>Photos</h1>
          <p>Originals stay mirrored. Fast previews keep the timeline light.</p>
        </div>
        <div className="button-row">
          <button
            className="button secondary"
            data-testid="create-album"
            disabled={selected.size === 0}
            onClick={() => setShowAlbumDialog(true)}
            ref={albumTrigger}
            type="button"
          >
            <Plus size={16} /> Album
          </button>
          <label
            className={`button primary upload-button ${
              writeAvailability.canWrite ? "" : "disabled-control"
            }`}
            title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
          >
            <Upload size={16} />
            {upload.isPending ? "Protecting..." : "Upload photo"}
            <input
              accept="image/jpeg"
              data-testid="photo-upload"
              disabled={upload.isPending || !writeAvailability.canWrite}
              onChange={(event) => {
                const file = event.target.files?.item(0);
                if (file !== null && file !== undefined) {
                  upload.mutate(file);
                }
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {writeAvailability.canWrite ? null : (
        <section className="status-strip warning-strip">
          <ImagePlus size={19} />
          <div>
            <strong>Uploads paused</strong>
            <span>{writeAvailability.reason}</span>
          </div>
        </section>
      )}
      {upload.isError ? (
        <p aria-live="polite" className="form-error">
          Upload failed: {upload.error.message}
        </p>
      ) : null}

      {photos.isPending ? (
        <section aria-busy="true" className="loading-state">
          <span className="image-skeleton" />
          <span className="image-skeleton" />
        </section>
      ) : photos.isError ? (
        <section className="error-state">
          <ImagePlus size={24} />
          <h2>The timeline could not be loaded</h2>
          <p>{photos.error.message}</p>
          <button className="button secondary" onClick={() => photos.refetch()} type="button">
            Retry
          </button>
        </section>
      ) : photos.data?.length ? (
        timelineGroups.map((group) => (
          <section className="timeline" key={group[0]?.capturedAt}>
            <header className="timeline-date">
              <span>{timelineLabel(group[0]?.capturedAt ?? new Date().toISOString())}</span>
              <small>{group.length} originals</small>
            </header>
            <div className="photo-grid">
              {group.map((photo) => (
                <div
                  className="photo-item"
                  key={photo.id}
                  style={{
                    aspectRatio: `${photo.width} / ${photo.height}`,
                    flexGrow: photo.width / photo.height,
                  }}
                >
                  <button
                    aria-label={`Open ${photo.filename}`}
                    className="photo-button"
                    data-testid={`photo-${photo.id}`}
                    onClick={(event) => {
                      lightboxTrigger.current = event.currentTarget;
                      setLightboxPhoto(photo);
                    }}
                    title={photo.filename}
                    type="button"
                  >
                    <ProtectedImage
                      alt={photo.filename}
                      path={`/api/v1/photos/${photo.id}/preview`}
                    />
                    <span className="photo-caption">{photo.filename}</span>
                  </button>
                  <label className="photo-select">
                    <input
                      aria-label={`Select ${photo.filename}`}
                      checked={selected.has(photo.id)}
                      data-testid={`photo-select-${photo.id}`}
                      onChange={(event) => toggleSelected(photo.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <Check size={14} />
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <section className="empty-state">
          <Images size={30} />
          <h2>Your timeline is ready</h2>
          <p>Upload a JPEG to create a mirrored original and a lightweight WebP preview.</p>
        </section>
      )}

      {lightboxPhoto === null ? null : (
        <PhotoLightbox
          onClose={closeLightbox}
          onNext={
            lightboxIndex >= 0 && lightboxIndex < (photos.data?.length ?? 0) - 1
              ? () => setLightboxPhoto(photos.data?.[lightboxIndex + 1] ?? null)
              : undefined
          }
          onPrevious={
            lightboxIndex > 0
              ? () => setLightboxPhoto(photos.data?.[lightboxIndex - 1] ?? null)
              : undefined
          }
          photo={lightboxPhoto}
        />
      )}
      {showAlbumDialog ? <AlbumDialog onClose={closeAlbumDialog} photoIds={[...selected]} /> : null}
    </div>
  );
};
