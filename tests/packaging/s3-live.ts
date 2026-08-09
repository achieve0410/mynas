import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { migrate } from "../../packages/database/src/migrations";
import { StorageRegistry } from "../../packages/storage/src/registry";

import { command, repositoryRoot, requireSuccess } from "./docker-helpers";

const artifactRoot = resolve(repositoryRoot, ".artifacts/qa/s3");
const artifactPath = join(artifactRoot, "mixed-mirror.json");
const projectName = "mynas-s3-live-qa";
const accessKey = "mynas-qa-access";
const secretKey = "mynas-qa-secret-only";
const bucket = "mynas-test";
const composeEnvironment = {
  COMPOSE_PROJECT_NAME: projectName,
  MYNAS_QA_S3_ACCESS_KEY: accessKey,
  MYNAS_QA_S3_SECRET_KEY: secretKey,
  MYNAS_TEST_S3_BUCKET: bucket,
};
const compose = (arguments_: readonly string[]) =>
  command(["docker", "compose", "--profile", "qa", ...arguments_], composeEnvironment);

await mkdir(artifactRoot, { recursive: true });
const qaRoot = await mkdtemp(join(artifactRoot, "s3-runtime."));
const localRoot = join(qaRoot, "local");
await mkdir(localRoot);
const database = new Database(":memory:");
migrate(database);

let primaryError: unknown;
let sourceSha256 = "";
let downloadSha256 = "";
try {
  requireSuccess(
    await compose(["up", "--detach", "--wait", "--wait-timeout", "180", "minio"]),
    "MinIO startup",
  );
  requireSuccess(await compose(["run", "--rm", "minio-init"]), "MinIO bucket initialization");

  const registry = new StorageRegistry(database, {
    MYNAS_S3_QA_ACCESS_KEY: accessKey,
    MYNAS_S3_QA_SECRET_KEY: secretKey,
  });
  const localHealth = await registry.addBackend({
    id: "local",
    kind: "local",
    root: localRoot,
  });
  const s3Health = await registry.addBackend({
    accessKeyIdEnv: "MYNAS_S3_QA_ACCESS_KEY",
    bucket,
    endpoint: "http://127.0.0.1:9000",
    id: "minio",
    kind: "s3",
    prefix: "mixed",
    region: "us-east-1",
    secretAccessKeyEnv: "MYNAS_S3_QA_SECRET_KEY",
  });
  await registry.addMirror("mixed", ["local", "minio"]);
  const volume = await registry.getVolume("mixed");
  const sourcePath = join(qaRoot, "source.bin");
  const downloadPath = join(qaRoot, "download.bin");
  const source = new TextEncoder().encode("MyNAS local plus S3 QA v0.1\n");
  await writeFile(sourcePath, source);
  await volume.put("qa/roundtrip.bin", source);
  await writeFile(downloadPath, await volume.get("qa/roundtrip.bin"));
  requireSuccess(await command(["cmp", sourcePath, downloadPath], {}), "mixed mirror cmp");
  sourceSha256 = createHash("sha256")
    .update(await readFile(sourcePath))
    .digest("hex");
  downloadSha256 = createHash("sha256")
    .update(await readFile(downloadPath))
    .digest("hex");
  if (sourceSha256 !== downloadSha256) {
    throw new Error("mixed mirror SHA-256 mismatch");
  }
  if (localHealth.status !== "healthy" || s3Health.status !== "healthy") {
    throw new Error("mixed mirror backend probe failed");
  }
} catch (error) {
  primaryError = error;
} finally {
  database.close();
}

const cleanupErrors: Error[] = [];
const down = await compose(["down", "--volumes", "--remove-orphans"]);
if (down.exitCode !== 0) {
  cleanupErrors.push(new Error(`MinIO cleanup failed: ${down.stderr.trim()}`));
}
await rm(qaRoot, { force: true, recursive: true });
const containers = await command(
  [
    "docker",
    "ps",
    "--all",
    "--filter",
    `label=com.docker.compose.project=${projectName}`,
    "--quiet",
  ],
  {},
);
const volumes = await command(
  [
    "docker",
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${projectName}`,
    "--quiet",
  ],
  {},
);
if (containers.stdout.trim().length > 0 || volumes.stdout.trim().length > 0) {
  cleanupErrors.push(new Error("MinIO containers or volumes remain"));
}
let portClosed = false;
try {
  await fetch("http://127.0.0.1:9000/minio/health/live", {
    signal: AbortSignal.timeout(1_000),
  });
} catch {
  portClosed = true;
}
if (!portClosed) {
  cleanupErrors.push(new Error("MinIO port 9000 remains available"));
}
if (primaryError !== undefined) {
  throw primaryError;
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, "S3 live QA cleanup failed");
}

await writeFile(
  artifactPath,
  `${JSON.stringify(
    {
      backendStatus: ["healthy", "healthy"],
      cleanup: "containers-volumes-port-temp-absent",
      cmpExitCode: 0,
      downloadSha256,
      mirror: ["local", "minio"],
      sourceSha256,
    },
    null,
    2,
  )}\n`,
);
console.log("S3_LIVE_QA_PASS=1");
