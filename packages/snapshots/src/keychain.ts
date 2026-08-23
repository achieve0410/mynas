import { z } from "zod";

export type SnapshotKeychainRunner = (input: Uint8Array) => Promise<Uint8Array>;

const accountSchema = z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/i);
const responseSchema = z.object({ value: z.string().optional() }).strict();
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const decodeValue = (value: string): Uint8Array => {
  const result = new Uint8Array(Buffer.from(value, "base64"));
  if (Buffer.from(result).toString("base64") !== value) {
    throw new Error("snapshot Keychain helper returned invalid base64");
  }
  return result;
};

export class SnapshotKeychain {
  public constructor(
    private readonly runner: SnapshotKeychainRunner,
    private readonly service: string,
  ) {
    if (service.length === 0) {
      throw new Error("snapshot Keychain service is required");
    }
  }

  public async delete(accountValue: string): Promise<void> {
    await this.call({ account: accountSchema.parse(accountValue), operation: "delete" });
  }

  public async get(accountValue: string): Promise<Uint8Array> {
    const response = await this.call({
      account: accountSchema.parse(accountValue),
      operation: "get",
    });
    if (response.value === undefined) {
      throw new Error("snapshot Keychain helper did not return a value");
    }
    return decodeValue(response.value);
  }

  public async put(accountValue: string, value: Uint8Array): Promise<void> {
    if (value.byteLength === 0) {
      throw new Error("snapshot Keychain value must not be empty");
    }
    await this.call({
      account: accountSchema.parse(accountValue),
      operation: "put",
      value: Buffer.from(value).toString("base64"),
    });
  }

  private async call(request: {
    readonly account: string;
    readonly operation: "delete" | "get" | "put";
    readonly value?: string;
  }): Promise<z.infer<typeof responseSchema>> {
    const response = await this.runner(
      encoder.encode(JSON.stringify({ ...request, service: this.service })),
    );
    try {
      return responseSchema.parse(JSON.parse(decoder.decode(response)));
    } catch {
      throw new Error("snapshot Keychain helper returned an invalid response");
    }
  }
}

export const processSnapshotKeychainRunner = (helperPath: string): SnapshotKeychainRunner => {
  if (helperPath.length === 0) {
    throw new Error("snapshot Keychain helper path is required");
  }
  return async (input) => {
    const process = Bun.spawn([helperPath], {
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    process.stdin.write(input);
    process.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).bytes(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "snapshot Keychain helper failed");
    }
    return stdout;
  };
};
