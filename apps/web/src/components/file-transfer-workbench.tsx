import { Download, FileUp, Fingerprint, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api } from "../api";
import { useVolumeHealth } from "../hooks/use-volume-health";

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
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"delete" | "download" | "upload" | null>(null);
  const writeAvailability = useVolumeHealth(volumeId);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (file === null) {
      return;
    }
    setError(null);
    setPendingAction("upload");
    try {
      await api.uploadFile(volumeId, keyValue, file);
      await onChanged();
      setMessage(`${keyValue} was written with mirror protection.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setPendingAction(null);
    }
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
        <label className="file-picker">
          <FileUp aria-hidden="true" size={20} />
          <span>{file?.name ?? "Choose a file"}</span>
          <input
            onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
            required
            type="file"
          />
        </label>
        <div className="button-row">
          <button
            className="button primary"
            disabled={
              file === null ||
              keyValue.length === 0 ||
              volumeId.length === 0 ||
              !writeAvailability.canWrite ||
              pendingAction !== null
            }
            title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
            type="submit"
          >
            Upload protected copy
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
        <p className={writeAvailability.canWrite ? "form-note" : "form-error"}>
          {writeAvailability.reason}
        </p>
      </form>
    </section>
  );
};
