import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../api";

const formatAction = (action: string): string =>
  action
    .split(".")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export const ActivityPage = () => {
  const activity = useQuery({ queryFn: api.listActivity, queryKey: ["activity"] });
  const [outcome, setOutcome] = useState<"all" | "failure" | "success">("all");
  const [action, setAction] = useState("all");
  const [refreshState, setRefreshState] = useState<"complete" | "failed" | "idle" | "refreshing">(
    "idle",
  );
  const actions = useMemo(
    () => [...new Set((activity.data ?? []).map((event) => event.action))].sort(),
    [activity.data],
  );
  const events = useMemo(
    () =>
      (activity.data ?? []).filter(
        (event) =>
          (outcome === "all" || event.outcome === outcome) &&
          (action === "all" || event.action === action),
      ),
    [action, activity.data, outcome],
  );

  return (
    <div className="page" data-refresh-state={refreshState} data-testid="activity-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Transfer history</span>
          <h1>Activity</h1>
          <p>Review completed operations and clear failure reasons from every client.</p>
        </div>
        <Activity aria-hidden="true" size={30} />
      </header>

      <section aria-label="Activity controls" className="library-toolbar activity-toolbar">
        <label>
          Outcome
          <select
            data-testid="activity-outcome-filter"
            onChange={(event) => {
              const value = event.target.value;
              setOutcome(value === "failure" || value === "success" ? value : "all");
            }}
            value={outcome}
          >
            <option value="all">All outcomes</option>
            <option value="success">Completed</option>
            <option value="failure">Failed</option>
          </select>
        </label>
        <label>
          Action
          <select
            data-testid="activity-action-filter"
            onChange={(event) => setAction(event.target.value)}
            value={action}
          >
            <option value="all">All actions</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {formatAction(value)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          data-testid="refresh-activity"
          disabled={refreshState === "refreshing"}
          onClick={() => {
            setRefreshState("refreshing");
            void activity
              .refetch()
              .then((result) => setRefreshState(result.isError ? "failed" : "complete"));
          }}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          {refreshState === "refreshing"
            ? "Refreshing..."
            : refreshState === "failed"
              ? "Refresh failed"
              : "Refresh"}
        </button>
      </section>

      {activity.isPending ? <p aria-busy="true">Loading activity...</p> : null}
      {activity.isError ? <p className="form-error">{activity.error.message}</p> : null}
      {!activity.isPending && !activity.isError && events.length === 0 ? (
        <section className="empty-state">
          <SearchX aria-hidden="true" size={28} />
          <h2>No matching activity</h2>
          <p>New transfer outcomes will appear here.</p>
        </section>
      ) : null}
      <ol className="activity-list" data-order="newest-first" data-testid="activity-list">
        {events.map((event) => (
          <li className="activity-row" data-outcome={event.outcome} key={event.id}>
            <span aria-hidden="true" className={`activity-status ${event.outcome}`} />
            <div>
              <div className="activity-heading">
                <strong>{formatAction(event.action)}</strong>
                <span className={`activity-outcome-label ${event.outcome}`}>
                  {event.outcome === "success" ? "Completed" : "Failed"}
                </span>
              </div>
              <span className="mono">
                {event.resource?.path ?? event.resource?.kind ?? "System"}
              </span>
              {event.errorMessage === null ? null : <p>{event.errorMessage}</p>}
            </div>
            <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
          </li>
        ))}
      </ol>
    </div>
  );
};
