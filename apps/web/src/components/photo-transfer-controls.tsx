import { FolderUp, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  createPhotoReviewItems,
  fallbackPhotoReviewItems,
  resolvePhotoReviewItems,
} from "../photo-import-state";
import { savePhotoReceipt } from "../photo-receipts";
import { ingestSchema } from "../schemas";
import { uploadWithProgress } from "../transfer-api";
import { PhotoImportReview, type PhotoReviewItem } from "./photo-import-review";
import { useTransferManager } from "./transfer-provider";

type PhotoTransferControlsProps = {
  readonly canWrite: boolean;
  readonly onPhotoUploaded?: (photoId: string) => Promise<void>;
  readonly onUploaded: () => Promise<void>;
  readonly reason: string;
  readonly testIdPrefix?: string;
};

const photoTypes = ".heic,.jpeg,.jpg,.png,image/heic,image/heif,image/jpeg,image/png";
const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Photo import failed";

export const PhotoTransferControls = ({
  canWrite,
  onPhotoUploaded,
  onUploaded,
  reason,
  testIdPrefix = "photo",
}: PhotoTransferControlsProps) => {
  const [message, setMessage] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | undefined>();
  const [reviewItems, setReviewItems] = useState<readonly PhotoReviewItem[] | null>(null);
  const reviewAbort = useRef<AbortController | null>(null);
  const manager = useTransferManager();

  useEffect(
    () => () => {
      reviewAbort.current?.abort();
    },
    [],
  );

  const cancelReview = (): void => {
    reviewAbort.current?.abort();
    reviewAbort.current = null;
    setReviewItems(null);
    setReviewError(undefined);
  };

  const select = (files: FileList | null, kind: "directory" | "files"): void => {
    reviewAbort.current?.abort();
    const controller = new AbortController();
    reviewAbort.current = controller;
    const items = createPhotoReviewItems(files, kind);
    setReviewItems(items.length === 0 ? null : items);
    setReviewError(undefined);
    setMessage(null);
    if (items.length === 0) {
      return;
    }
    void resolvePhotoReviewItems(items, controller.signal)
      .then((resolved) => {
        if (!controller.signal.aborted) {
          setReviewItems(resolved);
          reviewAbort.current = null;
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          return;
        }
        setReviewItems(fallbackPhotoReviewItems(items));
        setReviewError(
          `Protection status could not be verified. Selected photos remain uploadable: ${errorMessage(
            cause,
          )}`,
        );
        reviewAbort.current = null;
      });
  };

  const confirmReview = async (): Promise<void> => {
    if (reviewItems === null) {
      return;
    }
    const selected = reviewItems;
    const protectedIds = selected.flatMap((item) =>
      item.status === "already-protected" && item.photoId !== undefined ? [item.photoId] : [],
    );
    const fresh = selected.filter((item) => item.status === "new");
    try {
      if (onPhotoUploaded !== undefined) {
        for (const photoId of protectedIds) {
          await onPhotoUploaded(photoId);
        }
      }
      if (fresh.length === 0) {
        await onUploaded();
        manager.clearFinished();
        setReviewItems(null);
        setMessage(`${protectedIds.length} protected photos reused without uploading.`);
        return;
      }
      manager.enqueueBatch(
        fresh.map(({ file, id, path }) => ({
          execute: async ({ onProgress, signal }) => {
            const responseBody = await uploadWithProgress(
              "POST",
              "/api/v1/photos",
              file,
              onProgress,
              { "x-mynas-filename": encodeURIComponent(path) },
              signal,
            );
            const ingest = ingestSchema.parse(JSON.parse(responseBody));
            try {
              await savePhotoReceipt({ file, path }, ingest.photo);
            } catch (cause) {
              const receiptError =
                cause instanceof Error ? cause.message : "Local receipt persistence failed";
              setMessage(
                `Photo uploaded, but its local protection receipt was not saved: ${receiptError}`,
              );
            }
            await onPhotoUploaded?.(ingest.photo.id);
          },
          id,
          kind: "photo",
          label: path,
          operation: "upload",
          path,
          testId: path,
          total: file.size,
        })),
        {
          onSettled: () => {
            void onUploaded().catch((cause: unknown) => {
              setMessage(`Photo refresh failed: ${errorMessage(cause)}`);
            });
          },
        },
      );
      setReviewItems(null);
      setMessage(
        `${fresh.length} new ${fresh.length === 1 ? "photo" : "photos"} queued; ${
          protectedIds.length
        } already protected.`,
      );
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : "Photo import failed");
    }
  };

  return (
    <div className="photo-transfer-controls">
      <div className="button-row">
        <label
          className={`button primary upload-button ${canWrite ? "" : "disabled-control"}`}
          title={canWrite ? undefined : reason}
        >
          <Upload size={16} />
          Add photos
          <input
            accept={photoTypes}
            data-testid={`${testIdPrefix}-upload`}
            disabled={!canWrite}
            multiple
            onChange={(event) => {
              select(event.target.files, "files");
              event.target.value = "";
            }}
            type="file"
          />
        </label>
        <label
          className={`button secondary upload-button ${canWrite ? "" : "disabled-control"}`}
          title={canWrite ? undefined : reason}
        >
          <FolderUp size={16} />
          Import folder from Files
          <input
            accept={photoTypes}
            data-testid={`${testIdPrefix}-directory-upload`}
            disabled={!canWrite}
            multiple
            onChange={(event) => {
              select(event.target.files, "directory");
              event.target.value = "";
            }}
            ref={(input) => input?.setAttribute("webkitdirectory", "")}
            type="file"
          />
        </label>
      </div>
      <p className="form-note" data-testid={`${testIdPrefix}-picker-note`}>
        On iPhone, Add photos opens your photo library. If the picker closes before this review
        appears, reselect a smaller group.
      </p>
      {message === null ? null : (
        <p aria-live="polite" className="form-success">
          {message}
        </p>
      )}
      {reviewItems === null ? null : (
        <PhotoImportReview
          allowProtectedConfirmation={onPhotoUploaded !== undefined}
          error={reviewError}
          items={reviewItems}
          onCancel={cancelReview}
          onConfirm={() => {
            void confirmReview();
          }}
        />
      )}
    </div>
  );
};
