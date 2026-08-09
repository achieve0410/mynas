import { type FormEvent, useState } from "react";

import { api } from "../api";

type BackendFormProps = {
  readonly onAdded: () => Promise<void>;
};

export const BackendForm = ({ onAdded }: BackendFormProps) => {
  const [kind, setKind] = useState<"local" | "s3">("local");
  const [id, setId] = useState("");
  const [root, setRoot] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [accessKeyIdEnv, setAccessKeyIdEnv] = useState("MYNAS_S3_ACCESS_KEY_ID");
  const [secretAccessKeyEnv, setSecretAccessKeyEnv] = useState("MYNAS_S3_SECRET_ACCESS_KEY");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createBackend(
        kind === "local"
          ? { id, kind, root }
          : {
              accessKeyIdEnv,
              bucket,
              endpoint,
              id,
              kind,
              region,
              secretAccessKeyEnv,
            },
      );
      await onAdded();
      setId("");
      setRoot("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backend creation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-panel" onSubmit={submit}>
      <div>
        <span className="eyebrow">Add storage</span>
        <h2>Connect a backend</h2>
      </div>
      <label>
        Backend kind
        <select onChange={(event) => setKind(event.target.value === "s3" ? "s3" : "local")}>
          <option value="local">Local directory</option>
          <option value="s3">S3 compatible</option>
        </select>
      </label>
      <label>
        Backend ID
        <input
          onChange={(event) => setId(event.target.value)}
          placeholder={kind === "local" ? "disk-a" : "archive-s3"}
          required
          value={id}
        />
      </label>
      {kind === "local" ? (
        <label>
          Absolute path
          <input
            className="mono"
            onChange={(event) => setRoot(event.target.value)}
            placeholder="/Volumes/MyDisk"
            required
            value={root}
          />
        </label>
      ) : (
        <>
          <label>
            Endpoint
            <input
              className="mono"
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://s3.example.com"
              required
              type="url"
              value={endpoint}
            />
          </label>
          <div className="form-grid">
            <label>
              Bucket
              <input onChange={(event) => setBucket(event.target.value)} required value={bucket} />
            </label>
            <label>
              Region
              <input onChange={(event) => setRegion(event.target.value)} required value={region} />
            </label>
          </div>
          <label>
            Access-key environment variable
            <input
              className="mono"
              onChange={(event) => setAccessKeyIdEnv(event.target.value)}
              required
              value={accessKeyIdEnv}
            />
          </label>
          <label>
            Secret-key environment variable
            <input
              className="mono"
              onChange={(event) => setSecretAccessKeyEnv(event.target.value)}
              required
              value={secretAccessKeyEnv}
            />
          </label>
        </>
      )}
      <button className="button primary" disabled={submitting} type="submit">
        Add backend
      </button>
      {error === null ? null : (
        <p aria-live="polite" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
};
