import { useTransferManager } from "../components/transfer-provider";
import { downloadWithProgress } from "../transfer-api";
import type { TransferKind } from "../transfer-manager";

export type DownloadTransfer = {
  readonly delivery?: "download" | "share";
  readonly filename: string;
  readonly id?: string;
  readonly init?: RequestInit;
  readonly kind?: TransferKind;
  readonly label: string;
  readonly path: string;
};

const saveBlob = async (
  blob: Blob,
  filename: string,
  delivery: "download" | "share",
): Promise<void> => {
  const file = new File([blob], filename, { type: blob.type });
  if (
    delivery === "share" &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia("(pointer: coarse)").matches &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const useDownloadTransfer = () => {
  const manager = useTransferManager();

  const downloadMany = (transfers: readonly DownloadTransfer[]): string | null =>
    manager.enqueueBatch(
      transfers.map(
        ({ delivery = "download", filename, id = filename, init, kind = "file", label, path }) => ({
          execute: async ({ onProgress, signal }) => {
            const blob = await downloadWithProgress(path, onProgress, { ...init, signal });
            await saveBlob(blob, filename, delivery);
          },
          id: `download:${id}`,
          kind,
          label,
          operation: "download",
          path: label,
          total: null,
        }),
      ),
    );

  const download = (transfer: DownloadTransfer): string | null => {
    return downloadMany([transfer]);
  };

  return { download, downloadMany } as const;
};
