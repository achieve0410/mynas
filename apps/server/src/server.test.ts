import { expect, test } from "bun:test";

import * as serverModule from "./server";

type ServerFetch = (
  request: Request,
  server: { readonly timeout: (request: Request, seconds: number) => void },
) => Response | Promise<Response>;

type CreateServerFetch = (fetch: (request: Request) => Response | Promise<Response>) => ServerFetch;

test("applies the maximum Bun request timeout only to long photo posts", async () => {
  const createServerFetch = Reflect.get(serverModule, "createServerFetch") as
    | CreateServerFetch
    | undefined;
  expect(typeof createServerFetch).toBe("function");
  if (createServerFetch === undefined) {
    return;
  }

  const delegated: string[] = [];
  const timeouts: Array<{ readonly path: string; readonly seconds: number }> = [];
  const fetch = createServerFetch((request) => {
    delegated.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response(null, { status: 204 });
  });
  const server = {
    timeout: (request: Request, seconds: number) => {
      timeouts.push({ path: new URL(request.url).pathname, seconds });
    },
  };

  await fetch(new Request("http://localhost/api/v1/photos", { method: "POST" }), server);
  await fetch(
    new Request("http://localhost/api/v1/photos/metadata/backfill", { method: "POST" }),
    server,
  );
  await fetch(new Request("http://localhost/api/v1/photos", { method: "GET" }), server);
  await fetch(new Request("http://localhost/api/v1/files/photos", { method: "POST" }), server);

  expect(delegated).toEqual([
    "POST /api/v1/photos",
    "POST /api/v1/photos/metadata/backfill",
    "GET /api/v1/photos",
    "POST /api/v1/files/photos",
  ]);
  expect(timeouts).toEqual([
    { path: "/api/v1/photos", seconds: 255 },
    { path: "/api/v1/photos/metadata/backfill", seconds: 255 },
  ]);
});
