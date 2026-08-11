import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const LABEL = "com.mynas.service";

export type LaunchctlResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type LaunchdServiceOptions = {
  readonly homeDir: string;
  readonly programArguments: readonly string[];
  readonly runLaunchctl: (arguments_: readonly string[]) => Promise<LaunchctlResult>;
  readonly uid: number;
};

export type InstallServiceOptions = {
  readonly dataDir: string;
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly host: string;
  readonly port: number;
  readonly start: boolean;
};

export type InstallServiceReceipt = {
  readonly label: typeof LABEL;
  readonly plistPath: string;
  readonly started: boolean;
};

export type ServiceStatus = {
  readonly installed: boolean;
  readonly label: typeof LABEL;
  readonly loaded: boolean;
  readonly running: boolean;
};

export type UninstallServiceReceipt = {
  readonly label: typeof LABEL;
  readonly removed: boolean;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const xml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const renderPlist = (
  programArguments: readonly string[],
  options: InstallServiceOptions,
): string => {
  const arguments_ = [
    ...programArguments,
    "serve",
    "--data-dir",
    options.dataDir,
    "--host",
    options.host,
    "--port",
    String(options.port),
  ];
  const argumentXml = arguments_
    .map((argument) => `      <string>${xml(argument)}</string>`)
    .join("\n");
  const environmentEntries = Object.entries(options.environmentVariables ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const environmentXml =
    environmentEntries.length === 0
      ? ""
      : `    <key>EnvironmentVariables</key>
    <dict>
${environmentEntries
  .map(([name, value]) => `      <key>${xml(name)}</key>\n      <string>${xml(value)}</string>`)
  .join("\n")}
    </dict>
`;
  const logDirectory = join(options.dataDir, "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
${environmentXml}    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(join(logDirectory, "service.stdout.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(logDirectory, "service.stderr.log"))}</string>
  </dict>
</plist>
`;
};

export class LaunchdServiceManager {
  private readonly domain: string;
  private readonly plistPath: string;
  private readonly serviceTarget: string;

  public constructor(private readonly options: LaunchdServiceOptions) {
    this.domain = `gui/${options.uid}`;
    this.plistPath = join(options.homeDir, "Library", "LaunchAgents", `${LABEL}.plist`);
    this.serviceTarget = `${this.domain}/${LABEL}`;
  }

  public async install(options: InstallServiceOptions): Promise<InstallServiceReceipt> {
    if (!isAbsolute(options.dataDir)) {
      throw new Error("service data directory must be absolute");
    }
    const status = await this.status();
    if (status.loaded && !status.installed) {
      throw new Error("loaded MyNAS service has no recoverable plist");
    }
    if (!options.start && status.loaded) {
      throw new Error("cannot replace a loaded service with --no-start");
    }
    await Promise.all([
      mkdir(join(this.options.homeDir, "Library", "LaunchAgents"), {
        mode: 0o700,
        recursive: true,
      }),
      mkdir(join(options.dataDir, "logs"), { mode: 0o700, recursive: true }),
    ]);
    const temporaryPath = `${this.plistPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, renderPlist(this.options.programArguments, options), {
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    const previousPlist = status.installed ? await readFile(this.plistPath) : null;
    let published = false;
    let unloaded = false;
    try {
      if (status.loaded) {
        await this.requireLaunchctl(
          ["bootout", this.serviceTarget],
          "could not stop existing service",
        );
        unloaded = true;
      }
      await rename(temporaryPath, this.plistPath);
      published = true;
      if (options.start) {
        await this.requireLaunchctl(
          ["bootstrap", this.domain, this.plistPath],
          "could not start MyNAS service",
        );
      }
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (published) {
        if (previousPlist === null) {
          await rm(this.plistPath, { force: true });
        } else {
          await writeFile(this.plistPath, previousPlist, { mode: 0o600 });
          await chmod(this.plistPath, 0o600);
        }
      }
      if (unloaded && previousPlist !== null) {
        try {
          await this.requireLaunchctl(
            ["bootstrap", this.domain, this.plistPath],
            "could not restore previous MyNAS service",
          );
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "service update and rollback failed");
        }
      }
      throw error;
    }
    return { label: LABEL, plistPath: this.plistPath, started: options.start };
  }

  public async status(): Promise<ServiceStatus> {
    const result = await this.options.runLaunchctl(["print", this.serviceTarget]);
    if (result.exitCode !== 0 && !this.isMissing(result)) {
      throw new Error(result.stderr || "could not inspect MyNAS service");
    }
    return {
      installed: await exists(this.plistPath),
      label: LABEL,
      loaded: result.exitCode === 0,
      running: result.exitCode === 0 && /\bstate\s*=\s*running\b/.test(result.stdout),
    };
  }

  public async uninstall(): Promise<UninstallServiceReceipt> {
    const status = await this.status();
    if (status.loaded) {
      await this.requireLaunchctl(["bootout", this.serviceTarget], "could not stop MyNAS service");
    }
    if (status.installed) {
      await rm(this.plistPath);
    }
    return { label: LABEL, removed: status.installed || status.loaded };
  }

  private isMissing(result: LaunchctlResult): boolean {
    return (
      result.exitCode === 113 ||
      result.stderr.includes("Could not find service") ||
      result.stderr.includes("No such process")
    );
  }

  private async requireLaunchctl(arguments_: readonly string[], message: string): Promise<void> {
    const result = await this.options.runLaunchctl(arguments_);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || message);
    }
  }
}
