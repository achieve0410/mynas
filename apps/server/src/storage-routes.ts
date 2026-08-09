import { z } from "zod";

import type { ByteRange } from "../../../packages/storage/src/adapter";
import type { FileVersion } from "../../../packages/storage/src/catalog";
import { MirrorError } from "../../../packages/storage/src/mirror";
import type { BackendConfig } from "../../../packages/storage/src/registry";

import type { AppInstance, AppServices } from "./types";

const backendSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("local"),
    root: z.string().min(1),
  }),
  z.object({
    accessKeyIdEnv: z.string().min(1),
    bucket: z.string().min(1),
    endpoint: z.url(),
    id: z.string().min(1),
    kind: z.literal("s3"),
    prefix: z.string().min(1).optional(),
    region: z.string().min(1),
    secretAccessKeyEnv: z.string().min(1),
  }),
]);

const volumeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("mirror"),
  members: z.tuple([z.string().min(1), z.string().min(1)]),
});

const restoreSchema = z.object({
  path: z.string().min(1),
  versionId: z.string().uuid(),
});

const currentBlob = (versions: readonly FileVersion[]) => {
  const current = versions.at(-1);
  if (current?.blob === null || current === undefined) {
    throw new MirrorError("not_found", "file not found");
  }
  return current.blob;
};

const parseRange = (header: string | undefined, size: number): ByteRange | null => {
  if (header === undefined) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (match === null) {
    throw new RangeError("invalid range");
  }
  const start = Number(match[1]);
  const inclusiveEnd = match[2] === "" ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(inclusiveEnd) ||
    start < 0 ||
    inclusiveEnd < start ||
    inclusiveEnd >= size
  ) {
    throw new RangeError("invalid range");
  }
  return { endExclusive: inclusiveEnd + 1, start };
};

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

export const registerStorageRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/backends", async (context) =>
    context.json(await services.registry.listBackends()),
  );

  app.post("/api/v1/backends", async (context) => {
    const config: BackendConfig = backendSchema.parse(await context.req.json());
    const health = await services.registry.addBackend(config);
    return context.json({ id: config.id, kind: config.kind, status: health.status }, 201);
  });

  app.get("/api/v1/backends/:id/probe", async (context) => {
    const backend = await services.registry.getBackend(context.req.param("id"));
    return context.json(await backend.probe());
  });

  app.get("/api/v1/volumes", (context) => context.json(services.registry.listVolumes()));

  app.post("/api/v1/volumes", async (context) => {
    const body = volumeSchema.parse(await context.req.json());
    await services.registry.addMirror(body.id, body.members);
    return context.json({ id: body.id, kind: body.kind, members: body.members }, 201);
  });

  app.get("/api/v1/volumes/:id/status", async (context) =>
    context.json(await services.registry.getVolumeHealth(context.req.param("id"))),
  );

  app.post("/api/v1/volumes/:id/scrub", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("id"));
    return context.json(await volume.scrub());
  });

  app.post("/api/v1/volumes/:id/repair", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("id"));
    return context.json(await volume.repair());
  });

  app.put("/api/v1/files/:volume/:path{.+}", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("volume"));
    const contents = new Uint8Array(await context.req.arrayBuffer());
    const version = await volume.put(context.req.param("path"), contents);
    return context.json(version, 201);
  });

  app.get("/api/v1/files/:volume/:path{.+}", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("volume"));
    const path = context.req.param("path");
    const versions = volume.versions(path);
    const blob = currentBlob(versions);
    const range = parseRange(context.req.header("range"), blob.size);
    const contents = await volume.get(path);
    const body = range === null ? contents : contents.slice(range.start, range.endExclusive);
    const headers = new Headers({
      "accept-ranges": "bytes",
      "content-length": String(body.byteLength),
      "content-type": "application/octet-stream",
      etag: `"sha256:${blob.checksum}"`,
    });
    if (range !== null) {
      headers.set("content-range", `bytes ${range.start}-${range.endExclusive - 1}/${blob.size}`);
    }
    return new Response(exactArrayBuffer(body), {
      headers,
      status: range === null ? 200 : 206,
    });
  });

  app.delete("/api/v1/files/:volume/:path{.+}", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("volume"));
    await volume.delete(context.req.param("path"));
    return context.body(null, 204);
  });

  app.get("/api/v1/versions/:volume/:path{.+}", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("volume"));
    return context.json(volume.versions(context.req.param("path")));
  });

  app.post("/api/v1/versions/:volume/restore", async (context) => {
    const body = restoreSchema.parse(await context.req.json());
    const volume = await services.registry.getVolume(context.req.param("volume"));
    return context.json(await volume.restore(body.path, body.versionId), 201);
  });
};
