import type { AppInstance, AppServices } from "./types";

export const registerActivityRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/activity", (context) => context.json(services.activity.list()));
  app.get("/api/activity", (context) => context.json(services.activity.list()));
};
