import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { AlbumDialog } from "../components/album-dialog";
import type { LibraryRefreshState } from "../components/file-library-controls";
import { PhotoDeleteDialog } from "../components/photo-delete-dialog";
import { PhotoLibraryControls } from "../components/photo-library-controls";
import { PhotoLightbox } from "../components/photo-lightbox";
import { PhotoSelectionToolbar } from "../components/photo-selection-toolbar";
import { PhotoTimeline } from "../components/photo-timeline";
import { PhotoTransferControls } from "../components/photo-transfer-controls";
import { useDownloadTransfer } from "../hooks/use-download-transfer";
import { useProgressiveWindow } from "../hooks/use-progressive-window";
import { useVolumeHealth } from "../hooks/use-volume-health";
import type { Photo } from "../schemas";
import {
  albumNamesForPhoto,
  filterAndSortPhotos,
  groupPhotosByCapturedDay,
  type PhotoSort,
} from "./photo-page-collections";

export const PhotosPage = () => {
  const queryClient = useQueryClient();
  const photos = useQuery({
    queryFn: api.listPhotos,
    queryKey: ["photos"],
    refetchInterval: 3_000,
  });
  const writeAvailability = useVolumeHealth("photos");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PhotoSort>("newest");
  const [density, setDensity] = useState<"large" | "medium" | "small">("medium");
  const [refreshState, setRefreshState] = useState<LibraryRefreshState>("idle");
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const albums = useQuery({
    enabled: lightboxPhoto !== null,
    queryFn: api.listAlbums,
    queryKey: ["albums"],
  });
  const visiblePhotos = useMemo(
    () => filterAndSortPhotos(photos.data ?? [], search, sort),
    [photos.data, search, sort],
  );
  const photoWindow = useProgressiveWindow(
    visiblePhotos,
    `${search}\0${sort}\0${visiblePhotos.length}\0${visiblePhotos[0]?.id ?? ""}`,
  );
  const timelineGroups = groupPhotosByCapturedDay(photoWindow.items);
  const lightboxAlbumNames = useMemo(
    () => albumNamesForPhoto(albums.data ?? [], lightboxPhoto?.id),
    [albums.data, lightboxPhoto?.id],
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const albumTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const lightboxTrigger = useRef<HTMLElement | null>(null);
  const downloads = useDownloadTransfer();
  const visibleSelectedCount = useMemo(
    () => visiblePhotos.filter((photo) => selected.has(photo.id)).length,
    [selected, visiblePhotos],
  );
  const selectedPhotos = useMemo(
    () => (photos.data ?? []).filter(({ id }) => selected.has(id)),
    [photos.data, selected],
  );
  const allVisibleSelected =
    visiblePhotos.length > 0 && visibleSelectedCount === visiblePhotos.length;
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
  const toggleVisibleSelection = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const photo of visiblePhotos) {
        if (allVisibleSelected) {
          next.delete(photo.id);
        } else {
          next.add(photo.id);
        }
      }
      return next;
    });
  };
  const lightboxIndex = visiblePhotos.findIndex(({ id }) => id === lightboxPhoto?.id);

  return (
    <div
      className="page photo-page photo-library"
      data-density={density}
      data-refresh-state={refreshState}
      data-testid="photo-library"
    >
      <header className="page-heading photo-heading">
        <div>
          <span className="eyebrow">Protected memories</span>
          <h1>Photos</h1>
          <p>Originals stay mirrored. Fast previews keep the timeline light.</p>
        </div>
      </header>
      <PhotoLibraryControls
        density={density}
        onDensityChange={setDensity}
        onRefresh={() => {
          setRefreshState("refreshing");
          void photos
            .refetch()
            .then((result) => setRefreshState(result.isError ? "failed" : "complete"));
        }}
        onSearchChange={setSearch}
        onSortChange={setSort}
        refreshState={refreshState}
        search={search}
        sort={sort}
      />

      <PhotoSelectionToolbar
        albumTrigger={albumTrigger}
        allVisibleSelected={allVisibleSelected}
        deleteTrigger={deleteTrigger}
        isDownloading={false}
        onClear={() => setSelected(new Set())}
        onCreateAlbum={() => setShowAlbumDialog(true)}
        onDelete={() => setShowDeleteDialog(true)}
        onDownload={() => {
          downloads.downloadMany(
            (photos.data ?? [])
              .filter(({ id }) => selected.has(id))
              .map((photo) => ({
                filename: photo.filename,
                id: `selected:${photo.id}`,
                kind: "photo",
                label: photo.filename,
                path: `/api/v1/photos/${photo.id}/original`,
              })),
          );
        }}
        onToggleVisible={toggleVisibleSelection}
        selectedCount={selected.size}
        visibleCount={visiblePhotos.length}
        visibleSelectedCount={visibleSelectedCount}
      />

      <PhotoTransferControls
        canWrite={writeAvailability.canWrite}
        onUploaded={async () => {
          await queryClient.invalidateQueries({ queryKey: ["photos"] });
          setAnnouncement("Photo upload complete.");
        }}
        reason={writeAvailability.reason}
      />
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
      <PhotoTimeline
        error={photos.error}
        groups={timelineGroups}
        isPending={photos.isPending}
        onOpen={(photo, trigger) => {
          lightboxTrigger.current = trigger;
          setLightboxPhoto(photo);
        }}
        onRetry={() => {
          void photos.refetch();
        }}
        onToggle={toggleSelected}
        selected={selected}
        totalCount={photos.data?.length ?? 0}
      />
      <div
        aria-hidden="true"
        className="photo-window-sentinel"
        data-testid="photo-window-sentinel"
        ref={photoWindow.sentinelRef}
      />

      {lightboxPhoto === null ? null : (
        <PhotoLightbox
          albumNames={lightboxAlbumNames}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNext={
            lightboxIndex >= 0 && lightboxIndex < visiblePhotos.length - 1
              ? () => setLightboxPhoto(visiblePhotos[lightboxIndex + 1] ?? null)
              : undefined
          }
          onPrevious={
            lightboxIndex > 0
              ? () => setLightboxPhoto(visiblePhotos[lightboxIndex - 1] ?? null)
              : undefined
          }
          photo={lightboxPhoto}
          total={visiblePhotos.length}
        />
      )}
      {showAlbumDialog ? <AlbumDialog onClose={closeAlbumDialog} photoIds={[...selected]} /> : null}
      {showDeleteDialog && selectedPhotos.length > 0 ? (
        <PhotoDeleteDialog
          onClose={() => {
            setShowDeleteDialog(false);
            deleteTrigger.current?.focus();
          }}
          onDeleted={() => {
            setSelected(new Set());
            setShowDeleteDialog(false);
            setAnnouncement(`${selectedPhotos.length} selected photos deleted from the library.`);
          }}
          photos={selectedPhotos}
        />
      ) : null}
    </div>
  );
};
