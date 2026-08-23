import { z } from "zod";

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
};
