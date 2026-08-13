import { Download, FileUp, Fingerprint, FolderUp, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api } from "../api";
import { useVolumeHealth } from "../hooks/use-volume-health";

type FileTransferWorkbenchProps = {
  readonly keyValue: string;
  readonly onChanged: () => Promise<void>;
  readonly onKeyChange: (key: string) => void;
  readonly volumeId: string;
};

type UploadSelection = {
  readonly files: readonly File[];
  readonly kind: "directory" | "files";
};

export const FileTransferWorkbench = ({
  keyValue,
  onChanged,
  onKeyChange,
  volumeId,
}: FileTransferWorkbenchProps) => {
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"delete" | "download" | "upload" | null>(null);
  const writeAvailability = useVolumeHealth(volumeId);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (selection === null) {
      return;
    }
    setError(null);
    setFailedPaths([]);
    setPendingAction("upload");
    const failures: string[] = [];
    let uploaded = 0;
    for (const file of selection.files) {
      const relativePath =
        selection.kind === "directory" && file.webkitRelativePath.length > 0
          ? file.webkitRelativePath
          : file.name;
      const path =
        selection.kind === "files" && selection.files.length === 1 && !keyValue.endsWith("/")
          ? keyValue
          : `${keyValue.length === 0 || keyValue.endsWith("/") ? keyValue : `${keyValue}/`}${relativePath}`;
      try {
        await api.uploadFile(volumeId, path, file);
        uploaded += 1;
      } catch {
        failures.push(path);
      }
    }
    try {
      if (uploaded > 0) {
        await onChanged();
      }
      setFailedPaths(failures);
      setMessage(
        `${uploaded} of ${selection.files.length} ${
          selection.files.length === 1 ? "file" : "files"
        } uploaded.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog refresh failed");
    } finally {
      setPendingAction(null);
    }
  };

  const selectFiles = (files: FileList | null, kind: UploadSelection["kind"]): void => {
    const selected = files === null ? [] : Array.from(files);
    setSelection(selected.length === 0 ? null : { files: selected, kind });
    setFailedPaths([]);
    setMessage(null);
    setError(null);
  };

  const download = async () => {
    setError(null);
    setPendingAction("download");
    try {
      const blob = await api.downloadFile(volumeId, keyValue);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = keyValue.split("/").at(-1) ?? "download";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
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
      <form className="form-panel embedded" onSubmit={upload}>
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
                selectFiles(event.target.files, "files");
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
                selectFiles(event.target.files, "directory");
                event.target.value = "";
              }}
              ref={(input) => input?.setAttribute("webkitdirectory", "")}
              type="file"
            />
          </label>
        </div>
        {selection === null ? null : (
          <p className="form-note">
            {selection.files.length} {selection.files.length === 1 ? "item" : "items"} selected
          </p>
        )}
        <div className="button-row">
          <button
            className="button primary"
            disabled={
              selection === null ||
              keyValue.length === 0 ||
              volumeId.length === 0 ||
              !writeAvailability.canWrite ||
              pendingAction !== null
            }
            title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
            type="submit"
          >
            {pendingAction === "upload"
              ? "Uploading..."
              : `Upload ${selection?.files.length ?? 0} protected ${
                  selection?.files.length === 1 ? "item" : "items"
                }`}
          </button>
          <button
            className="button secondary"
            disabled={keyValue.length === 0 || pendingAction !== null}
            onClick={download}
            type="button"
          >
            <Download aria-hidden="true" size={16} /> Download
          </button>
          <button
            className="button quiet danger-text"
            disabled={
              keyValue.length === 0 || !writeAvailability.canWrite || pendingAction !== null
            }
            onClick={async () => {
              if (!window.confirm(`Delete "${keyValue}" from ${volumeId}?`)) {
                return;
              }
              setError(null);
              setPendingAction("delete");
              try {
                await api.deleteFile(volumeId, keyValue);
                await onChanged();
                setMessage(`${keyValue} was deleted.`);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Delete failed");
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
        {message === null ? null : (
          <p aria-live="polite" className="form-success">
            {message}
          </p>
        )}
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
        <p className={writeAvailability.canWrite ? "form-note" : "form-error"}>
          {writeAvailability.reason}
        </p>
      </form>
    </section>
  );
};
