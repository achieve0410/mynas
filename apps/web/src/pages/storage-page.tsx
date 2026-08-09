import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Folder, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import { BackendForm } from "../components/backend-form";
import { VolumeRow } from "../components/volume-row";

export const StoragePage = () => {
  const queryClient = useQueryClient();
  const backends = useQuery({ queryFn: api.listBackends, queryKey: ["backends"] });
  const volumes = useQuery({ queryFn: api.listVolumes, queryKey: ["volumes"] });
  const volumeHealth = useQueries({
    queries: (volumes.data ?? []).map((volume) => ({
      queryFn: () => api.getVolumeHealth(volume.id),
      queryKey: ["volume-health", volume.id],
    })),
  });
  const [volumeId, setVolumeId] = useState("photos");
  const [members, setMembers] = useState<readonly string[]>([]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["backends"] }),
      queryClient.invalidateQueries({ queryKey: ["volumes"] }),
    ]);
  };
  const addVolume = useMutation({
    mutationFn: () => api.createVolume(volumeId, members),
    onSuccess: refresh,
  });
  const degraded = volumeHealth.some((health) => health.data?.status === "degraded");
  const checking =
    (volumes.data?.length ?? 0) > 0 &&
    volumeHealth.some((health) => health.isPending || health.isError);
  const lastProbe = backends.dataUpdatedAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
        backends.dataUpdatedAt,
      )
    : "checking";

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Storage fabric</span>
          <h1>Backends and mirrors</h1>
          <p>Keep two independent members healthy before writing irreplaceable data.</p>
        </div>
      </header>
      {backends.isError || volumes.isError ? (
        <section className="status-strip warning-strip">
          <ShieldCheck size={19} />
          <div>
            <strong>Storage status could not be loaded</strong>
            <span>Writes remain guarded by the server while this view is unavailable.</span>
          </div>
          <button
            className="button quiet"
            onClick={() => {
              backends.refetch();
              volumes.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </section>
      ) : null}

      <section
        className={`status-strip ${
          degraded || checking || !volumes.data?.length ? "warning-strip" : ""
        }`}
      >
        <ShieldCheck size={19} />
        <div>
          <strong>
            {degraded
              ? "A mirror member is unavailable"
              : checking
                ? "Checking mirror health"
                : volumes.data?.length
                  ? "All mirror members are healthy"
                  : "Action required"}
          </strong>
          <span>
            {degraded
              ? "Protected writes are paused until every member is available."
              : volumes.data?.length
                ? `${volumes.data.length} volume; backend probes last completed at ${lastProbe}.`
                : "Create a two-member volume to enable protected writes."}
          </span>
        </div>
      </section>

      <section className="split-layout">
        <div className="section-block">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Members</span>
              <h2>Connected backends</h2>
            </div>
            <span className="count-badge">{backends.data?.length ?? 0}</span>
          </div>
          <div className="data-list">
            {backends.data?.map((backend) => (
              <div className="data-row" key={backend.id}>
                <span className="row-icon">
                  {backend.kind === "s3" ? <Cloud size={17} /> : <Folder size={17} />}
                </span>
                <div>
                  <strong>{backend.id}</strong>
                  <small>{backend.kind === "s3" ? "S3 compatible" : "Local directory"}</small>
                  <small>
                    {backend.capacityBytes === undefined
                      ? "Capacity not reported"
                      : `${Math.round((backend.availableBytes ?? 0) / 1_000_000_000)} GB available`}
                  </small>
                </div>
                <span
                  className={`state-label ${
                    backend.status === "unavailable" ? "danger-state" : ""
                  }`}
                >
                  {backend.status ?? "checking"}
                </span>
              </div>
            )) ?? <p className="empty-copy">No backends yet.</p>}
          </div>
        </div>

        <BackendForm onAdded={refresh} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Protection</span>
            <h2>Mirror volumes</h2>
          </div>
        </div>
        <div className="volume-list">
          {volumes.data?.map((volume) => (
            <VolumeRow key={volume.id} volume={volume} />
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            addVolume.mutate();
          }}
        >
          <label>
            Volume ID
            <input
              onChange={(event) => setVolumeId(event.target.value)}
              required
              value={volumeId}
            />
          </label>
          <fieldset>
            <legend>Choose two members</legend>
            <div className="checkbox-row">
              {backends.data?.map((backend) => (
                <label key={backend.id}>
                  <input
                    checked={members.includes(backend.id)}
                    onChange={(event) =>
                      setMembers((current) =>
                        event.target.checked
                          ? [...current, backend.id]
                          : current.filter((id) => id !== backend.id),
                      )
                    }
                    type="checkbox"
                  />
                  {backend.id}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="button secondary"
            disabled={members.length !== 2 || addVolume.isPending}
            type="submit"
          >
            Create mirror
          </button>
          {addVolume.isError ? (
            <p aria-live="polite" className="form-error">
              {addVolume.error.message}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
};
