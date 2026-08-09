import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import {
  command,
  exactArrayBuffer,
  repositoryRoot,
  requestJson,
  requireSuccess,
} from "./docker-helpers";

const artifactPath = resolve(repositoryRoot, ".artifacts/qa/packaging/docker-live.json");
const ownerPassword = "synthetic docker owner passphrase";
const projectName = `mynas-live-qa-${process.pid}`;

const sessionSchema = z.object({ token: z.string().min(32) });
const healthSchema = z.object({ status: z.literal("ok") });
const backendHealthSchema = z.object({ status: z.literal("healthy") });
const volumeHealthSchema = z.object({
  status: z.literal("healthy"),
  unavailable: z.array(z.string()).length(0),
});

const artifactRoot = resolve(repositoryRoot, ".artifacts/qa/packaging");
await mkdir(artifactRoot, { recursive: true });
const qaRoot = await mkdtemp(join(artifactRoot, "docker-runtime."));
const storageRoot = join(qaRoot, "storage");
const backendRoots = [join(storageRoot, "disk-a"), join(storageRoot, "disk-b")];
await Promise.all(backendRoots.map((root) => mkdir(root, { recursive: true })));
await Promise.all(backendRoots.map((root) => chmod(root, 0o777)));
const composeEnvironment = {
  COMPOSE_PROJECT_NAME: projectName,
  MYNAS_PORT: "0",
  MYNAS_STORAGE_PATH: storageRoot,
};
const compose = (arguments_: readonly string[]) =>
  command(["docker", "compose", ...arguments_], composeEnvironment);

let primaryError: unknown;
let evidence: Readonly<Record<string, unknown>> | null = null;
let hostPort: number | null = null;
try {
  requireSuccess(
    await compose(["up", "--build", "--detach", "--wait", "--wait-timeout", "180", "mynas"]),
    "docker compose up",
  );
  const published = requireSuccess(await compose(["port", "mynas", "7331"]), "published port");
  hostPort = Number(published.slice(published.lastIndexOf(":") + 1));
  if (!Number.isInteger(hostPort) || hostPort <= 0) {
    throw new Error(`invalid published port: ${published}`);
  }
  const baseUrl = `http://127.0.0.1:${hostPort}`;
  const health = await requestJson("/api/v1/health", 200, healthSchema, {}, baseUrl);

  const setupScript = `
    const response = await fetch("http://127.0.0.1:7331/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "owner", password: ${JSON.stringify(ownerPassword)} })
    });
    if (response.status !== 201) throw new Error(await response.text());
  `;
  requireSuccess(
    await compose(["exec", "--no-TTY", "mynas", "bun", "-e", setupScript]),
    "loopback owner setup",
  );

  const session = await requestJson(
    "/api/v1/login",
    200,
    sessionSchema,
    {
      body: JSON.stringify({ password: ownerPassword, username: "owner" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    baseUrl,
  );
  const headers = {
    authorization: `Bearer ${session.token}`,
    "content-type": "application/json",
  };
  for (const id of ["disk-a", "disk-b"] as const) {
    await requestJson(
      "/api/v1/backends",
      201,
      z.object({ id: z.literal(id), status: z.literal("healthy") }),
      {
        body: JSON.stringify({ id, kind: "local", root: `/storage/${id}` }),
        headers,
        method: "POST",
      },
      baseUrl,
    );
  }
  await requestJson(
    "/api/v1/volumes",
    201,
    z.object({ id: z.literal("docker-qa") }),
    {
      body: JSON.stringify({
        id: "docker-qa",
        kind: "mirror",
        members: ["disk-a", "disk-b"],
      }),
      headers,
      method: "POST",
    },
    baseUrl,
  );
  const [diskA, diskB, volume] = await Promise.all([
    requestJson("/api/v1/backends/disk-a/probe", 200, backendHealthSchema, { headers }, baseUrl),
    requestJson("/api/v1/backends/disk-b/probe", 200, backendHealthSchema, { headers }, baseUrl),
    requestJson("/api/v1/volumes/docker-qa/status", 200, volumeHealthSchema, { headers }, baseUrl),
  ]);

  const source = new TextEncoder().encode("MyNAS Docker QA v0.1\n");
  const sourcePath = join(qaRoot, "source.bin");
  const downloadPath = join(qaRoot, "download.bin");
  await writeFile(sourcePath, source);
  const uploaded = await fetch(`${baseUrl}/api/v1/files/docker-qa/qa/roundtrip.bin`, {
    body: exactArrayBuffer(source),
    headers: { authorization: `Bearer ${session.token}` },
    method: "PUT",
  });
  if (uploaded.status !== 201) {
    throw new Error(`Docker file upload returned ${uploaded.status}: ${await uploaded.text()}`);
  }
  const downloaded = await fetch(`${baseUrl}/api/v1/files/docker-qa/qa/roundtrip.bin`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (downloaded.status !== 200) {
    throw new Error(`Docker file download returned ${downloaded.status}`);
  }
  await writeFile(downloadPath, new Uint8Array(await downloaded.arrayBuffer()));
  requireSuccess(await command(["cmp", sourcePath, downloadPath], {}), "literal file comparison");
  const sourceSha256 = createHash("sha256")
    .update(await readFile(sourcePath))
    .digest("hex");
  const downloadSha256 = createHash("sha256")
    .update(await readFile(downloadPath))
    .digest("hex");
  if (sourceSha256 !== downloadSha256) {
    throw new Error("Docker roundtrip SHA-256 mismatch");
  }
  evidence = {
    backendStatus: [diskA.status, diskB.status],
    cmpExitCode: 0,
    downloadSha256,
    health,
    image: "mynas:0.1.0",
    sourceSha256,
    volumeStatus: volume.status,
  };
} catch (error) {
  primaryError = error;
}

const cleanupErrors: Error[] = [];
if (primaryError !== undefined) {
  const diagnostics = await compose([
    "exec",
    "--no-TTY",
    "mynas",
    "bun",
    "-e",
    `
      import { readdir, stat } from "node:fs/promises";
      import { LocalDirectoryBackend } from "./packages/storage/src/local";
      const backend = new LocalDirectoryBackend("diagnostic", "/storage/disk-a");
      await backend.initialize();
      console.log(JSON.stringify({
        entries: await readdir("/storage"),
        mode: (await stat("/storage/disk-a")).mode,
        probe: await backend.probe()
      }));
    `,
  ]);
  console.error(`Docker QA diagnostics: ${diagnostics.stdout}${diagnostics.stderr}`);
}
const down = await compose(["down", "--volumes", "--remove-orphans"]);
if (down.exitCode !== 0) {
  cleanupErrors.push(new Error(`docker compose down failed: ${down.stderr.trim()}`));
}
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
if (containers.exitCode !== 0 || containers.stdout.trim().length > 0) {
  cleanupErrors.push(new Error("Docker QA containers remain"));
}
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
if (volumes.exitCode !== 0 || volumes.stdout.trim().length > 0) {
  cleanupErrors.push(new Error("Docker QA volumes remain"));
}
const port =
  hostPort === null
    ? null
    : await command(["lsof", "-nP", `-iTCP:${hostPort}`, "-sTCP:LISTEN"], {});
if (port !== null && (port.exitCode === 0 || port.stdout.trim().length > 0)) {
  cleanupErrors.push(new Error(`Docker QA port ${hostPort} remains`));
}
await rm(qaRoot, { force: true, recursive: true });

if (primaryError !== undefined || cleanupErrors.length > 0 || evidence === null) {
  throw new AggregateError(
    [...(primaryError === undefined ? [] : [primaryError]), ...cleanupErrors],
    "Docker live QA failed",
  );
}
await mkdir(resolve(repositoryRoot, ".artifacts/qa/packaging"), { recursive: true });
await writeFile(
  artifactPath,
  `${JSON.stringify({ ...evidence, cleanup: "containers-volumes-port-temp-absent" }, null, 2)}\n`,
);
console.log("DOCKER_LIVE_QA_PASS=1");
