import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { command, repositoryRoot, requireSuccess } from "./docker-helpers";

const manifestPath = resolve(repositoryRoot, "k8s/mynas.yaml");
const artifactRoot = resolve(repositoryRoot, ".artifacts/qa/packaging");
const validatorImage = "ghcr.io/yannh/kubeconform:v0.7.0";
const validatorLabel = "com.mynas.qa=kubernetes";

const source = await readFile(manifestPath, "utf8");
const resources = z
  .array(
    z.object({
      kind: z.string(),
      metadata: z.object({ name: z.string() }),
    }),
  )
  .parse(Bun.YAML.parse(source))
  .map(({ kind, metadata }) => `${kind}/${metadata.name}`);

const strictSchemaEvidence = async (
  reason: "kubectl unavailable" | "local cluster unavailable",
): Promise<Readonly<Record<string, unknown>>> => {
  const validator = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "--interactive",
      "--label",
      validatorLabel,
      validatorImage,
      "-strict",
      "-summary",
      "-kubernetes-version",
      "1.31.0",
      "-",
    ],
    {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    },
  );
  validator.stdin.write(source);
  validator.stdin.end();
  const [exitCode, stderr, stdout] = await Promise.all([
    validator.exited,
    new Response(validator.stderr).text(),
    new Response(validator.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`kubeconform failed: ${stderr.trim()}${stdout.trim()}`);
  }
  const summary = stdout.trim();
  const counts = /Valid: (\d+), Invalid: (\d+), Errors: (\d+), Skipped: (\d+)/.exec(summary);
  if (counts?.[1] !== String(resources.length) || counts[2] !== "0" || counts[3] !== "0") {
    throw new Error(`unexpected kubeconform summary: ${summary}`);
  }
  return {
    kubernetesVersion: "1.31.0",
    mode: "strict-schema-fallback",
    reason,
    resources,
    summary,
    validatorImage,
  };
};

let evidence: Readonly<Record<string, unknown>>;
const kubectl = Bun.which("kubectl");
if (kubectl === null) {
  evidence = await strictSchemaEvidence("kubectl unavailable");
} else {
  const cluster = await command([kubectl, "cluster-info"], {});
  if (cluster.exitCode !== 0) {
    evidence = await strictSchemaEvidence("local cluster unavailable");
  } else {
    const dryRun = await command(
      [kubectl, "apply", "--dry-run=server", "--validate=strict", "-f", manifestPath],
      {},
    );
    evidence = {
      mode: "server-dry-run",
      resources,
      summary: requireSuccess(dryRun, "Kubernetes server-side dry run"),
    };
  }
}

const remaining = await command(
  ["docker", "ps", "--all", "--filter", `label=${validatorLabel}`, "--quiet"],
  {},
);
if (remaining.exitCode !== 0 || remaining.stdout.trim().length > 0) {
  throw new Error("Kubernetes validator container remains");
}
await mkdir(artifactRoot, { recursive: true });
await writeFile(
  resolve(artifactRoot, "kubernetes-validation.json"),
  `${JSON.stringify({ ...evidence, cleanup: "validator-container-absent" }, null, 2)}\n`,
);
console.log("KUBERNETES_VALIDATION_PASS=1");
