import type { TransferProgress } from "../transfer-api";

export type TransferRow = TransferProgress & {
  readonly error?: string;
  readonly id: string;
  readonly label: string;
  readonly status: "complete" | "failed" | "queued" | "transferring";
};

type TransferProgressListProps = {
  readonly kind: "file" | "photo";
  readonly operation?: "download" | "upload";
  readonly rows: readonly TransferRow[];
};

const bytes = (value: number): string =>
  value < 1_024 ? `${value} B` : `${(value / 1_024).toFixed(1)} KiB`;

export const TransferProgressList = ({
  kind,
  operation = "upload",
  rows,
}: TransferProgressListProps) =>
  rows.length === 0 ? null : (
    <ul aria-label="Transfer progress" aria-live="polite" className="transfer-list">
      {rows.map((row) => (
        <li
          className="transfer-row"
          data-status={row.status}
          data-testid={`transfer-${kind}-${row.id}`}
          key={row.id}
        >
          <div className="transfer-row-heading">
            <strong>{row.label}</strong>
            <span>{row.status === "transferring" ? "In progress" : row.status}</span>
          </div>
          <progress
            aria-label={`${row.label} ${operation} progress`}
            aria-valuemax={row.percent === null ? undefined : 100}
            aria-valuemin={row.percent === null ? undefined : 0}
            aria-valuenow={row.status === "complete" ? 100 : (row.percent ?? undefined)}
            max={100}
            value={row.status === "complete" ? 100 : (row.percent ?? undefined)}
          />
          <small>
            {bytes(row.loaded)}
            {row.total === null ? "" : ` of ${bytes(row.total)}`}
            {row.error === undefined ? "" : ` — ${row.error}`}
          </small>
        </li>
      ))}
    </ul>
  );
