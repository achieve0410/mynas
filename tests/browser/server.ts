import { rm } from "node:fs/promises";

import { startServer } from "../../apps/server/src/server";

const dataDir = "/tmp/mynas-playwright";
await rm(dataDir, { force: true, recursive: true });
await startServer({
  dataDir,
  environment: {},
  host: "127.0.0.1",
  port: 7331,
});
