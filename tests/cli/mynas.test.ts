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
  readStdin: async () => "synthetic owner passphrase\n",
  stderr: (line) => output.push(`stderr:${line}`),
  stdout: (line) => output.push(line),
  writeFile: async (path, contents) => {
    writes.set(path, contents);
  },
});

describe("mynas CLI", () => {
  test("lists catalog backup and restore commands", async () => {
    const output: string[] = [];

    const exitCode = await runCli(
      ["catalog", "--help"],
      createDependencies(async () => Response.json({}), output, new Map()),
    );

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("backup");
    expect(output.join("\n")).toContain("restore");
  });

  test("reads authentication passwords from stdin instead of arguments", async () => {
    const output: string[] = [];
    const requests: Request[] = [];
    const mockedFetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ id: crypto.randomUUID(), username: "owner" }, { status: 201 });
    };

    const exitCode = await runCli(
      ["setup", "--username", "owner", "--password-stdin"],
      createDependencies(mockedFetch, output, new Map()),
    );

    expect(exitCode).toBe(0);
    expect(await requests[0]?.json()).toEqual({
      password: "synthetic owner passphrase",
      username: "owner",
    });

    const loginDependencies = {
      ...createDependencies(mockedFetch, output, new Map()),
      readStdin: async () => "synthetic owner passphrase\r\n",
    };
    expect(
      await runCli(["login", "--username", "owner", "--password-stdin"], loginDependencies),
    ).toBe(0);
    expect(await requests[1]?.json()).toEqual({
      password: "synthetic owner passphrase",
      username: "owner",
    });
  });

  test("rejects empty and multiline password input", async () => {
    for (const input of ["", "first\nsecond\n"]) {
      const requests: Request[] = [];
      const dependencies = {
        ...createDependencies(
          async (url, init) => {
            requests.push(new Request(url, init));
            return Response.json({});
          },
          [],
          new Map(),
        ),
        readStdin: async () => input,
      };
      expect(await runCli(["login", "--username", "owner", "--password-stdin"], dependencies)).toBe(
        1,
      );
      expect(requests).toHaveLength(0);
    }
  });

  test("requires explicit opt-in before binding beyond loopback", async () => {
    const servedHosts: string[] = [];
    const base = createDependencies(async () => Response.json({}), [], new Map());
    const withoutOptIn: CliDependencies = {
      ...base,
      serve: async ({ host }) => {
        servedHosts.push(host);
      },
    };

    expect(
      await runCli(["serve", "--data-dir", "/tmp/mynas", "--host", "0.0.0.0"], withoutOptIn),
    ).toBe(1);
    expect(servedHosts).toEqual([]);

    const withOptIn: CliDependencies = {
      ...withoutOptIn,
      environment: { ...withoutOptIn.environment, MYNAS_ALLOW_REMOTE: "true" },
    };
    expect(
      await runCli(["serve", "--data-dir", "/tmp/mynas", "--host", "0.0.0.0"], withOptIn),
    ).toBe(0);
    expect(servedHosts).toEqual(["0.0.0.0"]);
  });

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

  test("lists and revokes API tokens", async () => {
    const output: string[] = [];
    const requests: Request[] = [];
    const tokenId = crypto.randomUUID();
    const mockedFetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json([{ createdAt: "2026-01-01T00:00:00.000Z", id: tokenId, name: "qa" }]);
    };
    const dependencies = createDependencies(mockedFetch, output, new Map());

    expect(await runCli(["token-list"], dependencies)).toBe(0);
    expect(await runCli(["token-revoke", tokenId], dependencies)).toBe(0);

    expect(requests.map((request) => request.method)).toEqual(["GET", "DELETE"]);
    expect(output).toEqual([
      `[{"createdAt":"2026-01-01T00:00:00.000Z","id":"${tokenId}","name":"qa"}]`,
      `{"id":"${tokenId}","revoked":true}`,
    ]);
  });
});
