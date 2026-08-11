import { rm } from "node:fs/promises";

import { startServer } from "../../apps/server/src/server";

const dataDir = process.env.MYNAS_BROWSER_DATA_DIR ?? "/tmp/mynas-playwright";
const port = Number(process.env.MYNAS_BROWSER_PORT ?? "7331");
await rm(dataDir, { force: true, recursive: true });
const running = await startServer({
  dataDir,
  environment: process.env,
  host: "127.0.0.1",
  port,
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
