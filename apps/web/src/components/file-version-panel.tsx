import { Download, History, RotateCcw } from "lucide-react";

import type { FileVersion } from "../schemas";

type FileVersionPanelProps = {
  readonly currentVersionId: string | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly onDownload: () => void;
  readonly onRestore: (versionId: string) => void;
  readonly path: string | null;
  readonly pendingAction: "download" | "restore" | null;
  readonly versions: readonly FileVersion[];
};

const formatBytes = (size: number): string =>
  size < 1_024 ? `${size} B` : `${(size / 1_024).toFixed(1)} KiB`;

export const FileVersionPanel = ({
  currentVersionId,
  error,
  isLoading,
  onDownload,
  onRestore,
  path,
  pendingAction,
  versions,
}: FileVersionPanelProps) => (
  <section aria-label="Version history" className="section-block version-panel">
    <div className="section-heading compact">
      <div>
        <span className="eyebrow">Recovery point</span>
        <h2>Version history</h2>
      </div>
      <span className="action-icon">
        <History aria-hidden="true" size={18} />
      </span>
    </div>
    {path === null ? (
      <div className="empty-state compact-state">
        <History aria-hidden="true" size={28} />
        <strong>Select a file</strong>
        <span>Choose a catalog entry to inspect immutable versions.</span>
      </div>
    ) : (
      <>
        <div className="selected-file-heading">
          <strong className="mono">{path}</strong>
          <button
            className="button secondary"
            disabled={pendingAction !== null}
            onClick={onDownload}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            Download current file
          </button>
        </div>
        {isLoading ? (
          <div aria-label="Loading versions" className="file-browser-loading" role="status">
            <span />
            <span />
          </div>
        ) : error !== null ? (
          <p className="form-error">{error.message}</p>
        ) : (
          <ul className="version-list">
            {versions.map((version) => {
              const current = version.id === currentVersionId;
              return (
                <li className="version-row" key={version.id}>
                  <div>
                    <strong>{new Date(version.createdAt).toLocaleString()}</strong>
                    <small className="mono">
                      {version.tombstone
                        ? "Deleted marker"
                        : `${formatBytes(version.blob?.size ?? 0)} · ${version.id.slice(0, 8)}`}
                    </small>
                  </div>
                  {version.tombstone || current ? (
                    <span className="status-pill">{current ? "Current" : "Deleted"}</span>
                  ) : (
                    <button
                      aria-label={`Restore version ${version.id}`}
                      className="button quiet"
                      disabled={pendingAction !== null}
                      onClick={() => onRestore(version.id)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={15} />
                      Restore
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    )}
  </section>
);
