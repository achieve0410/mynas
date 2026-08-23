import { ApiError, sessionToken } from "./api";

export type TransferProgress = {
  readonly loaded: number;
  readonly percent: number | null;
  readonly total: number | null;
};

const responseMessage = (body: string, fallback: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "object" &&
      parsed.error !== null &&
      "message" in parsed.error &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const authorization = (): string => {
  const token = sessionToken();
  if (token === null) {
    throw new ApiError(401, "authentication required");
  }
  return `Bearer ${token}`;
};

export const uploadWithProgress = (
  method: "POST" | "PUT",
  path: string,
  body: Blob,
  onProgress: (progress: TransferProgress) => void,
  headers: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError(0, "request aborted"));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = (): void => request.abort();
    const cleanup = (): void => signal?.removeEventListener("abort", abort);
    request.open(method, path);
    request.setRequestHeader("authorization", authorization());
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable ? event.total : body.size;
      onProgress({
        loaded: event.loaded,
        percent: total > 0 ? Math.round((event.loaded / total) * 100) : null,
        total: total > 0 ? total : null,
      });
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress({ loaded: body.size, percent: 100, total: body.size });
        cleanup();
        resolve(request.responseText);
        return;
      }
      cleanup();
      reject(
        new ApiError(
          request.status,
          responseMessage(request.responseText, `request failed with ${request.status}`),
        ),
      );
    });
    request.addEventListener("error", () => {
      cleanup();
      reject(new ApiError(0, "network request failed"));
    });
    request.addEventListener("abort", () => {
      cleanup();
      reject(new ApiError(0, "request aborted"));
    });
    signal?.addEventListener("abort", abort, { once: true });
    request.send(body);
  });

export const downloadWithProgress = async (
  path: string,
  onProgress: (progress: TransferProgress) => void,
  init: RequestInit = {},
): Promise<Blob> => {
  const headers = new Headers(init.headers);
  headers.set("authorization", authorization());
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      responseMessage(await response.text(), `request failed with ${response.status}`),
    );
  }
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader === null ? null : Number(totalHeader);
  if (response.body === null) {
    const blob = await response.blob();
    onProgress({ loaded: blob.size, percent: 100, total: blob.size });
    return blob;
  }
  const chunks: ArrayBuffer[] = [];
  const reader = response.body.getReader();
  let loaded = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(new Uint8Array(result.value).slice().buffer);
    loaded += result.value.byteLength;
    onProgress({
      loaded,
      percent: total !== null && total > 0 ? Math.round((loaded / total) * 100) : null,
      total,
    });
  }
  onProgress({ loaded, percent: 100, total: total ?? loaded });
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
};
