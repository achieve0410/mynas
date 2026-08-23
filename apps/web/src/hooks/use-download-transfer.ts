import { useEffect, useRef, useState } from "react";

import type { TransferRow } from "../components/transfer-progress-list";
import { downloadWithProgress } from "../transfer-api";

type DownloadTransfer = {
  readonly filename: string;
  readonly id?: string;
  readonly init?: RequestInit;
  readonly label: string;
  readonly path: string;
};

const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const useDownloadTransfer = () => {
  const [row, setRow] = useState<TransferRow | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

  const download = async ({
    filename,
    id = filename,
    init,
    label,
    path,
  }: DownloadTransfer): Promise<boolean> => {
    setIsDownloading(true);
    const downloadController = new AbortController();
    controller.current = downloadController;
    setRow({
      id: `download:${id}`,
      label,
      loaded: 0,
      percent: 0,
      status: "transferring",
      total: null,
    });
    try {
      const blob = await downloadWithProgress(
        path,
        (progress) => {
          setRow((current) =>
            current === null ? null : { ...current, ...progress, status: "transferring" },
          );
        },
        { ...init, signal: downloadController.signal },
      );
      saveBlob(blob, filename);
      setRow((current) =>
        current === null
          ? null
          : {
              ...current,
              loaded: blob.size,
              percent: 100,
              status: "complete",
              total: current.total ?? blob.size,
            },
      );
      return true;
    } catch (cause) {
      setRow((current) =>
        current === null
          ? null
          : {
              ...current,
              error: cause instanceof Error ? cause.message : "Download failed",
              status: "failed",
            },
      );
      return false;
    } finally {
      if (controller.current === downloadController) {
        controller.current = null;
      }
      setIsDownloading(false);
    }
  };

  return { download, isDownloading, rows: row === null ? [] : [row] } as const;
};
