import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Images, Settings2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../api";
import { useProgressiveWindow } from "../hooks/use-progressive-window";
import { useVolumeHealth } from "../hooks/use-volume-health";
import type { Album, Photo } from "../schemas";
import { AlbumPhotoPicker } from "./album-photo-picker";
import { AlbumSettingsDialog } from "./album-settings-dialog";
import { PhotoDeleteDialog } from "./photo-delete-dialog";
import { PhotoLightbox } from "./photo-lightbox";
import { PhotoTransferControls } from "./photo-transfer-controls";
import { ProtectedImage } from "./protected-image";

type AlbumDetailProps = {
  readonly album: Album;
  readonly onBack: () => void;
};

const captureDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const AlbumDetail = ({ album, onBack }: AlbumDetailProps) => {
  const queryClient = useQueryClient();
  const writeAvailability = useVolumeHealth("photos");
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [managedPhoto, setManagedPhoto] = useState<Photo | null>(null);
  const lightboxTrigger = useRef<HTMLButtonElement | null>(null);
  const managedPhotoTrigger = useRef<HTMLButtonElement | null>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const photoWindow = useProgressiveWindow(
    album.photos,
    `${album.id}\0${album.photos.length}\0${album.photos[0]?.id ?? ""}`,
  );
  const lightboxIndex = album.photos.findIndex(({ id }) => id === lightboxPhoto?.id);

  return (
    <div className="page album-detail" data-testid="album-detail">
      <button className="button quiet album-back" onClick={onBack} type="button">
        <ArrowLeft size={16} /> All albums
      </button>
      <header className="page-heading album-detail-heading">
        <div>
          <span className="eyebrow">Protected collection</span>
          <h1>{album.name}</h1>
          <p>
            <strong data-testid="album-detail-photo-count">{album.photos.length}</strong>{" "}
            {album.photos.length === 1 ? "photo" : "photos"} in this album
          </p>
        </div>
        <div className="button-row album-management-actions">
          <button
            className="button secondary"
            data-testid="album-add-existing"
            onClick={() => setShowPicker(true)}
            ref={pickerTrigger}
            type="button"
          >
            <ImagePlus size={16} /> Add existing photos
          </button>
          <button
            className="button quiet"
            data-testid="album-manage"
            onClick={() => setShowSettings(true)}
            ref={settingsTrigger}
            type="button"
          >
            <Settings2 size={16} /> Album settings
          </button>
        </div>
      </header>
      <PhotoTransferControls
        canWrite={writeAvailability.canWrite}
        onPhotoUploaded={async (photoId) => {
          await api.addPhotoToAlbum(album.id, photoId);
        }}
        onUploaded={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["albums"] }),
            queryClient.invalidateQueries({ queryKey: ["photos"] }),
          ]);
        }}
        reason={writeAvailability.reason}
        testIdPrefix="album-photo"
      />
      {album.photos.length === 0 ? (
        <section className="empty-state album-detail-empty" data-testid="album-detail-empty">
          <Images size={30} />
          <h2>This album is ready</h2>
          <p>Add protected library photos or upload new originals from your iPhone.</p>
        </section>
      ) : (
        <>
          <div className="album-detail-grid">
            {photoWindow.items.map((photo) => (
              <figure
                className="album-detail-photo"
                data-testid={`album-detail-photo-${photo.id}`}
                key={photo.id}
              >
                <button
                  aria-label={`Open ${photo.filename}`}
                  className="album-photo-open"
                  onClick={(event) => {
                    lightboxTrigger.current = event.currentTarget;
                    setLightboxPhoto(photo);
                  }}
                  type="button"
                >
                  <ProtectedImage
                    alt={photo.filename}
                    path={`/api/v1/photos/${photo.id}/preview`}
                  />
                </button>
                <figcaption>
                  <div className="album-photo-copy">
                    <span title={photo.filename}>{photo.filename}</span>
                    <time
                      data-testid={`album-photo-captured-${photo.id}`}
                      dateTime={photo.capturedAt}
                    >
                      Captured {captureDateFormatter.format(new Date(photo.capturedAt))}
                    </time>
                  </div>
                  <button
                    aria-label={`Delete or remove ${photo.filename}`}
                    className="button icon-button quiet album-photo-manage"
                    data-testid={`album-photo-manage-${photo.id}`}
                    onClick={(event) => {
                      managedPhotoTrigger.current = event.currentTarget;
                      setManagedPhoto(photo);
                    }}
                    title="Delete or remove photo"
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="photo-window-sentinel"
            data-testid="album-window-sentinel"
            ref={photoWindow.sentinelRef}
          />
        </>
      )}
      {showPicker ? (
        <AlbumPhotoPicker
          album={album}
          onClose={() => {
            setShowPicker(false);
            pickerTrigger.current?.focus();
          }}
        />
      ) : null}
      {showSettings ? (
        <AlbumSettingsDialog
          album={album}
          onClose={() => {
            setShowSettings(false);
            settingsTrigger.current?.focus();
          }}
          onDeleted={onBack}
        />
      ) : null}
      {managedPhoto === null ? null : (
        <PhotoDeleteDialog
          album={{ id: album.id, name: album.name }}
          onClose={() => {
            managedPhotoTrigger.current?.focus();
            setManagedPhoto(null);
          }}
          onDeleted={() => {
            settingsTrigger.current?.focus();
            setManagedPhoto(null);
          }}
          photos={[managedPhoto]}
        />
      )}
      {lightboxPhoto === null ? null : (
        <PhotoLightbox
          albumNames={[album.name]}
          index={lightboxIndex}
          onClose={() => {
            setLightboxPhoto(null);
            lightboxTrigger.current?.focus();
          }}
          onNext={
            lightboxIndex >= 0 && lightboxIndex < album.photos.length - 1
              ? () => setLightboxPhoto(album.photos[lightboxIndex + 1] ?? null)
              : undefined
          }
          onPrevious={
            lightboxIndex > 0
              ? () => setLightboxPhoto(album.photos[lightboxIndex - 1] ?? null)
              : undefined
          }
          photo={lightboxPhoto}
          total={album.photos.length}
        />
      )}
    </div>
  );
};
