import type { z } from "zod";

import {
  albumSchema,
  albumsSchema,
  apiTokenSchema,
  backendsSchema,
  healthSchema,
  ingestSchema,
  operationSchema,
  photosSchema,
  sessionSchema,
  setupStatusSchema,
  systemStatusSchema,
  volumeHealthSchema,
  volumesSchema,
} from "./schemas";

export const SESSION_KEY = "mynas.sessionToken";
export const RETURN_TO_KEY = "mynas.returnTo";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const sessionToken = (): string | null => window.localStorage.getItem(SESSION_KEY);

const messageFor = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return `request failed with status ${response.status}`;
};

const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  const token = sessionToken();
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const message = await messageFor(response);
    if (response.status === 401 && token !== null) {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname);
      window.location.assign("/login");
    }
    throw new ApiError(response.status, message);
  }
  return response;
};

const json = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> =>
  schema.parse(await (await request(path, init)).json());

export const api = {
  addPhotoToAlbum: (albumId: string, photoId: string) =>
    json(`/api/v1/albums/${albumId}/photos/${photoId}`, albumSchema, { method: "POST" }),
  createAlbum: (name: string) =>
    json("/api/v1/albums", albumSchema, {
      body: JSON.stringify({ name }),
      method: "POST",
    }),
  createBackend: (body: Readonly<Record<string, unknown>>) =>
    json("/api/v1/backends", operationSchema, {
      body: JSON.stringify(body),
      method: "POST",
    }),
  createToken: (name: string) =>
    json("/api/v1/tokens", apiTokenSchema, {
      body: JSON.stringify({ name }),
      method: "POST",
    }),
  createVolume: (id: string, members: readonly string[]) =>
    json("/api/v1/volumes", operationSchema, {
      body: JSON.stringify({ id, kind: "mirror", members }),
      method: "POST",
    }),
  deleteFile: (volumeId: string, key: string) =>
    request(`/api/v1/files/${encodeURIComponent(volumeId)}/${encodePath(key)}`, {
      method: "DELETE",
    }),
  download: async (path: string): Promise<Blob> => (await request(path)).blob(),
  getSetupStatus: () => json("/api/v1/setup/status", setupStatusSchema),
  getHealth: () => json("/api/v1/health", healthSchema),
  getSystemStatus: () => json("/api/v1/system/status", systemStatusSchema),
  getVolumeHealth: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/status`, volumeHealthSchema),
  listAlbums: () => json("/api/v1/albums", albumsSchema),
  listBackends: () => json("/api/v1/backends", backendsSchema),
  listPhotos: () => json("/api/v1/photos", photosSchema),
  listVolumes: () => json("/api/v1/volumes", volumesSchema),
  login: (username: string, password: string) =>
    json("/api/v1/login", sessionSchema, {
      body: JSON.stringify({ password, username }),
      method: "POST",
    }),
  repair: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/repair`, operationSchema, {
      method: "POST",
    }),
  scrub: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/scrub`, operationSchema, {
      method: "POST",
    }),
  setup: (username: string, password: string) =>
    json("/api/v1/setup", operationSchema, {
      body: JSON.stringify({ password, username }),
      method: "POST",
    }),
  uploadFile: (volumeId: string, key: string, contents: Blob) =>
    json(`/api/v1/files/${encodeURIComponent(volumeId)}/${encodePath(key)}`, operationSchema, {
      body: contents,
      method: "PUT",
    }),
  uploadPhoto: async (file: File) => {
    const response = await request("/api/v1/photos", {
      body: file,
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-mynas-filename": encodeURIComponent(file.name),
      },
      method: "POST",
    });
    return ingestSchema.parse(await response.json());
  },
};

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
