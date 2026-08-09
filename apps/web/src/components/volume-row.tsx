import { useMutation, useQuery } from "@tanstack/react-query";
import { HardDrive, RefreshCw, Wrench } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { Volume } from "../schemas";

export const VolumeRow = ({ volume }: { readonly volume: Volume }) => {
  const [message, setMessage] = useState<string | null>(null);
  const health = useQuery({
    queryFn: () => api.getVolumeHealth(volume.id),
    queryKey: ["volume-health", volume.id],
  });
  const scrub = useMutation({
    mutationFn: () => api.scrub(volume.id),
    onSuccess: () => setMessage("Scrub completed."),
  });
  const repair = useMutation({
    mutationFn: () => api.repair(volume.id),
    onSuccess: async () => {
      setMessage("Repair completed.");
      await health.refetch();
    },
  });
  const operationError = scrub.error ?? repair.error;

  return (
    <article className="volume-row">
      <span className="row-icon">
        <HardDrive size={18} />
      </span>
      <div>
        <strong>{volume.id}</strong>
        <small>{volume.members.join(" + ")}</small>
        {health.data?.unavailable.length ? (
          <small className="danger-text">Unavailable: {health.data.unavailable.join(", ")}</small>
        ) : null}
        <small>{message ?? "Last scrub: not run in this session"}</small>
      </div>
      <div className="row-actions">
        <span className={`state-label ${health.data?.status === "degraded" ? "danger-state" : ""}`}>
          {health.data?.status ?? "checking"}
        </span>
        <button
          className="button quiet"
          disabled={scrub.isPending || health.data === undefined}
          onClick={() => scrub.mutate()}
          type="button"
        >
          <RefreshCw size={15} /> Scrub
        </button>
        <button
          className="button quiet"
          disabled={repair.isPending || health.data?.status !== "degraded"}
          onClick={() => {
            if (window.confirm(`Repair mirror "${volume.id}" from its healthy replicas?`)) {
              repair.mutate();
            }
          }}
          title={
            health.data?.status === "degraded"
              ? "Restore unavailable replicas from a healthy member"
              : "Repair becomes available when a mirror is degraded"
          }
          type="button"
        >
          <Wrench size={15} /> Repair
        </button>
        {message === null ? null : (
          <span aria-live="polite" className="sr-only">
            {message}
          </span>
        )}
        {operationError === null || operationError === undefined ? null : (
          <span aria-live="polite" className="form-error">
            {operationError.message}
          </span>
        )}
      </div>
    </article>
  );
};
