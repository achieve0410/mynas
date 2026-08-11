import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { api } from "../api";
import { MaintenanceHistory } from "./maintenance-history";

type Notice = {
  readonly message: string;
  readonly tone: "danger" | "success";
};

const formatDate = (value: string | null): string =>
  value === null ? "Not scheduled" : new Date(value).toLocaleString();

export const MaintenanceSettings = () => {
  const queryClient = useQueryClient();
  const maintenance = useQuery({
    queryFn: api.getMaintenance,
    queryKey: ["maintenance"],
  });
  const [enabled, setEnabled] = useState(false);
  const [backupDirectory, setBackupDirectory] = useState("");
  const [backupIntervalHours, setBackupIntervalHours] = useState("24");
  const [scrubIntervalHours, setScrubIntervalHours] = useState("168");
  const [retentionCount, setRetentionCount] = useState("2");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (dirty) {
      return;
    }
    const policy = maintenance.data?.policy;
    if (policy !== null && policy !== undefined) {
      setEnabled(policy.enabled);
      setBackupDirectory(policy.backupDirectory);
      setBackupIntervalHours(String(policy.backupIntervalHours));
      setScrubIntervalHours(String(policy.scrubIntervalHours));
      setRetentionCount(String(policy.retentionCount));
    }
  }, [dirty, maintenance.data?.policy]);

  const savePolicy = useMutation({
    mutationFn: () =>
      api.saveMaintenancePolicy({
        backupDirectory,
        backupIntervalHours: Number(backupIntervalHours),
        enabled,
        retentionCount: Number(retentionCount),
        scrubIntervalHours: Number(scrubIntervalHours),
      }),
    onMutate: () => setNotice(null),
    onSuccess: async () => {
      setDirty(false);
      setNotice({ message: "Maintenance policy saved.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });
  const runMaintenance = useMutation({
    mutationFn: api.runMaintenance,
    onMutate: () => setNotice(null),
    onSuccess: async (batch) => {
      setNotice(
        batch.runs.some(({ status }) => status === "failed")
          ? { message: "Maintenance finished with failures.", tone: "danger" }
          : { message: "Maintenance completed.", tone: "success" },
      );
      await queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await savePolicy.mutateAsync();
  };
  const operationError = savePolicy.error ?? runMaintenance.error ?? maintenance.error;
  const markDirty = (): void => {
    setDirty(true);
    setNotice(null);
  };
  const heading = (
    <div className="settings-heading">
      <span className="row-icon">
        <RefreshCw aria-hidden="true" size={18} />
      </span>
      <div>
        <h2>Maintenance</h2>
        <p>Keep a verified catalog copy and inspect every mirrored volume on a schedule.</p>
      </div>
    </div>
  );

  if (maintenance.isPending) {
    return (
      <section className="settings-section maintenance-settings">
        {heading}
        <p role="status">Loading maintenance policy…</p>
      </section>
    );
  }

  if (maintenance.isError) {
    return (
      <section className="settings-section maintenance-settings">
        {heading}
        <p aria-live="polite" className="form-error">
          {maintenance.error.message}
        </p>
        <button className="button secondary" onClick={() => maintenance.refetch()} type="button">
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="settings-section maintenance-settings">
      {heading}
      <form className="maintenance-form" onSubmit={submit}>
        <div className="maintenance-toggle">
          <input
            aria-describedby="maintenance-enabled-help"
            checked={enabled}
            id="maintenance-enabled"
            onChange={(event) => {
              setEnabled(event.target.checked);
              markDirty();
            }}
            type="checkbox"
          />
          <div>
            <label htmlFor="maintenance-enabled">Enable automatic maintenance</label>
            <small id="maintenance-enabled-help">
              The service schedules each operation from its last finished attempt.
            </small>
          </div>
        </div>
        <div className="maintenance-field">
          <label htmlFor="maintenance-backup-directory">Backup directory</label>
          <input
            aria-describedby="maintenance-backup-help"
            className="mono"
            id="maintenance-backup-directory"
            onChange={(event) => {
              setBackupDirectory(event.target.value);
              markDirty();
            }}
            placeholder="/Volumes/SafeDisk/MyNAS Backups"
            required
            value={backupDirectory}
          />
          <small id="maintenance-backup-help">
            Use an absolute path outside the MyNAS data directory.
          </small>
        </div>
        <div className="maintenance-fields">
          <label>
            Backup interval hours
            <input
              max="8760"
              min="1"
              onChange={(event) => {
                setBackupIntervalHours(event.target.value);
                markDirty();
              }}
              required
              type="number"
              value={backupIntervalHours}
            />
          </label>
          <label>
            Scrub interval hours
            <input
              max="8760"
              min="1"
              onChange={(event) => {
                setScrubIntervalHours(event.target.value);
                markDirty();
              }}
              required
              type="number"
              value={scrubIntervalHours}
            />
          </label>
          <label>
            Backups to keep
            <input
              max="100"
              min="1"
              onChange={(event) => {
                setRetentionCount(event.target.value);
                markDirty();
              }}
              required
              type="number"
              value={retentionCount}
            />
          </label>
        </div>
        <div className="maintenance-actions">
          <button className="button primary" disabled={savePolicy.isPending} type="submit">
            Save maintenance policy
          </button>
          <button
            className="button secondary"
            disabled={runMaintenance.isPending || maintenance.data.policy === null}
            onClick={() => runMaintenance.mutate()}
            type="button"
          >
            <Play aria-hidden="true" size={15} />
            Run maintenance now
          </button>
        </div>
      </form>
      {operationError === null || operationError === undefined ? null : (
        <p aria-live="polite" className="form-error">
          {operationError.message}
        </p>
      )}
      {notice === null ? null : (
        <p aria-live="polite" className={notice.tone === "danger" ? "danger-text" : "form-success"}>
          {notice.message}
        </p>
      )}
      <dl className="maintenance-schedule">
        <div>
          <dt>Next catalog backup</dt>
          <dd>{formatDate(maintenance.data.nextDue.backupAt)}</dd>
        </div>
        <div>
          <dt>Next volume scrub</dt>
          <dd>{formatDate(maintenance.data.nextDue.scrubAt)}</dd>
        </div>
      </dl>
      <MaintenanceHistory runs={maintenance.data.runs} />
    </section>
  );
};
