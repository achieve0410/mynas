import { z } from "zod";

import { AuthError } from "../../../packages/auth/src/auth";
import { MYNAS_VERSION } from "../../../packages/version/src/version";

import type { AppInstance, AppServices } from "./types";

const credentialsSchema = z.object({
  password: z.string().min(12),
  username: z.string().min(1),
});

const tokenSchema = z.object({
  name: z.string().min(1),
});

const isLoopbackRequestHost = (value: string): boolean => {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLowerCase();
    return ["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "localhost"].includes(hostname);
  } catch {
    return false;
  }
};

const bearerToken = (authorization: string | undefined): string | null => {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length);
  return token.length === 0 ? null : token;
};

const authenticate = (services: AppServices, token: string) => {
  try {
    return services.auth.authenticateSession(token);
  } catch (error) {
    if (!(error instanceof AuthError)) {
      throw error;
    }
  }
  return services.auth.authenticateApiToken(token);
};

export const registerPublicAuthRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/health", (context) => context.json({ status: "ok" }));

  app.get("/api/v1/setup/status", (context) => {
    const count = services.database
      .query<{ readonly count: number }, []>("SELECT COUNT(*) AS count FROM users")
      .get()?.count;
    return context.json({ setupComplete: count === 1 });
  });

  app.post("/api/v1/setup", async (context) => {
    const requestHost = context.req.header("host") ?? new URL(context.req.url).host;
    if (!isLoopbackRequestHost(requestHost)) {
      return context.json(
        { error: { code: "setup_forbidden", message: "loopback request host required" } },
        403,
      );
    }
    const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json") {
      return context.json(
        { error: { code: "unsupported_media_type", message: "JSON content type required" } },
        415,
      );
    }
    const origin = context.req.header("origin");
    if (origin !== undefined && origin !== new URL(context.req.url).origin) {
      return context.json(
        { error: { code: "setup_forbidden", message: "cross-origin owner setup is forbidden" } },
        403,
      );
    }
    const body = credentialsSchema.parse(await context.req.json());
    const user = await services.auth.setupOwner(
      body.username,
      body.password,
      services.peerAddress(context.req.raw),
    );
    return context.json(user, 201);
  });

  app.post("/api/v1/login", async (context) => {
    const body = credentialsSchema.parse(await context.req.json());
    return context.json(
      await services.auth.login(
        body.username,
        body.password,
        services.peerAddress(context.req.raw),
      ),
    );
  });
};

export const registerAuthMiddleware = (app: AppInstance, services: AppServices): void => {
  app.use("/api/v1/*", async (context, next) => {
    const token = bearerToken(context.req.header("authorization"));
    if (token === null) {
      return context.json(
        { error: { code: "unauthorized", message: "authentication required" } },
        401,
      );
    }
    try {
      context.set("user", authenticate(services, token));
    } catch (error) {
      if (!(error instanceof AuthError)) {
        throw error;
      }
      return context.json({ error: { code: "unauthorized", message: "invalid token" } }, 401);
    }
    await next();
  });
};

export const registerProtectedAuthRoutes = (app: AppInstance, services: AppServices): void => {
  app.get("/api/v1/system/status", (context) =>
    context.json({ setupComplete: true, version: MYNAS_VERSION }),
  );

  app.post("/api/v1/logout", (context) => {
    const token = bearerToken(context.req.header("authorization"));
    if (token === null) {
      return context.json(
        { error: { code: "unauthorized", message: "authentication required" } },
        401,
      );
    }
    services.auth.logout(token);
    return context.body(null, 204);
  });

  app.post("/api/v1/tokens", async (context) => {
    const body = tokenSchema.parse(await context.req.json());
    return context.json(services.auth.createApiToken(context.get("user").id, body.name), 201);
  });

  app.get("/api/v1/tokens", (context) =>
    context.json(services.auth.listApiTokens(context.get("user").id)),
  );

  app.delete("/api/v1/tokens/:id", (context) => {
    services.auth.revokeApiToken(context.get("user").id, context.req.param("id"));
    return context.body(null, 204);
  });
};
