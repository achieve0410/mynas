import { z } from "zod";

import { PhotoService } from "../../../packages/photos/src/photos";

import type { AppInstance, AppServices } from "./types";
import { createZip } from "./zip";

const filenameSchema = z
  .string()
  .transform((encoded, context) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      context.addIssue({ code: "custom", message: "filename must be URI encoded" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          !path.includes("\0") &&
          path
            .split("/")
            .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
        "filename must be a safe relative path",
      ),
  );
const albumSchema = z.object({ name: z.string().trim().min(1).max(120) });
const photoArchiveSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(500),
});
const MAX_PHOTO_UPLOAD_BYTES = 25 * 1_024 * 1_024;

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

const serviceFor = async (services: AppServices): Promise<PhotoService> =>
  new PhotoService(services.database, await services.registry.getVolume("photos"));

const contentTypeFor = (format: "heic" | "jpeg" | "png"): string =>
  format === "jpeg" ? "image/jpeg" : format === "heic" ? "image/heic" : "image/png";

export const registerPhotoRoutes = (app: AppInstance, services: AppServices): void => {
  app.post("/api/v1/photos", async (context) => {
    const declaredLength = Number(context.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_UPLOAD_BYTES) {
      return context.json(
        { error: { code: "payload_too_large", message: "photo exceeds 25 MiB limit" } },
        413,
      );
    }
    const filename = filenameSchema.parse(context.req.header("x-mynas-filename"));
    const contents = new Uint8Array(await context.req.arrayBuffer());
    if (contents.byteLength > MAX_PHOTO_UPLOAD_BYTES) {
      return context.json(
        { error: { code: "payload_too_large", message: "photo exceeds 25 MiB limit" } },
        413,
      );
    }
    const result = await (await serviceFor(services)).ingest({ contents, filename });
    return context.json(result, 201);
  });

  app.get("/api/v1/photos", async (context) =>
    context.json((await serviceFor(services)).listTimeline()),
  );

  app.post("/api/v1/photos/archive", async (context) => {
    const { photoIds } = photoArchiveSchema.parse(await context.req.json());
    const service = await serviceFor(services);
    const photos = [...new Set(photoIds)].map((photoId) => service.getPhoto(photoId));
    const entries = await Promise.all(
      photos.map(async (photo) => ({
        contents: await service.getOriginal(photo.id),
        path: photo.filename,
      })),
    );
    const archive = createZip(entries);
    return new Response(exactArrayBuffer(archive), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="mynas-photos.zip"',
        "content-length": String(archive.byteLength),
        "content-type": "application/zip",
      },
    });
  });

  app.get("/api/v1/photo-jobs/:id", async (context) =>
    context.json((await serviceFor(services)).getJob(context.req.param("id"))),
  );

  app.get("/api/v1/photos/:id/preview", async (context) => {
    const contents = await (await serviceFor(services)).getPreview(context.req.param("id"));
    return new Response(exactArrayBuffer(contents), {
      headers: { "cache-control": "no-store", "content-type": "image/webp" },
    });
  });

  app.get("/api/v1/photos/:id/original", async (context) => {
    const service = await serviceFor(services);
    const photo = service.getPhoto(context.req.param("id"));
    const contents = await service.getOriginal(photo.id);
    return new Response(exactArrayBuffer(contents), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(photo.filename)}`,
        "content-type": contentTypeFor(photo.format),
      },
    });
  });

  app.post("/api/v1/albums", async (context) => {
    const body = albumSchema.parse(await context.req.json());
    return context.json((await serviceFor(services)).createAlbum(body.name), 201);
  });

  app.get("/api/v1/albums", async (context) =>
    context.json((await serviceFor(services)).listAlbums()),
  );

  app.get("/api/v1/albums/:id", async (context) =>
    context.json((await serviceFor(services)).getAlbum(context.req.param("id"))),
  );

  app.post("/api/v1/albums/:albumId/photos/:photoId", async (context) =>
    context.json(
      (await serviceFor(services)).addToAlbum(
        context.req.param("albumId"),
        context.req.param("photoId"),
      ),
    ),
  );
};
