import { z } from "zod";

import type { ByteRange } from "../../../packages/storage/src/adapter";
import {
  CatalogError,
  type FileListCursor,
  type FileVersion,
} from "../../../packages/storage/src/catalog";
import { MirrorError } from "../../../packages/storage/src/mirror";
import type { BackendConfig } from "../../../packages/storage/src/registry";

import type { AppInstance, AppServices } from "./types";
import { createZip } from "./zip";

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

const archiveSchema = z.object({
  selections: z
    .array(
      z.object({
        kind: z.enum(["file", "folder"]),
        path: z.string().min(1),
      }),
    )
    .min(1)
    .max(100),
});

const fileListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  prefix: z.string().default(""),
});

const fileListCursorSchema = z.object({
  kind: z.enum(["file", "folder"]),
  path: z.string(),
});

const decodeFileCursor = (cursor: string | undefined): FileListCursor | null => {
  if (cursor === undefined) {
    return null;
  }
  try {
    return fileListCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch (error) {
    throw new CatalogError("invalid_page", "invalid file cursor", { cause: error });
  }
};

const encodeFileCursor = (cursor: FileListCursor | null): string | null =>
  cursor === null ? null : Buffer.from(JSON.stringify(cursor)).toString("base64url");

const currentBlob = (versions: readonly FileVersion[]) => {
  const current = versions.at(-1);
  if (current?.blob === null || current === undefined) {
    throw new MirrorError("not_found", "file not found");
  }
  return current.blob;
};

const MAX_FILE_UPLOAD_BYTES = 64 * 1_024 * 1_024;

const parseRange = (header: string | undefined, size: number): ByteRange | "invalid" | null => {
  if (header === undefined) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (match === null) {
    return "invalid";
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
    return "invalid";
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

  app.get("/api/v1/volumes/:volume/files", (context) => {
    const query = fileListQuerySchema.parse(context.req.query());
    const listing = services.registry
      .getCatalog(context.req.param("volume"))
      .listCurrent(query.prefix, query.limit, decodeFileCursor(query.cursor));
    return context.json({
      ...listing,
      nextCursor: encodeFileCursor(listing.nextCursor),
    });
  });

  app.post("/api/v1/volumes/:volume/archive", async (context) => {
    const { selections } = archiveSchema.parse(await context.req.json());
    const volumeId = context.req.param("volume");
    const volume = await services.registry.getVolume(volumeId);
    const catalog = services.registry.getCatalog(volumeId);
    const currentPaths = catalog.listCurrentPaths();
    const selectedPaths = [
      ...new Set(
        selections.flatMap((selection) =>
          selection.kind === "file"
            ? [selection.path]
            : currentPaths.filter((path) => path.startsWith(`${selection.path}/`)),
        ),
      ),
    ].sort();
    if (selectedPaths.length === 0) {
      throw new CatalogError("not_found", "no files matched the archive selection");
    }
    const entries = await Promise.all(
      selectedPaths.map(async (path) => ({ contents: await volume.get(path), path })),
    );
    const archive = createZip(entries);
    return new Response(exactArrayBuffer(archive), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="mynas-files.zip"',
        "content-length": String(archive.byteLength),
        "content-type": "application/zip",
      },
    });
  });

  app.post("/api/v1/volumes/:id/scrub", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("id"));
    return context.json(await volume.scrub());
  });

  app.post("/api/v1/volumes/:id/repair", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("id"));
    return context.json(await volume.repair());
  });

  app.put("/api/v1/files/:volume/:path{.+}", async (context) => {
    const declaredLength = Number(context.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_UPLOAD_BYTES) {
      return context.json(
        { error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" } },
        413,
      );
    }
    const volume = await services.registry.getVolume(context.req.param("volume"));
    const contents = new Uint8Array(await context.req.arrayBuffer());
    if (contents.byteLength > MAX_FILE_UPLOAD_BYTES) {
      return context.json(
        { error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" } },
        413,
      );
    }
    const version = await volume.put(context.req.param("path"), contents);
    return context.json(version, 201);
  });

  app.get("/api/v1/files/:volume/:path{.+}", async (context) => {
    const volume = await services.registry.getVolume(context.req.param("volume"));
    const path = context.req.param("path");
    const versions = volume.versions(path);
    const blob = currentBlob(versions);
    const range = parseRange(context.req.header("range"), blob.size);
    if (range === "invalid") {
      return new Response(
        JSON.stringify({ error: { code: "invalid_range", message: "range is unsatisfiable" } }),
        {
          headers: {
            "content-range": `bytes */${blob.size}`,
            "content-type": "application/json",
          },
          status: 416,
        },
      );
    }
    const contents = await volume.get(path);
    const body = range === null ? contents : contents.slice(range.start, range.endExclusive);
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "no-store",
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
    const catalog = services.registry.getCatalog(context.req.param("volume"));
    return context.json(catalog.listVersions(context.req.param("path")));
  });

  app.post("/api/v1/versions/:volume/restore", async (context) => {
    const body = restoreSchema.parse(await context.req.json());
    const volume = await services.registry.getVolume(context.req.param("volume"));
    return context.json(await volume.restore(body.path, body.versionId), 201);
  });
};
