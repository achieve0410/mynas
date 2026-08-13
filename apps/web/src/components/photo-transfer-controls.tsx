import { FolderUp, Upload } from "lucide-react";
import { useState } from "react";

import { api } from "../api";

type PhotoTransferControlsProps = {
  readonly canWrite: boolean;
  readonly onUploaded: () => Promise<void>;
  readonly reason: string;
};

type UploadSelection = {
  readonly files: readonly File[];
  readonly kind: "directory" | "files";
};

const photoTypes = ".heic,.jpeg,.jpg,.png,image/heic,image/heif,image/jpeg,image/png";

const pathFor = (file: File, kind: UploadSelection["kind"]): string =>
  kind === "directory" && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;

export const PhotoTransferControls = ({
  canWrite,
  onUploaded,
  reason,
}: PhotoTransferControlsProps) => {
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const upload = async (): Promise<void> => {
    if (selection === null) {
      return;
    }
    setFailedPaths([]);
    setMessage(null);
    setPending(true);
    const failures: string[] = [];
    let uploaded = 0;
    for (const file of selection.files) {
      const path = pathFor(file, selection.kind);
      try {
        await api.uploadPhoto(file, path);
        uploaded += 1;
      } catch {
        failures.push(path);
      }
    }
    if (uploaded > 0) {
      await onUploaded();
    }
    setFailedPaths(failures);
    setMessage(`${uploaded} of ${selection.files.length} photos uploaded.`);
    setPending(false);
  };

  const select = (files: FileList | null, kind: UploadSelection["kind"]): void => {
    const selected = files === null ? [] : Array.from(files);
    setSelection(selected.length === 0 ? null : { files: selected, kind });
    setFailedPaths([]);
    setMessage(null);
  };

  return (
    <div className="photo-transfer-controls">
      <div className="button-row">
        <label
          className={`button primary upload-button ${canWrite ? "" : "disabled-control"}`}
          title={canWrite ? undefined : reason}
        >
          <Upload size={16} />
          Choose photos
          <input
            accept={photoTypes}
            data-testid="photo-upload"
            disabled={pending || !canWrite}
            multiple
            onChange={(event) => {
              select(event.target.files, "files");
              event.target.value = "";
            }}
            type="file"
          />
        </label>
        <label
          className={`button secondary upload-button ${canWrite ? "" : "disabled-control"}`}
          title={canWrite ? undefined : reason}
        >
          <FolderUp size={16} />
          Choose photo folder
          <input
            accept={photoTypes}
            data-testid="photo-directory-upload"
            disabled={pending || !canWrite}
            multiple
            onChange={(event) => {
              select(event.target.files, "directory");
              event.target.value = "";
            }}
            ref={(input) => input?.setAttribute("webkitdirectory", "")}
            type="file"
          />
        </label>
        <button
          className="button primary"
          disabled={selection === null || pending || !canWrite}
          onClick={() => {
            void upload();
          }}
          type="button"
        >
          {pending ? "Uploading..." : `Upload ${selection?.files.length ?? 0}`}
        </button>
      </div>
      {message === null ? null : (
        <p aria-live="polite" className="form-success">
          {message}
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
    </div>
  );
};
