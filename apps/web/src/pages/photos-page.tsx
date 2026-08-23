import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ImagePlus, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { AlbumDialog } from "../components/album-dialog";
import type { LibraryRefreshState } from "../components/file-library-controls";
import { PhotoLibraryControls } from "../components/photo-library-controls";
import { PhotoLightbox } from "../components/photo-lightbox";
import { PhotoTimeline } from "../components/photo-timeline";
import { PhotoTransferControls } from "../components/photo-transfer-controls";
import { TransferProgressList } from "../components/transfer-progress-list";
import { useDownloadTransfer } from "../hooks/use-download-transfer";
import { useVolumeHealth } from "../hooks/use-volume-health";
import type { Photo } from "../schemas";

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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"filename" | "newest" | "oldest" | "type">("newest");
  const [density, setDensity] = useState<"large" | "medium" | "small">("medium");
  const [refreshState, setRefreshState] = useState<LibraryRefreshState>("idle");
  const visiblePhotos = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    const filtered = (photos.data ?? []).filter((photo) =>
      photo.filename.toLocaleLowerCase().includes(normalizedSearch),
    );
    return [...filtered].sort((left, right) => {
      if (sort === "filename") {
        return left.filename.localeCompare(right.filename);
      }
      if (sort === "type") {
        return (
          left.format.localeCompare(right.format) || left.filename.localeCompare(right.filename)
        );
      }
      const timeOrder = left.capturedAt.localeCompare(right.capturedAt);
      return sort === "oldest" ? timeOrder : -timeOrder;
    });
  }, [photos.data, search, sort]);
  const timelineGroups = useMemo(() => {
    const grouped = new Map<string, Photo[]>();
    for (const photo of visiblePhotos) {
      const day = timelineDayKey(photo.capturedAt);
      grouped.set(day, [...(grouped.get(day) ?? []), photo]);
    }
    return [...grouped.values()];
  }, [visiblePhotos]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [showAlbumDialog, setShowAlbumDialog] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const albumTrigger = useRef<HTMLButtonElement>(null);
  const lightboxTrigger = useRef<HTMLElement | null>(null);
  const archiveDownload = useDownloadTransfer();
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
          <button
            className="button secondary"
            disabled={selected.size === 0 || archiveDownload.isDownloading}
            onClick={async () => {
              await archiveDownload.download({
                filename: "mynas-photos.zip",
                init: {
                  body: JSON.stringify({ photoIds: [...selected] }),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                },
                label: `${selected.size} selected photos`,
                path: "/api/v1/photos/archive",
              });
            }}
            type="button"
          >
            <Download size={16} /> Download selected
          </button>
        </div>
      </header>
      <TransferProgressList kind="photo" operation="download" rows={archiveDownload.rows} />

      <PhotoLibraryControls
        density={density}
        onDensityChange={setDensity}
        onRefresh={() => {
          setRefreshState("refreshing");
          void photos
            .refetch()
            .then((result) => setRefreshState(result.isError ? "failed" : "complete"));
        }}
        onSearchChange={(value) => {
          setSearch(value);
          setSelected(new Set());
        }}
        onSortChange={setSort}
        refreshState={refreshState}
        search={search}
        sort={sort}
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

      {lightboxPhoto === null ? null : (
        <PhotoLightbox
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
    </div>
  );
};
