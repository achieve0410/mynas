import { Download, FileUp, Fingerprint, FolderUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import { useDownloadTransfer } from "../hooks/use-download-transfer";
import { useFileUpload } from "../hooks/use-file-upload";
import { useVolumeHealth } from "../hooks/use-volume-health";
import { TransferProgressList } from "./transfer-progress-list";

type FileTransferWorkbenchProps = {
  readonly keyValue: string;
  readonly onChanged: () => Promise<void>;
  readonly onKeyChange: (key: string) => void;
  readonly volumeId: string;
};

export const FileTransferWorkbench = ({
  keyValue,
  onChanged,
  onKeyChange,
  volumeId,
}: FileTransferWorkbenchProps) => {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"delete" | "download" | null>(null);
  const writeAvailability = useVolumeHealth(volumeId);
  const fileUpload = useFileUpload({ keyValue, onChanged, onKeyChange, volumeId });
  const fileDownload = useDownloadTransfer();
  const busy = pendingAction !== null || fileUpload.isUploading || fileDownload.isDownloading;

  const download = async () => {
    setActionError(null);
    setPendingAction("download");
    try {
      await fileDownload.download({
        filename: keyValue.split("/").at(-1) ?? "download",
        id: `exact:${keyValue}`,
        label: keyValue,
        path: `/api/v1/files/${encodeURIComponent(volumeId)}/${keyValue
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="file-workbench">
      <div className="workbench-intro">
        <span className="action-icon large">
          <Fingerprint aria-hidden="true" size={24} />
        </span>
        <h2>Transfer workbench</h2>
        <p>
          MyNAS verifies bytes while reading and falls through to a healthy replica if one copy is
          corrupt.
        </p>
      </div>
      <form
        className="form-panel embedded"
        onSubmit={(event) => {
          setActionError(null);
          void fileUpload.upload(event);
        }}
      >
        <label>
          Object path
          <input
            className="mono"
            onChange={(event) => onKeyChange(event.target.value)}
            placeholder="documents/archive.zip"
            required
            value={keyValue}
          />
        </label>
        <div className="file-picker-row">
          <label className="file-picker">
            <FileUp aria-hidden="true" size={20} />
            <span>Choose files</span>
            <input
              data-testid="file-upload"
              multiple
              onChange={(event) => {
                setActionError(null);
                setActionMessage(null);
                fileUpload.selectFiles(event.target.files, "files");
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          <label className="file-picker">
            <FolderUp aria-hidden="true" size={20} />
            <span>Choose folder</span>
            <input
              data-testid="file-directory-upload"
              multiple
              onChange={(event) => {
                setActionError(null);
                setActionMessage(null);
                fileUpload.selectFiles(event.target.files, "directory");
                event.target.value = "";
              }}
              ref={(input) => input?.setAttribute("webkitdirectory", "")}
              type="file"
            />
          </label>
        </div>
        {fileUpload.selection === null ? null : (
          <p className="form-note">
            {fileUpload.selection.items.length}{" "}
            {fileUpload.selection.items.length === 1 ? "item" : "items"} selected
          </p>
        )}
        <div className="button-row">
          <button
            className="button primary"
            disabled={
              fileUpload.selection === null ||
              keyValue.length === 0 ||
              volumeId.length === 0 ||
              !writeAvailability.canWrite ||
              busy
            }
            title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
            type="submit"
          >
            {fileUpload.isUploading
              ? "Uploading..."
              : `Upload ${fileUpload.selection?.items.length ?? 0} protected ${
                  fileUpload.selection?.items.length === 1 ? "item" : "items"
                }`}
          </button>
          <button
            className="button secondary"
            disabled={keyValue.length === 0 || busy}
            onClick={download}
            type="button"
          >
            <Download aria-hidden="true" size={16} /> Download
          </button>
          <button
            className="button quiet danger-text"
            disabled={keyValue.length === 0 || !writeAvailability.canWrite || busy}
            onClick={async () => {
              if (!window.confirm(`Delete "${keyValue}" from ${volumeId}?`)) {
                return;
              }
              setActionError(null);
              setPendingAction("delete");
              try {
                await api.deleteFile(volumeId, keyValue);
                await onChanged();
                setActionMessage(`${keyValue} was deleted.`);
              } catch (cause) {
                setActionError(cause instanceof Error ? cause.message : "Delete failed");
              } finally {
                setPendingAction(null);
              }
            }}
            title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} /> Delete
          </button>
        </div>
        {(fileUpload.message ?? actionMessage) === null ? null : (
          <p aria-live="polite" className="form-success">
            {fileUpload.message ?? actionMessage}
          </p>
        )}
        <TransferProgressList kind="file" rows={fileUpload.transferRows} />
        <TransferProgressList kind="file" operation="download" rows={fileDownload.rows} />
        {(fileUpload.error ?? actionError) === null ? null : (
          <p aria-live="polite" className="form-error">
            {fileUpload.error ?? actionError}
          </p>
        )}
        {fileUpload.failedPaths.length === 0 ? null : (
          <div aria-live="polite" className="upload-failures">
            <strong>Failed paths</strong>
            <ul>
              {fileUpload.failedPaths.map((path) => (
                <li className="mono" key={path}>
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className={writeAvailability.canWrite ? "form-note" : "form-error"}>
          {writeAvailability.reason}
        </p>
      </form>
    </section>
  );
};
