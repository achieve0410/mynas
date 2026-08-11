import type { Command } from "commander";

import type { CliDependencies } from "./cli";
import { readPassword } from "./commands";

export const registerBootstrapCommand = (program: Command, dependencies: CliDependencies): void => {
  program
    .command("bootstrap")
    .description("Initialize an owner and a two-target local mirror")
    .requiredOption("--data-dir <path>")
    .requiredOption("--primary-root <path>")
    .requiredOption("--secondary-root <path>")
    .requiredOption("--password-stdin", "read password from standard input")
    .option("--username <username>", "owner username", "owner")
    .option("--volume <id>", "mirror volume ID", "photos")
    .action(
      async (options: {
        dataDir: string;
        primaryRoot: string;
        secondaryRoot: string;
        username: string;
        volume: string;
      }) => {
        if (dependencies.bootstrapLocal === undefined) {
          throw new Error("bootstrap dependency is unavailable");
        }
        dependencies.stdout(
          JSON.stringify(
            await dependencies.bootstrapLocal({
              dataDir: options.dataDir,
              password: await readPassword(dependencies),
              primaryRoot: options.primaryRoot,
              secondaryRoot: options.secondaryRoot,
              username: options.username,
              volumeId: options.volume,
            }),
          ),
        );
      },
    );
};
