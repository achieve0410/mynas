import { Command, CommanderError } from "commander";

import { CliHttpError, registerCommands } from "./commands";

export type ServeOptions = {
  readonly dataDir: string;
  readonly host: string;
  readonly port: number;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CliDependencies = {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch: FetchLike;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly readStdin: () => Promise<string>;
  readonly serve?: (options: ServeOptions) => Promise<void>;
  readonly stderr: (line: string) => void;
  readonly stdout: (line: string) => void;
  readonly writeFile: (path: string, contents: Uint8Array) => Promise<void>;
};

const isLoopbackHost = (host: string): boolean =>
  ["127.0.0.1", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"].includes(host.toLowerCase());

export const runCli = async (
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> => {
  const program = new Command()
    .name("mynas")
    .description("MyNAS storage and photo management")
    .version("0.1.0")
    .exitOverride()
    .configureOutput({
      writeErr: (line) => dependencies.stderr(line),
      writeOut: (line) => dependencies.stdout(line),
    });

  program
    .command("serve")
    .requiredOption("--data-dir <path>")
    .option("--host <host>", "listen host", "127.0.0.1")
    .option("--port <port>", "listen port", "7331")
    .action(async (options: { dataDir: string; host: string; port: string }) => {
      if (dependencies.serve === undefined) {
        throw new Error("serve dependency is unavailable");
      }
      if (!isLoopbackHost(options.host) && dependencies.environment.MYNAS_ALLOW_REMOTE !== "true") {
        throw new Error("remote binding requires MYNAS_ALLOW_REMOTE=true");
      }
      await dependencies.serve({
        dataDir: options.dataDir,
        host: options.host,
        port: Number(options.port),
      });
    });

  registerCommands(program, dependencies);

  try {
    await program.parseAsync([...arguments_], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return 0;
    }
    dependencies.stderr(error instanceof Error ? error.message : "unknown CLI error");
    return error instanceof CliHttpError ? error.status : 1;
  }
};
