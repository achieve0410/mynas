import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { z } from "zod";

import { createServiceLogger } from "./logging";

test("startup logs omit workstation identity and redact credentials", () => {
  const destination = new PassThrough();
  let output = "";
  destination.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  const logger = createServiceLogger({}, destination);
  logger.info(
    {
      authorization: "Bearer synthetic-token",
      host: "127.0.0.1",
      password: "synthetic-password",
      port: 7331,
    },
    "MyNAS listening",
  );
  logger.flush();

  const record = z.record(z.string(), z.unknown()).parse(JSON.parse(output));
  expect(record.hostname).toBeUndefined();
  expect(record.authorization).toBe("[Redacted]");
  expect(record.password).toBe("[Redacted]");
  expect(record.host).toBe("127.0.0.1");
});
