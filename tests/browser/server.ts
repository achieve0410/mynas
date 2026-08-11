import { rm } from "node:fs/promises";

import { startServer } from "../../apps/server/src/server";

const dataDir = "/tmp/mynas-playwright";
await rm(dataDir, { force: true, recursive: true });
const running = await startServer({
  dataDir,
  environment: {},
  host: "127.0.0.1",
  port: 7331,
});
const stop = async (): Promise<void> => {
  await running.stop();
  process.exit(0);
};
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
