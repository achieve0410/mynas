import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../api";
import { FileBrowser } from "../components/file-browser";
import { FileTransferWorkbench } from "../components/file-transfer-workbench";
import { FileVersionPanel } from "../components/file-version-panel";
import type { FileListing } from "../schemas";

export const FilesPage = () => {
  const queryClient = useQueryClient();
  const [chosenVolumeId, setChosenVolumeId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [pendingDownload, setPendingDownload] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const volumes = useQuery({
    queryFn: api.listVolumes,
    queryKey: ["volumes"],
  });
  const volumeId = chosenVolumeId || volumes.data?.[0]?.id || "";
  const listing = useInfiniteQuery({
    enabled: volumeId.length > 0,
    getNextPageParam: (lastPage: FileListing) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<FileListing> =>
      api.listFiles(
        volumeId,
        prefix,
        pageParam === null ? { limit: 50 } : { cursor: pageParam, limit: 50 },
      ),
    queryKey: ["files", volumeId, prefix],
  });
  const entries = useMemo(
    () => listing.data?.pages.flatMap((page: FileListing) => page.entries) ?? [],
    [listing.data],
  );
  const selectedEntry = entries.find(
    (entry) => entry.kind === "file" && entry.path === selectedPath,
  );
  const versions = useQuery({
    enabled: volumeId.length > 0 && selectedPath !== null,
    queryFn: () => api.listFileVersions(volumeId, selectedPath ?? ""),
    queryKey: ["file-versions", volumeId, selectedPath],
  });

  const refreshFiles = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["files", volumeId] }),
      selectedPath === null
        ? Promise.resolve()
        : queryClient.invalidateQueries({
            queryKey: ["file-versions", volumeId, selectedPath],
          }),
    ]);
  };

  const restore = useMutation({
    mutationFn: (versionId: string) =>
      api.restoreFileVersion(volumeId, selectedPath ?? "", versionId),
    onSuccess: async () => {
      await refreshFiles();
      setMessage(`${selectedPath ?? "File"} was restored as a new current version.`);
    },
  });

  const selectVolume = (nextVolumeId: string): void => {
    setChosenVolumeId(nextVolumeId);
    setPrefix("");
    setSelectedPath(null);
    setKeyValue("");
    setMessage(null);
  };

  const selectFolder = (nextPrefix: string): void => {
    setPrefix(nextPrefix);
    setSelectedPath(null);
    setKeyValue(nextPrefix);
    setMessage(null);
  };

  const selectFile = (path: string): void => {
    setSelectedPath(path);
    setKeyValue(path);
    setMessage(null);
  };

  const downloadSelected = async (): Promise<void> => {
    if (selectedPath === null) {
      return;
    }
    setPendingDownload(true);
    try {
      const blob = await api.downloadFile(volumeId, selectedPath);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedPath.split("/").at(-1) ?? "download";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setPendingDownload(false);
    }
  };

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Verified recovery workspace</span>
          <h1>Files</h1>
          <p>Browse cataloged objects, inspect immutable versions, and recover protected bytes.</p>
        </div>
        <span className="action-icon large">
          <ShieldCheck aria-hidden="true" size={24} />
        </span>
      </header>

      <section className="file-volume-bar">
        <label>
          Volume
          <select
            disabled={volumes.isLoading || (volumes.data?.length ?? 0) === 0}
            onChange={(event) => selectVolume(event.target.value)}
            value={volumeId}
          >
            {(volumes.data ?? []).map((volume) => (
              <option key={volume.id} value={volume.id}>
                {volume.id}
              </option>
            ))}
          </select>
        </label>
        <div className="status-strip">
          <Database aria-hidden="true" size={18} />
          <div>
            <strong>Catalog-first browsing</strong>
            <span>Folders and history remain visible without scanning replica storage.</span>
          </div>
        </div>
      </section>

      {volumes.error === null ? null : <p className="form-error">{volumes.error.message}</p>}
      {message === null ? null : (
        <p aria-live="polite" className="form-success page-message">
          {message}
        </p>
      )}
      {restore.error === null ? null : (
        <p aria-live="assertive" className="form-error">
          {restore.error.message}
        </p>
      )}

      <div className="file-browser-grid">
        <FileBrowser
          entries={entries}
          error={listing.error}
          hasNextPage={listing.hasNextPage}
          isFetchingNextPage={listing.isFetchingNextPage}
          isLoading={listing.isLoading || volumes.isLoading}
          onFileSelect={selectFile}
          onFolderSelect={selectFolder}
          onLoadMore={() => {
            void listing.fetchNextPage();
          }}
          onRetry={() => {
            void listing.refetch();
          }}
          prefix={prefix}
          selectedPath={selectedPath}
        />
        <FileVersionPanel
          currentVersionId={selectedEntry?.kind === "file" ? selectedEntry.versionId : null}
          error={versions.error}
          isLoading={versions.isLoading && selectedPath !== null}
          onDownload={() => {
            void downloadSelected();
          }}
          onRestore={(versionId) => {
            if (
              window.confirm(
                `Restore ${selectedPath ?? "this file"} from version ${versionId.slice(0, 8)}?`,
              )
            ) {
              restore.mutate(versionId);
            }
          }}
          path={selectedPath}
          pendingAction={pendingDownload ? "download" : restore.isPending ? "restore" : null}
          versions={versions.data ?? []}
        />
      </div>

      <FileTransferWorkbench
        keyValue={keyValue}
        onChanged={refreshFiles}
        onKeyChange={setKeyValue}
        volumeId={volumeId}
      />
    </div>
  );
};
