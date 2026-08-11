import { History } from "lucide-react";

import type { MaintenanceRun } from "../schemas";

const runName = (run: MaintenanceRun): string =>
  run.kind === "catalog_backup" ? "Catalog backup" : "Volume scrub";

const formatDate = (value: string): string => new Date(value).toLocaleString();

export const MaintenanceHistory = ({ runs }: { readonly runs: readonly MaintenanceRun[] }) => (
  <section aria-label="Maintenance history" className="maintenance-history">
    <div className="maintenance-history-heading">
      <div>
        <span className="eyebrow">Run ledger</span>
        <h3>Maintenance history</h3>
      </div>
      <History aria-hidden="true" size={18} />
    </div>
    {runs.length === 0 ? <p>No maintenance runs yet.</p> : null}
    <ul>
      {runs.map((run) => (
        <li data-status={run.status} key={run.id}>
          <div>
            <strong>{runName(run)}</strong>
            <small>
              {run.trigger === "manual" ? "Manual" : "Scheduled"} ·{" "}
              {formatDate(run.finishedAt ?? run.startedAt)}
            </small>
            {run.outputPath === null ? null : <code>{run.outputPath}</code>}
            {run.error === null ? null : <small className="danger-text">{run.error}</small>}
          </div>
          <span
            className={`state-label ${
              run.status === "failed"
                ? "danger-state"
                : run.status === "running"
                  ? "running-state"
                  : ""
            }`}
          >
            {run.status}
          </span>
        </li>
      ))}
    </ul>
  </section>
);
