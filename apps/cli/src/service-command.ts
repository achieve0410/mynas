import { isAbsolute } from "node:path";
import type { Command } from "commander";

import type { CliDependencies } from "./cli";

const isLoopbackHost = (host: string): boolean =>
  ["127.0.0.1", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"].includes(host.toLowerCase());

const output = (dependencies: CliDependencies, value: unknown): void => {
  dependencies.stdout(JSON.stringify(value));
};

const collect = (value: string, previous: readonly string[]): string[] => [...previous, value];

export const registerServiceCommands = (program: Command, dependencies: CliDependencies): void => {
  const service = program.command("service").description("Manage the macOS launchd service");

  service
    .command("install")
    .requiredOption("--data-dir <path>")
    .option("--host <host>", "listen host", "127.0.0.1")
    .option("--port <port>", "listen port", "7331")
    .option("--env <name>", "persist one named environment variable", collect, [])
    .option("--no-start", "write the launch agent without loading it")
    .action(
      async (options: {
        dataDir: string;
        env: readonly string[];
        host: string;
        port: string;
        start: boolean;
      }) => {
        if (dependencies.installService === undefined) {
          throw new Error("service install dependency is unavailable");
        }
        if (
          !isLoopbackHost(options.host) &&
          dependencies.environment.MYNAS_ALLOW_REMOTE !== "true"
        ) {
          throw new Error("remote binding requires MYNAS_ALLOW_REMOTE=true");
        }
        if (!isAbsolute(options.dataDir)) {
          throw new Error("service data directory must be absolute");
        }
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error("port must be an integer between 1 and 65535");
        }
        const names = new Set(options.env);
        if (!isLoopbackHost(options.host)) {
          names.add("MYNAS_ALLOW_REMOTE");
        }
        const environmentVariables: Record<string, string> = {};
        for (const name of [...names].sort()) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            throw new Error(`invalid environment variable name ${name}`);
          }
          const value = dependencies.environment[name];
          if (value === undefined) {
            throw new Error(`environment variable ${name} is not set`);
          }
          environmentVariables[name] = value;
        }
        output(
          dependencies,
          await dependencies.installService({
            dataDir: options.dataDir,
            environmentVariables,
            host: options.host,
            port,
            start: options.start,
          }),
        );
      },
    );

  service.command("status").action(async () => {
    if (dependencies.serviceStatus === undefined) {
      throw new Error("service status dependency is unavailable");
    }
    output(dependencies, await dependencies.serviceStatus());
  });

  service.command("uninstall").action(async () => {
    if (dependencies.uninstallService === undefined) {
      throw new Error("service uninstall dependency is unavailable");
    }
    output(dependencies, await dependencies.uninstallService());
  });
};
