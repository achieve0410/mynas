import { useQuery } from "@tanstack/react-query";
import { RefreshCw, SearchX, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../api";
import { ProtectionError, ProtectionLoading } from "../components/protection-states";
import type { ProtectionIncident, ProtectionIncidentFilter } from "../schemas";

const dateTime = (value: string): string => new Date(value).toLocaleString();
const mergeNewestFirst = (
  history: readonly ProtectionIncident[],
  active: readonly ProtectionIncident[],
): readonly ProtectionIncident[] => {
  const unique = new Map(history.map((incident) => [incident.id, incident]));
  for (const incident of active) {
    unique.set(incident.id, incident);
  }
  return [...unique.values()].sort(
    (left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt) || right.id.localeCompare(left.id),
  );
};

export const ProtectionPage = () => {
  const incidents = useQuery({
    queryFn: () => api.listProtectionIncidents("all"),
    queryKey: ["protection-incidents", "all"],
  });
  const activeIncidents = useQuery({
    queryFn: () => api.listProtectionIncidents("active"),
    queryKey: ["protection-incidents", "active"],
  });
  const [status, setStatus] = useState<ProtectionIncidentFilter>("active");
  const [refreshState, setRefreshState] = useState<"failed" | "idle" | "refreshing">("idle");
  const visible = useMemo(() => {
    const history = incidents.data ?? [];
    const active = activeIncidents.data ?? [];
    if (status === "active") {
      return active;
    }
    if (status === "resolved") {
      return history.filter((incident) => incident.status === "resolved");
    }
    return mergeNewestFirst(history, active);
  }, [activeIncidents.data, incidents.data, status]);
  const activeCount = activeIncidents.data?.length ?? 0;
  const hasAnyIncident = (incidents.data?.length ?? 0) + activeCount > 0;
  const unavailable = incidents.isError || activeIncidents.isError;
  const checking =
    incidents.isFetching || activeIncidents.isFetching || refreshState === "refreshing";
  const protectionState = unavailable
    ? "unknown"
    : checking
      ? "checking"
      : activeCount > 0
        ? "attention"
        : "protected";
  const stateTitle =
    protectionState === "unknown"
      ? "Protection status unavailable"
      : protectionState === "checking"
        ? "Checking protection history"
        : protectionState === "attention"
          ? "Action required"
          : "No active protection incidents";
  const stateDetail =
    protectionState === "unknown"
      ? "MyNAS will not claim protection until the incident ledger responds."
      : protectionState === "checking"
        ? "Reading durable backup and scrub signals."
        : protectionState === "attention"
          ? `${activeCount === 100 ? "At least " : ""}${activeCount} unresolved maintenance signal${
              activeCount === 1 ? "" : "s"
            }.`
          : "Maintenance has no unresolved backup or scrub failures.";
  const refresh = (): void => {
    setRefreshState("refreshing");
    void Promise.all([incidents.refetch(), activeIncidents.refetch()]).then((results) => {
      setRefreshState(results.some(({ isError }) => isError) ? "failed" : "idle");
    });
  };

  return (
    <div className="page narrow-page" data-testid="protection-page">
      <header className="page-heading protection-heading">
        <div>
          <span className="eyebrow">Persistent recovery signals</span>
          <h1>Protection</h1>
          <p>
            Track unresolved catalog-backup and volume-scrub failures across restarts, with the
            exact action needed to recover.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={30} />
      </header>

      <section
        aria-live="polite"
        className={`status-strip ${
          protectionState === "attention" || protectionState === "unknown" ? "warning-strip" : ""
        }`}
        data-state={protectionState}
        data-testid="protection-state"
        role="status"
      >
        {protectionState === "attention" || protectionState === "unknown" ? (
          <ShieldAlert aria-hidden="true" size={20} />
        ) : protectionState === "checking" ? (
          <RefreshCw aria-hidden="true" size={20} />
        ) : (
          <ShieldCheck aria-hidden="true" size={20} />
        )}
        <div>
          <strong>{stateTitle}</strong>
          <span>{stateDetail}</span>
        </div>
      </section>

      <section aria-label="Protection controls" className="library-toolbar activity-toolbar">
        <label>
          Status
          <select
            data-testid="incident-status-filter"
            onChange={(event) => {
              const value = event.target.value;
              setStatus(value === "active" || value === "resolved" ? value : "all");
            }}
            value={status}
          >
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="all">All incidents</option>
          </select>
        </label>
        {unavailable ? null : (
          <button
            className="button secondary"
            data-testid="refresh-protection"
            disabled={refreshState === "refreshing"}
            onClick={refresh}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {refreshState === "refreshing" ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </section>

      {checking && !unavailable ? <ProtectionLoading /> : null}
      {unavailable ? (
        <ProtectionError
          message={
            incidents.error?.message ??
            activeIncidents.error?.message ??
            "The incident ledger did not respond."
          }
          onRetry={refresh}
        />
      ) : null}
      {!checking && !unavailable && visible.length === 0 ? (
        <section
          className="empty-state compact"
          data-empty-state={hasAnyIncident ? "filtered" : "pristine"}
        >
          <SearchX aria-hidden="true" size={28} />
          <h2>
            {hasAnyIncident ? "No incidents in this view" : "No protection incidents recorded"}
          </h2>
          <p>
            {hasAnyIncident
              ? "Change the status filter to review other protection history."
              : "Future backup or scrub failures will appear here with recovery guidance."}
          </p>
        </section>
      ) : null}

      <ol className="activity-list" data-order="newest-first" data-testid="incident-list">
        {checking || unavailable
          ? null
          : visible.map((incident) => (
              <li
                className="activity-row protection-incident"
                data-severity={incident.severity}
                data-status={incident.status}
                key={incident.id}
              >
                <span
                  aria-hidden="true"
                  className={`activity-status ${
                    incident.status === "active" ? "failure" : "success"
                  }`}
                />
                <div>
                  <div className="activity-heading">
                    <strong>{incident.title}</strong>
                    <span
                      className={`activity-outcome-label ${
                        incident.status === "active" ? "failure" : "success"
                      }`}
                    >
                      {incident.status === "active" ? "Active" : "Resolved"}
                    </span>
                    <span
                      className={`incident-severity ${incident.severity}`}
                      data-field="severity"
                    >
                      {incident.severity}
                    </span>
                  </div>
                  <p className="incident-impact" data-field="impact">
                    {incident.impact}
                  </p>
                  <p className="incident-remediation" data-field="remediation">
                    <strong>Next action:</strong> {incident.remediation}
                  </p>
                  <span className="mono">Observed {incident.occurrenceCount} time(s)</span>
                  <span className="mono">
                    First seen{" "}
                    <time dateTime={incident.firstSeenAt}>{dateTime(incident.firstSeenAt)}</time>
                  </span>
                  <span className="mono">
                    Last seen{" "}
                    <time dateTime={incident.lastSeenAt}>{dateTime(incident.lastSeenAt)}</time>
                  </span>
                </div>
              </li>
            ))}
      </ol>
    </div>
  );
};
