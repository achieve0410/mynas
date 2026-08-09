import { mkdir } from "node:fs/promises";
import { type APIRequestContext, expect } from "@playwright/test";
import { z } from "zod";

const dataDir = "/tmp/mynas-playwright";
const ownerPassword = "synthetic browser owner passphrase";
const loginSchema = z.object({ token: z.string().min(32) });

export const syntheticJpegFilename = "합성-풍경-長い写真.jpg";

const authorize = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

export const prepareOwnerAndMirror = async (request: APIRequestContext): Promise<string> => {
  await mkdir(`${dataDir}/disk-a`, { recursive: true });
  await mkdir(`${dataDir}/disk-b`, { recursive: true });

  const setup = await request.post("/api/v1/setup", {
    data: { password: ownerPassword, username: "owner" },
  });
  expect(setup.status()).toBe(201);

  const login = await request.post("/api/v1/login", {
    data: { password: ownerPassword, username: "owner" },
  });
  expect(login.status()).toBe(200);
  const token = loginSchema.parse(await login.json()).token;

  for (const id of ["disk-a", "disk-b"]) {
    const backend = await request.post("/api/v1/backends", {
      data: { id, kind: "local", root: `${dataDir}/${id}` },
      headers: authorize(token),
    });
    expect(backend.status()).toBe(201);
  }

  const volume = await request.post("/api/v1/volumes", {
    data: { id: "photos", kind: "mirror", members: ["disk-a", "disk-b"] },
    headers: authorize(token),
  });
  expect(volume.status()).toBe(201);
  return token;
};
