import { ApiError, json, request, SESSION_KEY, sessionToken } from "./api-client";
import {
  activityEventsSchema,
  albumSchema,
  albumsSchema,
  apiTokenSchema,
  apiTokensSchema,
  backendsSchema,
  fileListingSchema,
  fileVersionSchema,
  fileVersionsSchema,
  healthSchema,
  ingestSchema,
  type MaintenancePolicyInput,
  maintenanceBatchSchema,
  maintenancePolicySchema,
  maintenanceSnapshotSchema,
  operationSchema,
  type ProtectionIncidentFilter,
  photoChecksumLookupSchema,
  photosSchema,
  protectionIncidentsSchema,
  repairReportSchema,
  sessionSchema,
  setupStatusSchema,
  systemStatusSchema,
  volumeHealthSchema,
  volumesSchema,
} from "./schemas";
import type { TransferBatchNotification } from "./transfer-manager";

export { ApiError, RETURN_TO_KEY, SESSION_KEY, sessionToken } from "./api-client";

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
  notifyTransferBatch: (body: TransferBatchNotification) =>
    request("/api/v1/transfer-notifications", {
      body: JSON.stringify(body),
      method: "POST",
    }).then(() => undefined),
  deleteAlbum: (albumId: string) =>
    request(`/api/v1/albums/${encodeURIComponent(albumId)}`, { method: "DELETE" }),
  deleteFile: (volumeId: string, key: string) =>
    request(`/api/v1/files/${encodeURIComponent(volumeId)}/${encodePath(key)}`, {
      method: "DELETE",
    }),
  deletePhoto: (photoId: string) =>
    request(`/api/v1/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" }),
  download: async (path: string): Promise<Blob> => (await request(path)).blob(),
  downloadFile: async (volumeId: string, key: string): Promise<Blob> =>
    (await request(`/api/v1/files/${encodeURIComponent(volumeId)}/${encodePath(key)}`)).blob(),
  downloadFileArchive: async (
    volumeId: string,
    selections: readonly { readonly kind: "file" | "folder"; readonly path: string }[],
  ): Promise<Blob> =>
    (
      await request(`/api/v1/volumes/${encodeURIComponent(volumeId)}/archive`, {
        body: JSON.stringify({ selections }),
        method: "POST",
      })
    ).blob(),
  downloadPhotoArchive: async (photoIds: readonly string[]): Promise<Blob> =>
    (
      await request("/api/v1/photos/archive", {
        body: JSON.stringify({ photoIds }),
        method: "POST",
      })
    ).blob(),
  getSetupStatus: () => json("/api/v1/setup/status", setupStatusSchema),
  getHealth: () => json("/api/v1/health", healthSchema),
  getMaintenance: () => json("/api/v1/maintenance", maintenanceSnapshotSchema),
  getSystemStatus: () => json("/api/v1/system/status", systemStatusSchema),
  getVolumeHealth: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/status`, volumeHealthSchema),
  listAlbums: () => json("/api/v1/albums", albumsSchema),
  listActivity: () => json("/api/v1/activity", activityEventsSchema),
  listBackends: () => json("/api/v1/backends", backendsSchema),
  listFiles: (
    volumeId: string,
    prefix: string,
    options: {
      readonly cursor?: string;
      readonly limit?: number;
      readonly search?: string;
      readonly sort?: "name" | "type";
    } = {},
  ) => {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50),
      prefix,
      search: options.search ?? "",
      sort: options.sort ?? "name",
    });
    if (options.cursor !== undefined) {
      query.set("cursor", options.cursor);
    }
    return json(
      `/api/v1/volumes/${encodeURIComponent(volumeId)}/files?${query.toString()}`,
      fileListingSchema,
    );
  },
  listFileVersions: (volumeId: string, key: string) =>
    json(`/api/v1/versions/${encodeURIComponent(volumeId)}/${encodePath(key)}`, fileVersionsSchema),
  listPhotos: () => json("/api/v1/photos", photosSchema),
  listProtectionIncidents: (status: ProtectionIncidentFilter = "all") =>
    json(
      `/api/v1/incidents?${new URLSearchParams({ status }).toString()}`,
      protectionIncidentsSchema,
    ),
  listTokens: () => json("/api/v1/tokens", apiTokensSchema),
  listVolumes: () => json("/api/v1/volumes", volumesSchema),
  removePhotoFromAlbum: (albumId: string, photoId: string) =>
    request(`/api/v1/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}`, {
      method: "DELETE",
    }),
  login: (username: string, password: string) =>
    json("/api/v1/login", sessionSchema, {
      body: JSON.stringify({ password, username }),
      method: "POST",
    }),
  logout: () => request("/api/v1/logout", { method: "POST" }),
  lookupPhotoChecksums: (checksums: readonly string[]) =>
    json("/api/v1/photos/checksums", photoChecksumLookupSchema, {
      body: JSON.stringify({ checksums }),
      method: "POST",
    }),
  changePassword: async (currentPassword: string, newPassword: string) => {
    const token = sessionToken();
    if (token === null) {
      throw new ApiError(401, "authentication required");
    }
    window.localStorage.removeItem(SESSION_KEY);
    try {
      return await request("/api/v1/password", {
        body: JSON.stringify({ currentPassword, newPassword }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        method: "PUT",
      });
    } catch (error) {
      if (sessionToken() === null) {
        window.localStorage.setItem(SESSION_KEY, token);
      }
      throw error;
    }
  },
  repair: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/repair`, repairReportSchema, {
      method: "POST",
    }),
  scrub: (volumeId: string) =>
    json(`/api/v1/volumes/${encodeURIComponent(volumeId)}/scrub`, operationSchema, {
      method: "POST",
    }),
  revokeToken: (id: string) =>
    request(`/api/v1/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restoreFileVersion: (volumeId: string, key: string, versionId: string) =>
    json(`/api/v1/versions/${encodeURIComponent(volumeId)}/restore`, fileVersionSchema, {
      body: JSON.stringify({ path: key, versionId }),
      method: "POST",
    }),
  runMaintenance: () => json("/api/v1/maintenance/run", maintenanceBatchSchema, { method: "POST" }),
  saveMaintenancePolicy: (policy: MaintenancePolicyInput) =>
    json("/api/v1/maintenance/policy", maintenancePolicySchema, {
      body: JSON.stringify(policy),
      method: "PUT",
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
  uploadPhoto: async (file: File, relativePath = file.name) => {
    const response = await request("/api/v1/photos", {
      body: file,
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-mynas-filename": encodeURIComponent(relativePath),
      },
      method: "POST",
    });
    return ingestSchema.parse(await response.json());
  },
  updateAlbum: (albumId: string, name: string) =>
    json(`/api/v1/albums/${encodeURIComponent(albumId)}`, albumSchema, {
      body: JSON.stringify({ name }),
      method: "PATCH",
    }),
};

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
