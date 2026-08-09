import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const repositoryRoot = resolve(import.meta.dir, "../..");

const requiredArtifacts = ["Dockerfile", ".dockerignore", "k8s/mynas.yaml"] as const;

const run = async (arguments_: readonly string[]) => {
  const process = Bun.spawn([...arguments_], {
    cwd: repositoryRoot,
    env: {
      ...globalThis.process.env,
      MYNAS_QA_S3_ACCESS_KEY: "synthetic-access-key",
      MYNAS_QA_S3_SECRET_KEY: "synthetic-secret-key",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${arguments_.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout;
};

describe("distribution packaging", () => {
  for (const artifact of requiredArtifacts) {
    test(`includes ${artifact}`, async () => {
      await access(resolve(repositoryRoot, artifact));
    });
  }

  test("Compose renders MyNAS and QA MinIO services", async () => {
    const stdout = await run([
      "docker",
      "compose",
      "--profile",
      "qa",
      "config",
      "--format",
      "json",
    ]);
    const config = z
      .object({ services: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(stdout));
    expect(Object.keys(config.services)).toContain("minio");
    expect(Object.keys(config.services)).toContain("minio-init");
    expect(Object.keys(config.services)).toContain("mynas");

    const app = z
      .object({
        cap_drop: z.array(z.string()),
        healthcheck: z.object({ test: z.array(z.string()) }),
        ports: z.array(z.object({ host_ip: z.string(), target: z.number() })),
        read_only: z.boolean(),
        volumes: z.array(z.object({ target: z.string() })),
      })
      .parse(config.services.mynas);
    expect(app.cap_drop).toContain("ALL");
    expect(app.healthcheck.test.join(" ")).toContain("/api/v1/health");
    expect(app.ports).toContainEqual(
      expect.objectContaining({ host_ip: "127.0.0.1", target: 7331 }),
    );
    expect(app.read_only).toBe(true);
    expect(app.volumes.map(({ target }) => target)).toContainAllValues(["/data", "/storage"]);
  });

  test("source workspace is not advertised as an npm package", async () => {
    const metadata = z
      .object({
        bin: z.unknown().optional(),
        private: z.literal(true),
        scripts: z.object({
          prepublishOnly: z.string().includes("not distributed through npm"),
        }),
      })
      .parse(JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")));
    expect(metadata.bin).toBeUndefined();
  });

  test("Dockerfile defines a non-root health-checked service", async () => {
    const dockerfile = await readFile(resolve(repositoryRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain("MYNAS_ALLOW_REMOTE=true");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "apps/cli/src/main.ts", "serve"]');
    expect(dockerfile).toContain('"--host", "0.0.0.0"');
  });

  test("Docker live QA rebuilds the source image", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "tests/packaging/docker-live.ts"),
      "utf8",
    );
    expect(source).toContain('"--build"');
    expect(source).toContain("process.pid");
    expect(source).toContain('MYNAS_PORT: "0"');
  });

  test("S3 live QA records mixed-mirror cleanup", async () => {
    const source = await readFile(resolve(repositoryRoot, "tests/packaging/s3-live.ts"), "utf8");
    expect(source).toContain("S3_LIVE_QA_PASS=1");
    expect(source).toContain("containers-volumes-port-temp-absent");
  });

  test("Kubernetes renders one persistent non-root replica", async () => {
    const source = await readFile(resolve(repositoryRoot, "k8s/mynas.yaml"), "utf8");
    const manifests = z
      .array(
        z
          .object({
            apiVersion: z.string(),
            kind: z.string(),
            metadata: z.object({ name: z.string() }),
          })
          .passthrough(),
      )
      .parse(Bun.YAML.parse(source));
    const kinds = manifests.map(({ kind }) => kind);
    expect(kinds).toContain("Deployment");
    expect(kinds).toContain("NetworkPolicy");
    expect(kinds).toContain("PersistentVolumeClaim");
    expect(kinds).toContain("Service");

    const deployment = z
      .object({
        kind: z.literal("Deployment"),
        spec: z.object({
          replicas: z.literal(1),
          strategy: z.object({ type: z.literal("Recreate") }),
          template: z.object({
            spec: z.object({
              automountServiceAccountToken: z.literal(false),
              containers: z.array(
                z.object({
                  args: z.array(z.string()),
                  readinessProbe: z.object({
                    httpGet: z.object({ path: z.literal("/api/v1/health") }),
                  }),
                  securityContext: z.object({
                    readOnlyRootFilesystem: z.literal(true),
                    runAsNonRoot: z.literal(true),
                  }),
                  volumeMounts: z.array(z.object({ mountPath: z.string() })),
                }),
              ),
            }),
          }),
        }),
      })
      .parse(manifests.find(({ kind }) => kind === "Deployment"));
    expect(deployment.spec.template.spec.containers).toHaveLength(1);
    expect(deployment.spec.template.spec.containers[0]?.args).toContain("/data/state");
    expect(
      deployment.spec.template.spec.containers[0]?.volumeMounts.map(({ mountPath }) => mountPath),
    ).toContain("/data");
  });
});
