import type {
  PhotoChecksumWorkerRequest,
  PhotoChecksumWorkerResponse,
} from "./photo-checksum.worker";

export const checksumPhotoFile = (file: File, signal: AbortSignal): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Photo checksum cancelled", "AbortError"));
      return;
    }
    const id = crypto.randomUUID();
    const worker = new Worker(new URL("./photo-checksum.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = (): void => {
      cleanup();
      reject(new DOMException("Photo checksum cancelled", "AbortError"));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Photo checksum worker failed"));
    };
    worker.onmessage = (event: MessageEvent<PhotoChecksumWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      cleanup();
      if ("error" in event.data) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.checksum);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.postMessage({ file, id } satisfies PhotoChecksumWorkerRequest);
  });
