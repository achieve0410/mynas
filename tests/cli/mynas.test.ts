import { describe, expect, test } from "bun:test";

import type { CliDependencies, FetchLike } from "../../apps/cli/src/cli";
import { runCli } from "../../apps/cli/src/cli";

const createDependencies = (
  fetchImplementation: FetchLike,
  output: string[],
  writes: Map<string, Uint8Array>,
): CliDependencies => ({
  environment: {
    MYNAS_TOKEN: "synthetic-token",
    MYNAS_URL: "http://127.0.0.1:7331",
  },
  fetch: fetchImplementation,
  readFile: async () => new TextEncoder().encode("source-bytes"),
  stderr: (line) => output.push(`stderr:${line}`),
  stdout: (line) => output.push(line),
  writeFile: async (path, contents) => {
    writes.set(path, contents);
  },
});

describe("mynas CLI", () => {
  test("adds a local backend with bearer auth and stable JSON output", async () => {
    const output: string[] = [];
    const writes = new Map<string, Uint8Array>();
    const requests: Request[] = [];
    const mockedFetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ id: "disk-a", kind: "local", status: "healthy" }, { status: 201 });
    };

    const exitCode = await runCli(
      ["backend", "add-local", "disk-a", "/Volumes/External", "--json"],
      createDependencies(mockedFetch, output, writes),
    );

    expect(exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer synthetic-token");
    expect(await requests[0]?.json()).toEqual({
      id: "disk-a",
      kind: "local",
      root: "/Volumes/External",
    });
    expect(output).toEqual(['{"id":"disk-a","kind":"local","status":"healthy"}']);
  });

  test("puts and gets exact bytes through injected file IO", async () => {
    const output: string[] = [];
    const writes = new Map<string, Uint8Array>();
    const requests: Request[] = [];
    const mockedFetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.method === "PUT"
        ? Response.json({ path: "docs/file.bin" }, { status: 201 })
        : new Response("downloaded-bytes");
    };
    const dependencies = createDependencies(mockedFetch, output, writes);

    expect(
      await runCli(["put", "photos", "docs/file.bin", "source.bin", "--json"], dependencies),
    ).toBe(0);
    expect(
      await runCli(["get", "photos", "docs/file.bin", "download.bin", "--json"], dependencies),
    ).toBe(0);

    expect(new TextDecoder().decode(await requests[0]?.arrayBuffer())).toBe("source-bytes");
    expect(new TextDecoder().decode(writes.get("download.bin"))).toBe("downloaded-bytes");
    expect(output).toEqual(['{"path":"docs/file.bin"}', '{"path":"download.bin","size":16}']);
  });
});
