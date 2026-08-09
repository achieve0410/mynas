import { z } from "zod";

export type AppConfig = {
  readonly dataDir: string;
  readonly host: string;
  readonly port: number;
  readonly allowRemote: boolean;
};

export class ConfigError extends Error {
  public readonly code = "invalid_config";

  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const environmentSchema = z.object({
  MYNAS_ALLOW_REMOTE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MYNAS_DATA_DIR: z.string().min(1, "MYNAS_DATA_DIR is required"),
  MYNAS_HOST: z.string().min(1).default("127.0.0.1"),
  MYNAS_PORT: z.coerce.number().int().min(1).max(65_535).default(7331),
});

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

export const parseConfig = (input: Readonly<Record<string, string | undefined>>): AppConfig => {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(z.prettifyError(parsed.error));
  }

  if (!parsed.data.MYNAS_ALLOW_REMOTE && !isLoopbackHost(parsed.data.MYNAS_HOST)) {
    throw new ConfigError("A non-loopback MYNAS_HOST requires MYNAS_ALLOW_REMOTE=true");
  }

  return {
    allowRemote: parsed.data.MYNAS_ALLOW_REMOTE,
    dataDir: parsed.data.MYNAS_DATA_DIR,
    host: parsed.data.MYNAS_HOST,
    port: parsed.data.MYNAS_PORT,
  };
};
