import { join } from "node:path";

import type { AppInstance } from "./types";

const defaultWebRoot = join(import.meta.dir, "../../web/dist");
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join("; ");

const serve = async (path: string): Promise<Response | null> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  return new Response(file, {
    headers: {
      "cache-control": path.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "content-security-policy": contentSecurityPolicy,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
};

export const registerWebRoutes = (app: AppInstance, webRoot = defaultWebRoot): void => {
  app.get("*", async (context) => {
    const requestPath = context.req.path;
    if (requestPath.startsWith("/api/")) {
      return context.notFound();
    }

    const relativePath = requestPath.slice(1);
    if (relativePath.length > 0 && !relativePath.includes("..")) {
      const asset = await serve(join(webRoot, relativePath));
      if (asset !== null) {
        return asset;
      }
    }

    const index = await serve(join(webRoot, "index.html"));
    return index ?? context.notFound();
  });
};
