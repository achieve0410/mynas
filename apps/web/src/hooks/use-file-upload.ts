import { type FormEvent, useState } from "react";
import { useTransferManager } from "../components/transfer-provider";
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
  const [message, setMessage] = useState<string | null>(null);
  const manager = useTransferManager();

  const upload = (event: FormEvent): void => {
    event.preventDefault();
    if (selection === null) {
      return;
    }
    const selected = selection;
    manager.enqueueBatch(
      selected.items.map(({ file, id, relativePath }) => {
        const path =
          selected.kind === "files" && selected.items.length === 1 && !keyValue.endsWith("/")
            ? keyValue
            : `${keyValue.length === 0 || keyValue.endsWith("/") ? keyValue : `${keyValue}/`}${relativePath}`;
        return {
          execute: async ({ onProgress, signal }) => {
            await uploadWithProgress(
              "PUT",
              `/api/v1/files/${encodeURIComponent(volumeId)}/${path
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`,
              file,
              onProgress,
              {},
              signal,
            );
            await onChanged();
          },
          id,
          kind: "file" as const,
          label: relativePath,
          operation: "upload" as const,
          path,
          total: file.size,
        };
      }),
    );
    setSelection(null);
    setMessage(
      `${selected.items.length} ${selected.items.length === 1 ? "file" : "files"} queued.`,
    );
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
    setMessage(null);
  };

  return {
    message,
    selectFiles,
    selection,
    upload,
  } as const;
};
