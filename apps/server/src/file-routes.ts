import { z } from "zod";

import { CatalogError, type FileListCursor } from "../../../packages/storage/src/catalog";

import { recordActivity } from "./activity";
import {
  currentBlob,
  exactArrayBuffer,
  type FileTransfer,
  InvalidRangeError,
  parseRange,
} from "./file-transfer";
import type { AppInstance, AppServices } from "./types";
import { createZip } from "./zip";

const restoreSchema = z.object({
  path: z.string().min(1),
  versionId: z.string().uuid(),
});

const archiveSchema = z.object({
  selections: z
    .array(z.object({ kind: z.enum(["file", "folder"]), path: z.string().min(1) }))
    .min(1)
    .max(100),
});

const fileListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  prefix: z.string().default(""),
  search: z.string().max(256).default(""),
  sort: z.enum(["name", "type"]).default("name"),
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

const MAX_FILE_UPLOAD_BYTES = 64 * 1_024 * 1_024;

export const registerFileRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/volumes/:volume/files", (context) => {
    const query = fileListQuerySchema.parse(context.req.query());
    const listing = services.registry
      .getCatalog(context.req.param("volume"))
      .listCurrent(query.prefix, query.limit, decodeFileCursor(query.cursor), {
        search: query.search,
        sort: query.sort,
      });
    return context.json({
      ...listing,
      nextCursor: encodeFileCursor(listing.nextCursor),
    });
  });

  app.post("/api/v1/volumes/:volume/archive", async (context) => {
    const { selections } = archiveSchema.parse(await context.req.json());
    const volumeId = context.req.param("volume");
    const archive = await recordActivity(
      services,
      "file.archive.download",
      { kind: "file-archive", path: `${selections.length} selected entries` },
      async () => {
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
        return createZip(
          await Promise.all(
            selectedPaths.map(async (path) => ({ contents: await volume.get(path), path })),
          ),
        );
      },
    );
    return new Response(exactArrayBuffer(archive), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="mynas-files.zip"',
        "content-length": String(archive.byteLength),
        "content-type": "application/zip",
      },
    });
  });

  app.put("/api/v1/files/:volume/:path{.+}", async (context) => {
    const path = context.req.param("path");
    const resource = { kind: "file", path } as const;
    const declaredLength = Number(context.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_UPLOAD_BYTES) {
      services.activity.record({
        action: "file.upload",
        error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" },
        outcome: "failure",
        resource,
      });
      return context.json(
        { error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" } },
        413,
      );
    }
    const contents = new Uint8Array(await context.req.arrayBuffer());
    if (contents.byteLength > MAX_FILE_UPLOAD_BYTES) {
      services.activity.record({
        action: "file.upload",
        error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" },
        outcome: "failure",
        resource,
      });
      return context.json(
        { error: { code: "payload_too_large", message: "file exceeds 64 MiB limit" } },
        413,
      );
    }
    const version = await recordActivity(services, "file.upload", resource, async () => {
      const volume = await services.registry.getVolume(context.req.param("volume"));
      return volume.put(path, contents);
    });
    return context.json(version, 201);
  });

  app.get("/api/v1/files/:volume/:path{.+}", async (context) => {
    const path = context.req.param("path");
    const resource = { kind: "file", path } as const;
    let transfer: FileTransfer;
    try {
      transfer = await recordActivity(services, "file.download", resource, async () => {
        const volume = await services.registry.getVolume(context.req.param("volume"));
        const blob = currentBlob(volume.versions(path));
        const range = parseRange(context.req.header("range"), blob.size);
        if (range === "invalid") {
          throw new InvalidRangeError("range is unsatisfiable");
        }
        return { blob, contents: await volume.get(path), range };
      });
    } catch (error) {
      if (!(error instanceof InvalidRangeError)) {
        throw error;
      }
      const volume = await services.registry.getVolume(context.req.param("volume"));
      const blob = currentBlob(volume.versions(path));
      return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
        headers: {
          "content-range": `bytes */${blob.size}`,
          "content-type": "application/json",
        },
        status: 416,
      });
    }
    const { blob, contents, range } = transfer;
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
