import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { FileBrowser } from "../components/file-browser";
import {
  FileLibraryControls,
  FilePageHeader,
  type LibraryRefreshState,
} from "../components/file-library-controls";
import { FileTransferWorkbench } from "../components/file-transfer-workbench";
import { FileVersionPanel } from "../components/file-version-panel";
import { useDownloadTransfer } from "../hooks/use-download-transfer";
import type { FileListEntry, FileListing } from "../schemas";

export const FilesPage = () => {
  const queryClient = useQueryClient();
  const [chosenVolumeId, setChosenVolumeId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [selections, setSelections] = useState<readonly FileListEntry[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "type">("name");
  const [refreshState, setRefreshState] = useState<LibraryRefreshState>("idle");
  const downloads = useDownloadTransfer();

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
        pageParam === null
          ? { limit: 50, search, sort }
          : { cursor: pageParam, limit: 50, search, sort },
      ),
    queryKey: ["files", volumeId, prefix, search, sort],
    refetchInterval: 3_000,
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
    setSelections([]);
    setMessage(null);
    setSearch("");
  };

  const selectFolder = (nextPrefix: string): void => {
    setPrefix(nextPrefix);
    setSelectedPath(null);
    setKeyValue(nextPrefix);
    setSelections([]);
    setMessage(null);
    setSearch("");
  };

  const selectFile = (path: string): void => {
    setSelectedPath(path);
    setKeyValue(path);
    setMessage(null);
  };

  const downloadSelected = (): void => {
    if (selectedPath === null) {
      return;
    }
    const filename = selectedPath.split("/").at(-1) ?? "download";
    const encodedPath = selectedPath.split("/").map(encodeURIComponent).join("/");
    downloads.download({
      filename,
      id: `current:${selectedPath}`,
      label: filename,
      path: `/api/v1/files/${encodeURIComponent(volumeId)}/${encodedPath}`,
    });
    setMessage(`${filename} queued for download.`);
  };

  const downloadSelections = (): void => {
    downloads.downloadMany(
      selections.map((selection) => {
        const name = selection.path.split("/").filter(Boolean).at(-1) ?? "download";
        if (selection.kind === "file") {
          return {
            filename: name,
            id: `selected:file:${selection.path}`,
            label: selection.path,
            path: `/api/v1/files/${encodeURIComponent(volumeId)}/${selection.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
          };
        }
        return {
          filename: `${name}.zip`,
          id: `selected:folder:${selection.path}`,
          init: {
            body: JSON.stringify({ selections: [selection] }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
          label: selection.path,
          path: `/api/v1/volumes/${encodeURIComponent(volumeId)}/archive`,
        };
      }),
    );
    setMessage(`${selections.length} selected downloads queued.`);
  };

  const refreshVisibleFiles = async (): Promise<void> => {
    setRefreshState("refreshing");
    const [filesResult, versionsResult] = await Promise.all([
      listing.refetch(),
      selectedPath === null ? Promise.resolve(null) : versions.refetch(),
    ]);
    setRefreshState(
      filesResult.isError || versionsResult?.isError === true ? "failed" : "complete",
    );
  };

  return (
    <div className="page">
      <FilePageHeader onDownloadSelected={downloadSelections} selectionCount={selections.length} />

      <FileLibraryControls
        onRefresh={() => {
          void refreshVisibleFiles();
        }}
        onSearchChange={(value) => {
          setSearch(value);
          setSelections([]);
          setSelectedPath(null);
        }}
        onSortChange={setSort}
        onVolumeChange={selectVolume}
        refreshState={refreshState}
        search={search}
        sort={sort}
        volumeId={volumeId}
        volumes={volumes.data ?? []}
        volumesLoading={volumes.isLoading}
      />

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
          onSelectionChange={setSelections}
          prefix={prefix}
          refreshState={refreshState}
          selectedPath={selectedPath}
          selections={selections}
        />
        <FileVersionPanel
          currentVersionId={selectedEntry?.kind === "file" ? selectedEntry.versionId : null}
          error={versions.error}
          isLoading={versions.isLoading && selectedPath !== null}
          onDownload={() => {
            downloadSelected();
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
          pendingAction={restore.isPending ? "restore" : null}
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
