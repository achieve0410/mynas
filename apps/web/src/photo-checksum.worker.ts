/// <reference lib="webworker" />

export type PhotoChecksumWorkerRequest = {
  readonly file: File;
  readonly id: string;
};

export type PhotoChecksumWorkerResponse =
  | {
      readonly checksum: string;
      readonly id: string;
    }
  | {
      readonly error: string;
      readonly id: string;
    };

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<PhotoChecksumWorkerRequest>) => {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await event.data.file.arrayBuffer());
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    scope.postMessage({ checksum, id: event.data.id } satisfies PhotoChecksumWorkerResponse);
  } catch (cause) {
    scope.postMessage({
      error: cause instanceof Error ? cause.message : "Photo checksum failed",
      id: event.data.id,
    } satisfies PhotoChecksumWorkerResponse);
  }
};
