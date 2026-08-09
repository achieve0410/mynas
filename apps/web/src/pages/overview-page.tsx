import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Cloud, Folder, HardDrive } from "lucide-react";

import { api } from "../api";
import { navigate } from "../router";

const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const OverviewPage = () => {
  const status = useQuery({ queryFn: api.getSystemStatus, queryKey: ["system-status"] });
  const backends = useQuery({ queryFn: api.listBackends, queryKey: ["backends"] });
  const volumes = useQuery({ queryFn: api.listVolumes, queryKey: ["volumes"] });
  const hasMirror = (volumes.data?.length ?? 0) > 0;
  const volumeHealth = useQuery({
    enabled: hasMirror,
    queryFn: async () =>
      Promise.all((volumes.data ?? []).map((volume) => api.getVolumeHealth(volume.id))),
    queryKey: ["overview-volume-health", volumes.data?.map(({ id }) => id)],
  });
  const healthKnown = hasMirror && volumeHealth.isSuccess;
  const degraded =
    healthKnown && volumeHealth.data.some(({ status: health }) => health === "degraded");
  const protectedState =
    healthKnown && volumeHealth.data.every(({ status: health }) => health === "healthy");
  const healthUnknown = hasMirror && !healthKnown;
  const localCapacities =
    backends.data?.flatMap((backend) =>
      backend.capacityBytes === undefined ? [] : [backend.capacityBytes],
    ) ?? [];
  const localAvailableBytes =
    backends.data?.flatMap((backend) =>
      backend.availableBytes === undefined ? [] : [backend.availableBytes],
    ) ?? [];
  const localCapacity = localCapacities.length > 0 ? Math.min(...localCapacities) : 0;
  const localAvailable = localAvailableBytes.length > 0 ? Math.min(...localAvailableBytes) : 0;
  const lastProbe = backends.dataUpdatedAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
        backends.dataUpdatedAt,
      )
    : "Checking";

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">System overview</span>
          <h1>Your private storage, at a glance</h1>
          <p>Health, protection, and the last things that deserve your attention.</p>
        </div>
        <span className="version-badge">v{status.data?.version ?? "0.1.0"}</span>
      </header>
      {backends.isError || volumes.isError || status.isError ? (
        <section className="status-strip warning-strip">
          <HardDrive size={19} />
          <div>
            <strong>System status is incomplete</strong>
            <span>MyNAS will not claim protection until every health request succeeds.</span>
          </div>
          <button
            className="button quiet"
            onClick={() => {
              backends.refetch();
              volumes.refetch();
              status.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </section>
      ) : null}
      {protectedState ? (
        <section className="status-strip">
          <CheckCircle2 size={19} />
          <div>
            <strong>All mirror members answered healthy</strong>
            <span>Live backend probes completed at {lastProbe}.</span>
          </div>
        </section>
      ) : null}

      <section className={`health-board ${protectedState ? "healthy" : "needs-setup"}`}>
        <div className="health-summary">
          {protectedState ? <CheckCircle2 size={26} /> : <HardDrive size={26} />}
          <span className="eyebrow">
            {degraded
              ? "Action required"
              : protectedState
                ? "Protected"
                : healthUnknown
                  ? "Checking protection"
                  : "Storage setup"}
          </span>
          <h2>
            {degraded
              ? "A mirror member is unavailable"
              : protectedState
                ? "Your mirror is healthy"
                : healthUnknown
                  ? "Confirming both replicas"
                  : "Connect two storage members"}
          </h2>
          <p>
            {degraded
              ? "Writes are paused until both copies are available again."
              : protectedState
                ? "MyNAS is tracking both members and will refuse writes if protection is lost."
                : healthUnknown
                  ? "No protection claim is shown until every member answers a live probe."
                  : "Add local directories or an S3 backend, then create a two-member mirror."}
          </p>
          <dl className="health-facts">
            <div>
              <dt>Mirror capacity</dt>
              <dd>{localCapacity > 0 ? formatBytes(localCapacity) : "Not reported"}</dd>
            </div>
            <div>
              <dt>Available locally</dt>
              <dd>{localCapacity > 0 ? formatBytes(localAvailable) : "Not reported"}</dd>
            </div>
            <div>
              <dt>Last scrub result</dt>
              <dd>Not run in this session</dd>
            </div>
          </dl>
        </div>
        <ul aria-label="Storage members" className="member-list">
          {backends.data?.map((backend) => (
            <li className="member-row" key={backend.id}>
              {backend.kind === "s3" ? <Cloud size={18} /> : <Folder size={18} />}
              <div>
                <strong>{backend.id}</strong>
                <span>{backend.kind === "s3" ? "S3 compatible" : "Local directory"}</span>
              </div>
              <span
                className={`state-label ${backend.status === "unavailable" ? "danger-state" : ""}`}
              >
                {backend.status ?? "checking"}
              </span>
            </li>
          ))}
        </ul>
        <button className="button secondary" onClick={() => navigate("/storage")} type="button">
          Manage storage <ArrowRight size={16} />
        </button>
      </section>

      <section className="section-block recent-work">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Recent work</span>
            <h2>Continue where you left off</h2>
          </div>
        </div>
        <div className="action-list">
          <button onClick={() => navigate("/photos")} type="button">
            <span className="action-icon">P</span>
            <span>
              <strong>Photo library</strong>
              <small>Upload, browse, and collect originals.</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <button onClick={() => navigate("/files")} type="button">
            <span className="action-icon">F</span>
            <span>
              <strong>File transfer</strong>
              <small>Put or retrieve an exact object by path.</small>
            </span>
            <ArrowRight size={17} />
          </button>
        </div>
      </section>
    </div>
  );
};
