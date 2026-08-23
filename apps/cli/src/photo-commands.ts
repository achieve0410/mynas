import { type Command, InvalidArgumentError } from "commander";
import { z } from "zod";

import type { CliDependencies } from "./cli";
import { request, writeJson } from "./commands";

const metadataBackfillReportSchema = z.object({
  claimed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

const batchSize = (value: string): number => {
  const parsed = z.coerce.number().int().min(1).max(10).safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError("batch size must be an integer between 1 and 10");
  }
  return parsed.data;
};

export const registerPhotoCommands = (program: Command, dependencies: CliDependencies): void => {
  const photo = program.command("photo").description("Manage protected photo metadata");

  photo
    .command("metadata-backfill")
    .description("Extract capture dates and locations from existing originals")
    .option("--batch-size <count>", "photos claimed per request", batchSize, 10)
    .option("--json", "print one JSON report per completed batch")
    .action(async (options: { batchSize: number; json?: boolean }) => {
      while (true) {
        const response = await request(dependencies, "/api/v1/photos/metadata/backfill", {
          body: JSON.stringify({ limit: options.batchSize }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const report = metadataBackfillReportSchema.parse(await response.json());
        if (options.json === true) {
          writeJson(dependencies, report);
        } else {
          dependencies.stdout(
            `claimed=${report.claimed} updated=${report.updated} failed=${report.failed} remaining=${report.remaining}`,
          );
        }
        if (report.failed !== 0) {
          throw new Error(`metadata backfill failed for ${report.failed} photo(s)`);
        }
        if (report.remaining === 0) {
          return;
        }
        if (report.claimed === 0) {
          throw new Error("active metadata leases prevent progress");
        }
      }
    });
};
