import pino, { type DestinationStream, type Logger } from "pino";

export const createServiceLogger = (
  environment: Readonly<Record<string, string | undefined>>,
  destination?: DestinationStream,
): Logger => {
  const options: pino.LoggerOptions = {
    base: null,
    level: environment.MYNAS_LOG_LEVEL ?? "info",
    redact: {
      censor: "[Redacted]",
      paths: ["req.headers.authorization", "authorization", "cookie", "password", "token"],
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
};
