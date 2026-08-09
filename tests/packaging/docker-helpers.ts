import { resolve } from "node:path";
import type { z } from "zod";

export const repositoryRoot = resolve(import.meta.dir, "../..");

export type CommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export const command = async (
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<CommandResult> => {
  const process = Bun.spawn([...arguments_], {
    cwd: repositoryRoot,
    env: { ...globalThis.process.env, ...environment },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

export const requireSuccess = (result: CommandResult, label: string): string => {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
};

export const exactArrayBuffer = (contents: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(contents.byteLength);
  new Uint8Array(buffer).set(contents);
  return buffer;
};

export const requestJson = async <Output>(
  path: string,
  expectedStatus: number,
  schema: z.ZodType<Output>,
  init: RequestInit = {},
): Promise<Output> => {
  const response = await fetch(`http://127.0.0.1:7331${path}`, init);
  const body: unknown = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return schema.parse(body);
};
