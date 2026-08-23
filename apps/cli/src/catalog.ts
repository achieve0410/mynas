import type { Command } from "commander";

import type { CliDependencies } from "./cli";

const writeJson = (dependencies: CliDependencies, value: unknown): void => {
  dependencies.stdout(JSON.stringify(value));
};

const passwordFromStdin = (value: string): string => {
  const password = value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;
  if (password.includes("\n") || password.includes("\r")) {
    throw new Error("replacement password must be provided as exactly one line");
  }
  return password;
};

export const registerCatalogCommands = (program: Command, dependencies: CliDependencies): void => {
  const catalog = program
    .command("catalog")
    .description("Back up or restore the local SQLite metadata catalog");

  catalog
    .command("backup")
    .description("Create a consistent catalog backup")
    .requiredOption("--data-dir <path>", "MyNAS data directory")
    .requiredOption("--output <file>", "new backup file")
    .action(async (options: { dataDir: string; output: string }) => {
      if (dependencies.backupCatalog === undefined) {
        throw new Error("catalog backup dependency is unavailable");
      }
      writeJson(dependencies, await dependencies.backupCatalog(options.dataDir, options.output));
    });

  catalog
    .command("restore")
    .description("Restore a catalog into an empty data directory")
    .requiredOption("--data-dir <path>", "empty MyNAS data directory")
    .requiredOption("--input <file>", "catalog backup file")
    .requiredOption("--password-stdin", "read replacement owner password from standard input")
    .option("--username <username>", "replacement owner username", "owner")
    .action(async (options: { dataDir: string; input: string; username: string }) => {
      if (dependencies.restoreCatalog === undefined) {
        throw new Error("catalog restore dependency is unavailable");
      }
      writeJson(
        dependencies,
        await dependencies.restoreCatalog({
          dataDir: options.dataDir,
          input: options.input,
          password: passwordFromStdin(await dependencies.readStdin()),
          username: options.username,
        }),
      );
    });
};
