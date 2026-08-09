import { Download, FileUp, Fingerprint, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api } from "../api";
import { useVolumeHealth } from "../hooks/use-volume-health";

const filePath = (volumeId: string, key: string): string =>
  `/api/v1/files/${encodeURIComponent(volumeId)}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

export const FilesPage = () => {
  const [volumeId, setVolumeId] = useState("photos");
  const [key, setKey] = useState("");
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
      await api.uploadFile(volumeId, key, file);
      setMessage(`${key} was written with mirror protection.`);
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
      const blob = await api.download(filePath(volumeId, key));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = key.split("/").at(-1) ?? "download";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Exact object transfer</span>
          <h1>Files</h1>
          <p>Write or retrieve a checksummed object by its volume and path.</p>
        </div>
      </header>
      <section className="file-workbench">
        <div className="workbench-intro">
          <span className="action-icon large">
            <Fingerprint size={24} />
          </span>
          <h2>Transfer workbench</h2>
          <p>
            MyNAS verifies bytes while reading and will fall through to the healthy replica if one
            copy is corrupt.
          </p>
        </div>
        <form className="form-panel embedded" onSubmit={upload}>
          <div className="form-grid">
            <label>
              Volume
              <input
                onChange={(event) => setVolumeId(event.target.value)}
                required
                value={volumeId}
              />
            </label>
            <label>
              Object path
              <input
                className="mono"
                onChange={(event) => setKey(event.target.value)}
                placeholder="documents/archive.zip"
                required
                value={key}
              />
            </label>
          </div>
          <label className="file-picker">
            <FileUp size={20} />
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
                key.length === 0 ||
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
              disabled={key.length === 0 || pendingAction !== null}
              onClick={download}
              type="button"
            >
              <Download size={16} /> Download
            </button>
            <button
              className="button quiet danger-text"
              disabled={key.length === 0 || !writeAvailability.canWrite || pendingAction !== null}
              onClick={async () => {
                if (!window.confirm(`Delete "${key}" from ${volumeId}?`)) {
                  return;
                }
                setError(null);
                setPendingAction("delete");
                try {
                  await api.deleteFile(volumeId, key);
                  setMessage(`${key} was deleted.`);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Delete failed");
                } finally {
                  setPendingAction(null);
                }
              }}
              title={writeAvailability.canWrite ? undefined : writeAvailability.reason}
              type="button"
            >
              <Trash2 size={16} /> Delete
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
    </div>
  );
};
