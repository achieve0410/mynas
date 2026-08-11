import type { Command } from "commander";

import type { CliDependencies } from "./cli";

export class CliHttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CliHttpError";
  }
}

const remotePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

const request = async (
  dependencies: CliDependencies,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const baseUrl = dependencies.environment.MYNAS_URL ?? "http://127.0.0.1:7331";
  const headers = new Headers(init.headers);
  const token = dependencies.environment.MYNAS_TOKEN;
  if (token !== undefined && token.length !== 0) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await dependencies.fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new CliHttpError(response.status, (await response.text()) || `HTTP ${response.status}`);
  }
  return response;
};

const jsonRequest = async (
  dependencies: CliDependencies,
  path: string,
  body: unknown,
): Promise<unknown> => {
  const response = await request(dependencies, path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.json();
};

const writeJson = (dependencies: CliDependencies, value: unknown): void => {
  dependencies.stdout(JSON.stringify(value));
};

export const readPassword = async (dependencies: CliDependencies): Promise<string> => {
  const input = await dependencies.readStdin();
  const password = input.endsWith("\r\n")
    ? input.slice(0, -2)
    : input.endsWith("\n")
      ? input.slice(0, -1)
      : input;
  if (password.length === 0 || password.includes("\r") || password.includes("\n")) {
    throw new Error("password stdin must contain exactly one non-empty line");
  }
  return password;
};

const addAuthCommands = (program: Command, dependencies: CliDependencies): void => {
  program
    .command("setup")
    .requiredOption("--username <username>")
    .requiredOption("--password-stdin", "read password from standard input")
    .action(async (options: { username: string }) => {
      writeJson(
        dependencies,
        await jsonRequest(dependencies, "/api/v1/setup", {
          password: await readPassword(dependencies),
          username: options.username,
        }),
      );
    });

  program
    .command("login")
    .requiredOption("--username <username>")
    .requiredOption("--password-stdin", "read password from standard input")
    .action(async (options: { username: string }) => {
      writeJson(
        dependencies,
        await jsonRequest(dependencies, "/api/v1/login", {
          password: await readPassword(dependencies),
          username: options.username,
        }),
      );
    });

  program
    .command("token-create")
    .requiredOption("--name <name>")
    .action(async (options: { name: string }) => {
      writeJson(dependencies, await jsonRequest(dependencies, "/api/v1/tokens", options));
    });

  program.command("token-list").action(async () => {
    writeJson(dependencies, await (await request(dependencies, "/api/v1/tokens")).json());
  });

  program.command("token-revoke <id>").action(async (id: string) => {
    await request(dependencies, `/api/v1/tokens/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    writeJson(dependencies, { id, revoked: true });
  });
};

const addBackendCommands = (program: Command, dependencies: CliDependencies): void => {
  const backend = program.command("backend");
  backend
    .command("add-local <id> <root>")
    .option("--json")
    .action(async (id: string, root: string) => {
      writeJson(
        dependencies,
        await jsonRequest(dependencies, "/api/v1/backends", { id, kind: "local", root }),
      );
    });

  backend
    .command("probe <id>")
    .option("--json")
    .action(async (id: string) => {
      writeJson(
        dependencies,
        await (
          await request(dependencies, `/api/v1/backends/${encodeURIComponent(id)}/probe`)
        ).json(),
      );
    });
};

const addVolumeCommands = (program: Command, dependencies: CliDependencies): void => {
  const volume = program.command("volume");
  volume
    .command("create <id> <first> <second>")
    .option("--json")
    .action(async (id: string, first: string, second: string) => {
      writeJson(
        dependencies,
        await jsonRequest(dependencies, "/api/v1/volumes", {
          id,
          kind: "mirror",
          members: [first, second],
        }),
      );
    });

  for (const operation of ["repair", "scrub"] as const) {
    volume
      .command(`${operation} <id>`)
      .option("--wait")
      .option("--json")
      .action(async (id: string) => {
        writeJson(
          dependencies,
          await (
            await request(dependencies, `/api/v1/volumes/${encodeURIComponent(id)}/${operation}`, {
              method: "POST",
            })
          ).json(),
        );
      });
  }

  volume
    .command("status <id>")
    .option("--json")
    .action(async (id: string) => {
      writeJson(
        dependencies,
        await (
          await request(dependencies, `/api/v1/volumes/${encodeURIComponent(id)}/status`)
        ).json(),
      );
    });
};

const addFileCommands = (program: Command, dependencies: CliDependencies): void => {
  program
    .command("put <volume> <remote> <source>")
    .option("--json")
    .action(async (volume: string, remote: string, source: string) => {
      const response = await request(
        dependencies,
        `/api/v1/files/${encodeURIComponent(volume)}/${remotePath(remote)}`,
        {
          body: exactArrayBuffer(await dependencies.readFile(source)),
          headers: { "content-type": "application/octet-stream" },
          method: "PUT",
        },
      );
      writeJson(dependencies, await response.json());
    });

  program
    .command("get <volume> <remote> <destination>")
    .option("--json")
    .action(async (volume: string, remote: string, destination: string) => {
      const response = await request(
        dependencies,
        `/api/v1/files/${encodeURIComponent(volume)}/${remotePath(remote)}`,
      );
      const contents = new Uint8Array(await response.arrayBuffer());
      await dependencies.writeFile(destination, contents);
      writeJson(dependencies, { path: destination, size: contents.byteLength });
    });
};

export const registerCommands = (program: Command, dependencies: CliDependencies): void => {
  addAuthCommands(program, dependencies);
  addBackendCommands(program, dependencies);
  addVolumeCommands(program, dependencies);
  addFileCommands(program, dependencies);
};
