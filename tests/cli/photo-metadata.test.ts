import { describe, expect, test } from "bun:test";

import type { CliDependencies, FetchLike } from "../../apps/cli/src/cli";
import { runCli } from "../../apps/cli/src/cli";

const dependenciesFor = (
  fetch: FetchLike,
  output: string[],
  errors: string[],
): CliDependencies => ({
  environment: {
    MYNAS_TOKEN: "synthetic-token",
    MYNAS_URL: "http://127.0.0.1:7331",
  },
  fetch,
  readFile: async () => new Uint8Array(),
  readStdin: async () => "",
  stderr: (line) => errors.push(line),
  stdout: (line) => output.push(line),
  writeFile: async () => {},
});

const report = (remaining: number, claimed = remaining === 0 ? 1 : 2) => ({
  claimed,
  completed: claimed,
  failed: 0,
  remaining,
  updated: claimed,
});

describe("photo metadata backfill CLI", () => {
  test("runs authenticated batches serially until remaining reaches zero", async () => {
    const errors: string[] = [];
    const output: string[] = [];
    const requests: Request[] = [];
    const reports = [report(1), report(0)];
    let nextResponse = 0;
    let active = 0;
    let maximumActive = 0;
    const fetch: FetchLike = async (input, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const request = new Request(input, init);
      requests.push(request);
      const response = reports[nextResponse];
      nextResponse += 1;
      active -= 1;
      return Response.json(response);
    };

    const exitCode = await runCli(
      ["photo", "metadata-backfill", "--batch-size", "2", "--json"],
      dependenciesFor(fetch, output, errors),
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(maximumActive).toBe(1);
    expect(requests).toHaveLength(2);
    expect(
      requests.map((request) => ({
        authorization: request.headers.get("authorization"),
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual([
      {
        authorization: "Bearer synthetic-token",
        method: "POST",
        path: "/api/v1/photos/metadata/backfill",
      },
      {
        authorization: "Bearer synthetic-token",
        method: "POST",
        path: "/api/v1/photos/metadata/backfill",
      },
    ]);
    expect(await Promise.all(requests.map((request) => request.json()))).toEqual([
      { limit: 2 },
      { limit: 2 },
    ]);
    expect(output).toEqual(reports.map((value) => JSON.stringify(value)));
  });

  test("stops without polling when another caller owns active leases", async () => {
    const errors: string[] = [];
    const output: string[] = [];
    let requests = 0;
    const exitCode = await runCli(
      ["photo", "metadata-backfill", "--batch-size", "2", "--json"],
      dependenciesFor(
        async () => {
          requests += 1;
          return Response.json({
            claimed: 0,
            completed: 0,
            failed: 0,
            remaining: 1,
            updated: 0,
          });
        },
        output,
        errors,
      ),
    );

    expect(exitCode).toBe(1);
    expect(requests).toBe(1);
    expect(errors.join("\n")).toContain("active metadata leases");
  });

  test("rejects invalid batch sizes before making a request", async () => {
    for (const batchSize of ["0", "11", "not-a-number"]) {
      let requests = 0;
      const exitCode = await runCli(
        ["photo", "metadata-backfill", "--batch-size", batchSize, "--json"],
        dependenciesFor(
          async () => {
            requests += 1;
            return Response.json(report(0));
          },
          [],
          [],
        ),
      );
      expect(exitCode).toBe(1);
      expect(requests).toBe(0);
    }
  });

  test("stops after a batch reports retryable photo failures", async () => {
    const errors: string[] = [];
    let requests = 0;
    const exitCode = await runCli(
      ["photo", "metadata-backfill", "--batch-size", "2", "--json"],
      dependenciesFor(
        async () => {
          requests += 1;
          return Response.json({
            claimed: 1,
            completed: 0,
            failed: 1,
            remaining: 1,
            updated: 0,
          });
        },
        [],
        errors,
      ),
    );

    expect(exitCode).toBe(1);
    expect(requests).toBe(1);
    expect(errors.join("\n")).toContain("failed for 1 photo");
  });

  test("stops after the first HTTP error", async () => {
    const errors: string[] = [];
    let requests = 0;
    const exitCode = await runCli(
      ["photo", "metadata-backfill", "--batch-size", "2", "--json"],
      dependenciesFor(
        async () => {
          requests += 1;
          return new Response("storage unavailable", { status: 503 });
        },
        [],
        errors,
      ),
    );

    expect(exitCode).toBe(503);
    expect(requests).toBe(1);
    expect(errors.join("\n")).toContain("storage unavailable");
  });
});
