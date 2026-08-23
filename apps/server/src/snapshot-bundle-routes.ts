import { z } from "zod";

import { sha256 } from "../../../packages/snapshots/src/manifest";
import { SnapshotError } from "../../../packages/snapshots/src/models";

import { recordActivity } from "./activity";
import type { AppInstance, AppServices } from "./types";

const chunkIndexSchema = z.coerce.number().int().nonnegative();
const signatureHeaderSchema = z.string().min(1).max(256);

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer =>
  contents.buffer.slice(
    contents.byteOffset,
    contents.byteOffset + contents.byteLength,
  ) as ArrayBuffer;

const signatureFromHeader = (value: string | undefined): Uint8Array => {
  const encoded = signatureHeaderSchema.parse(value);
  const signature = Buffer.from(encoded, "base64");
  if (signature.toString("base64") !== encoded) {
    throw new SnapshotError("invalid", "manifest signature encoding is invalid");
  }
  return signature;
};

const binaryResponse = (contents: Uint8Array, contentType: string, etag: boolean): Response =>
  new Response(exactArrayBuffer(contents), {
    headers: {
      "cache-control": "no-store",
      "content-length": String(contents.byteLength),
      "content-type": contentType,
      ...(etag ? { etag: `"sha256:${sha256(contents)}"` } : {}),
    },
  });

export const registerSnapshotBundleRoutes = (app: AppInstance, services: AppServices): void => {
  app.post("/api/v1/snapshot-bundles", async (context) => {
    const bundle = await recordActivity(
      services,
      "snapshot-bundle.begin",
      { kind: "snapshot-bundle", path: "new" },
      async () => services.snapshots.begin(await context.req.json()),
    );
    return context.json(bundle, 201);
  });

  app.get("/api/v1/snapshot-bundles", (context) => context.json(services.snapshots.list()));

  app.put("/api/v1/snapshot-bundles/:id/chunks/:index", async (context) => {
    const id = context.req.param("id");
    const index = chunkIndexSchema.parse(context.req.param("index"));
    const contents = new Uint8Array(await context.req.arrayBuffer());
    const chunk = await recordActivity(
      services,
      "snapshot-bundle.chunk.upload",
      { kind: "snapshot-bundle", path: id },
      async () =>
        services.snapshots.uploadChunk(
          id,
          index,
          contents,
          context.req.header("x-mynas-sha256") ?? "",
        ),
    );
    return context.json(chunk, 201);
  });

  app.put("/api/v1/snapshot-bundles/:id/manifest", async (context) => {
    const id = context.req.param("id");
    const manifest = new Uint8Array(await context.req.arrayBuffer());
    const signature = signatureFromHeader(context.req.header("x-mynas-signature"));
    const bundle = await recordActivity(
      services,
      "snapshot-bundle.complete",
      { kind: "snapshot-bundle", path: id },
      async () => services.snapshots.complete(id, manifest, signature),
    );
    return context.json(bundle);
  });

  app.get("/api/v1/snapshot-bundles/:id/manifest", async (context) =>
    binaryResponse(
      await services.snapshots.readManifest(context.req.param("id")),
      "application/json",
      true,
    ),
  );

  app.get("/api/v1/snapshot-bundles/:id/signature", async (context) =>
    binaryResponse(
      await services.snapshots.readSignature(context.req.param("id")),
      "application/octet-stream",
      false,
    ),
  );

  app.get("/api/v1/snapshot-bundles/:id/chunks/:index", async (context) =>
    binaryResponse(
      await services.snapshots.readChunk(
        context.req.param("id"),
        chunkIndexSchema.parse(context.req.param("index")),
      ),
      "application/octet-stream",
      true,
    ),
  );

  app.delete("/api/v1/snapshot-bundles/:id", async (context) => {
    const id = context.req.param("id");
    await recordActivity(
      services,
      "snapshot-bundle.delete",
      { kind: "snapshot-bundle", path: id },
      async () => services.snapshots.delete(id),
    );
    return context.body(null, 204);
  });
};
