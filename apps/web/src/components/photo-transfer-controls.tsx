import { FolderUp, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { uploadWithProgress } from "../transfer-api";
import { TransferProgressList, type TransferRow } from "./transfer-progress-list";

type PhotoTransferControlsProps = {
  readonly canWrite: boolean;
  readonly onUploaded: () => Promise<void>;
  readonly reason: string;
};

type UploadSelection = {
  readonly items: readonly {
    readonly file: File;
    readonly id: string;
    readonly path: string;
  }[];
};

const photoTypes = ".heic,.jpeg,.jpg,.png,image/heic,image/heif,image/jpeg,image/png";

export const PhotoTransferControls = ({
  canWrite,
  onUploaded,
  reason,
}: PhotoTransferControlsProps) => {
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [transferRows, setTransferRows] = useState<readonly TransferRow[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  const upload = async (): Promise<void> => {
    if (selection === null) {
      return;
    }
    setFailedPaths([]);
    setError(null);
    setMessage(null);
    setPending(true);
    setTransferRows(
      selection.items.map(({ file, id, path }) => ({
        id,
        label: path,
        loaded: 0,
        percent: 0,
        status: "queued",
        total: file.size,
      })),
    );
    const uploadController = new AbortController();
    controller.current = uploadController;
    const failures: string[] = [];
    let uploaded = 0;
    for (const { file, id, path } of selection.items) {
      if (uploadController.signal.aborted) {
        break;
      }
      try {
        setTransferRows((rows) =>
          rows.map((row) => (row.id === id ? { ...row, status: "transferring" as const } : row)),
        );
        await uploadWithProgress(
          "POST",
          "/api/v1/photos",
          file,
          (progress) => {
            setTransferRows((rows) =>
              rows.map((row) => (row.id === id ? { ...row, ...progress } : row)),
            );
          },
          { "x-mynas-filename": encodeURIComponent(path) },
          uploadController.signal,
        );
        setTransferRows((rows) =>
          rows.map((row) =>
            row.id === id
              ? { ...row, loaded: file.size, percent: 100, status: "complete" as const }
              : row,
          ),
        );
        uploaded += 1;
      } catch (cause) {
        setTransferRows((rows) =>
          rows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  error: cause instanceof Error ? cause.message : "Upload failed",
                  status: "failed" as const,
                }
              : row,
          ),
        );
        failures.push(path);
        if (uploadController.signal.aborted) {
          break;
        }
      }
    }
    try {
      if (uploaded > 0) {
        await onUploaded();
      }
      setFailedPaths(failures);
      setMessage(`${uploaded} of ${selection.items.length} photos uploaded.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog refresh failed");
    } finally {
      if (controller.current === uploadController) {
        controller.current = null;
      }
      setPending(false);
    }
  };

  const select = (files: FileList | null, kind: "directory" | "files"): void => {
    const selected = files === null ? [] : Array.from(files);
    const items = selected.map((file) => {
      const path =
        kind === "directory" && file.webkitRelativePath.length > 0
          ? file.webkitRelativePath
          : file.name;
      return { file, id: path, path };
    });
    setSelection(items.length === 0 ? null : { items });
    setFailedPaths([]);
    setError(null);
    setMessage(null);
    setTransferRows([]);
  };

  return (
    <div className="photo-transfer-controls">
      <div className="button-row">
        <label
          className={`button primary upload-button ${canWrite ? "" : "disabled-control"}`}
          title={canWrite ? undefined : reason}
        >
          <Upload size={16} />
          Choose photos
          <input
            accept={photoTypes}
            data-testid="photo-upload"
            disabled={pending || !canWrite}
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
          Choose photo folder
          <input
            accept={photoTypes}
            data-testid="photo-directory-upload"
            disabled={pending || !canWrite}
            multiple
            onChange={(event) => {
              select(event.target.files, "directory");
              event.target.value = "";
            }}
            ref={(input) => input?.setAttribute("webkitdirectory", "")}
            type="file"
          />
        </label>
        <button
          className="button primary"
          disabled={selection === null || pending || !canWrite}
          onClick={() => {
            void upload();
          }}
          type="button"
        >
          {pending ? "Uploading..." : `Upload ${selection?.items.length ?? 0}`}
        </button>
      </div>
      {message === null ? null : (
        <p aria-live="polite" className="form-success">
          {message}
        </p>
      )}
      <TransferProgressList kind="photo" rows={transferRows} />
      {error === null ? null : (
        <p aria-live="polite" className="form-error">
          {error}
        </p>
      )}
      {failedPaths.length === 0 ? null : (
        <div aria-live="polite" className="upload-failures">
          <strong>Failed paths</strong>
          <ul>
            {failedPaths.map((path) => (
              <li className="mono" key={path}>
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
