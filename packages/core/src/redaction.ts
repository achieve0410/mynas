export type LogFields = Readonly<Record<string, unknown>>;

const REDACTED = "[Redacted]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "session",
  "token",
  "accesskey",
  "secretkey",
  "latitude",
  "longitude",
]);

const normalizedKey = (key: string): string => key.toLowerCase().replaceAll(/[^a-z]/g, "");

const isSensitiveKey = (key: string): boolean => SENSITIVE_KEYS.has(normalizedKey(key));

const isLogFields = (value: unknown): value is LogFields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (isLogFields(value)) {
    return redactLogFields(value);
  }
  return value;
};

export const redactLogFields = (fields: LogFields): LogFields => {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactValue(value);
  }
  return redacted;
};
