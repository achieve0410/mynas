import { type FormEvent, useEffect, useRef, useState } from "react";
import type { TransferRow } from "../components/transfer-progress-list";
import { uploadWithProgress } from "../transfer-api";

type UploadSelection = {
  readonly items: readonly {
    readonly file: File;
    readonly id: string;
    readonly relativePath: string;
  }[];
  readonly kind: "directory" | "files";
};

type UseFileUploadOptions = {
  readonly keyValue: string;
  readonly onChanged: () => Promise<void>;
  readonly onKeyChange: (key: string) => void;
  readonly volumeId: string;
};

export const useFileUpload = ({
  keyValue,
  onChanged,
  onKeyChange,
  volumeId,
}: UseFileUploadOptions) => {
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [transferRows, setTransferRows] = useState<readonly TransferRow[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (selection === null) {
      return;
    }
    setError(null);
    setFailedPaths([]);
    setIsUploading(true);
    setTransferRows(
      selection.items.map(({ file, id, relativePath }) => ({
        id,
        label: relativePath,
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
    for (const { file, id, relativePath } of selection.items) {
      if (uploadController.signal.aborted) {
        break;
      }
      const path =
        selection.kind === "files" && selection.items.length === 1 && !keyValue.endsWith("/")
          ? keyValue
          : `${keyValue.length === 0 || keyValue.endsWith("/") ? keyValue : `${keyValue}/`}${relativePath}`;
      try {
        setTransferRows((rows) =>
          rows.map((row) => (row.id === id ? { ...row, status: "transferring" as const } : row)),
        );
        await uploadWithProgress(
          "PUT",
          `/api/v1/files/${encodeURIComponent(volumeId)}/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          file,
          (progress) => {
            setTransferRows((rows) =>
              rows.map((row) => (row.id === id ? { ...row, ...progress } : row)),
            );
          },
          {},
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
        await onChanged();
      }
      setFailedPaths(failures);
      setMessage(
        `${uploaded} of ${selection.items.length} ${
          selection.items.length === 1 ? "file" : "files"
        } uploaded.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog refresh failed");
    } finally {
      if (controller.current === uploadController) {
        controller.current = null;
      }
      setIsUploading(false);
    }
  };

  const selectFiles = (files: FileList | null, kind: UploadSelection["kind"]): void => {
    const selected = files === null ? [] : Array.from(files);
    const items = selected.map((file) => {
      const relativePath =
        kind === "directory" && file.webkitRelativePath.length > 0
          ? file.webkitRelativePath
          : file.name;
      return { file, id: relativePath, relativePath };
    });
    setSelection(items.length === 0 ? null : { items, kind });
    if (selected.length === 1 && kind === "files" && keyValue.length === 0) {
      onKeyChange(selected[0]?.name ?? "");
    }
    setTransferRows([]);
    setFailedPaths([]);
    setMessage(null);
    setError(null);
  };

  return {
    error,
    failedPaths,
    isUploading,
    message,
    selectFiles,
    selection,
    transferRows,
    upload,
  } as const;
};
