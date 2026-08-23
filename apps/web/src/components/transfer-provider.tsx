import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { api } from "../api";
import { type TransferBatchSummary, TransferManager } from "../transfer-manager";
import { TransferProgressList } from "./transfer-progress-list";

const TransferContext = createContext<TransferManager | null>(null);
const batchText = (batch: TransferBatchSummary): string => {
  const kind = batch.kind === "photo" ? "photos" : "files";
  const operation = batch.operation === "download" ? "downloaded" : "uploaded";
  if (batch.complete + batch.failed === batch.total) {
    const failures = batch.failed === 0 ? "" : ` ${batch.failed} failed.`;
    return `${batch.complete} of ${batch.total} ${kind} ${operation}.${failures}`;
  }
  return `${batch.complete + batch.failed} of ${batch.total} ${kind} processed; ${
    batch.queued
  } queued, ${batch.transferring} in progress, ${batch.paused} paused, ${batch.failed} failed.`;
};

export const useTransferManager = (): TransferManager => {
  const manager = useContext(TransferContext);
  if (manager === null) {
    throw new Error("transfer manager is unavailable");
  }
  return manager;
};

export const TransferProvider = ({ children }: { readonly children: ReactNode }) => {
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const manager = useMemo(
    () =>
      new TransferManager({
        concurrency: 3,
        notify: api.notifyTransferBatch,
      }),
    [],
  );
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );

  useEffect(() => {
    const resumeWhenVisible = (): void => {
      if (document.visibilityState === "visible") {
        manager.resume();
      }
    };
    window.addEventListener("online", manager.resume);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      window.removeEventListener("online", manager.resume);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      manager.dispose();
    };
  }, [manager]);

  const hasFinished = snapshot.batches.some(
    (batch) => batch.complete + batch.failed === batch.total,
  );
  const failedTasks = snapshot.tasks.filter(({ status }) => status === "failed");
  const transferSignature = JSON.stringify({
    batches: snapshot.batches,
    notificationErrors: snapshot.notificationErrors,
    tasks: snapshot.tasks.map(({ error, id, status }) => ({ error, id, status })),
  });
  const hasTransferContent =
    snapshot.batches.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.notificationErrors.length > 0;
  const showTransferCenter = hasTransferContent && dismissedSignature !== transferSignature;

  return (
    <TransferContext.Provider value={manager}>
      {children}
      {showTransferCenter ? (
        <aside
          aria-label="Background transfers"
          className="transfer-center"
          data-testid="transfer-center"
        >
          <header>
            <div>
              <span className="eyebrow">Background work</span>
              <strong>Transfers</strong>
            </div>
            <div className="transfer-center-actions">
              <button
                className="button quiet"
                disabled={!hasFinished}
                onClick={() => manager.clearFinished()}
                type="button"
              >
                Clear finished
              </button>
              <button
                aria-label="Close background transfers"
                className="button quiet icon-button"
                onClick={() => setDismissedSignature(transferSignature)}
                title="Close background transfers"
                type="button"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          {snapshot.batches.map((batch) => (
            <p
              aria-live="polite"
              className={
                batch.complete + batch.failed === batch.total ? "form-success" : "form-note"
              }
              data-testid="transfer-batch-summary"
              key={batch.id}
            >
              {batchText(batch)}
            </p>
          ))}
          <TransferProgressList kind="file" rows={snapshot.tasks} />
          {failedTasks.length === 0 ? null : (
            <div aria-live="polite" className="upload-failures">
              <strong>Failed paths</strong>
              <ul>
                {failedTasks.map((task) => (
                  <li className="mono" key={task.id}>
                    {task.path} — {task.error ?? "Transfer failed"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshot.notificationErrors.length === 0 ? null : (
            <div className="form-error transfer-notification-error">
              <span>Slack notification pending: {snapshot.notificationErrors.join("; ")}</span>
              <button
                className="button quiet"
                onClick={() => manager.retryNotifications()}
                type="button"
              >
                Retry
              </button>
            </div>
          )}
        </aside>
      ) : null}
    </TransferContext.Provider>
  );
};
