import { join } from "node:path";

export type SlackLifecycleCommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type SlackLifecycleCommandRunner = (
  arguments_: readonly string[],
) => Promise<SlackLifecycleCommandResult>;

export type SlackPortWaiter = (port: number, state: "closed" | "open") => Promise<void>;

type ServiceName = "classify" | "gunicorn" | "nginx" | "sync" | "tagging";

type SlackDashboardLifecycleOptions = {
  readonly home: string;
  readonly isLoaded: (label: string) => Promise<boolean>;
  readonly runLaunchctl: SlackLifecycleCommandRunner;
  readonly runTailscale: SlackLifecycleCommandRunner;
  readonly uid: number;
  readonly verifyPlist: (path: string) => Promise<void>;
  readonly waitForPort: SlackPortWaiter;
};

const serviceNames = ["gunicorn", "nginx", "sync", "tagging", "classify"] as const;
const label = (name: ServiceName): string => `io.mynas.slack-dashboard.${name}`;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown Slack lifecycle error";

export class SlackDashboardLifecycle {
  private readonly domain: string;

  public constructor(private readonly options: SlackDashboardLifecycleOptions) {
    if (!Number.isSafeInteger(options.uid) || options.uid < 0) {
      throw new Error("Slack launchd lifecycle uid is invalid");
    }
    this.domain = `gui/${options.uid}`;
  }

  public async start(): Promise<void> {
    await this.preflight();
    const errors: unknown[] = [];
    let webReady = true;
    try {
      await this.startService("gunicorn");
      await this.options.waitForPort(9121, "open");
    } catch (error) {
      errors.push(error);
      webReady = false;
    }
    try {
      await this.startService("nginx");
      await this.options.waitForPort(9120, "open");
      await this.options.waitForPort(9130, "open");
    } catch (error) {
      errors.push(error);
      webReady = false;
    }
    for (const name of ["sync", "tagging", "classify"] as const) {
      try {
        await this.startService(name, name !== "sync");
      } catch (error) {
        errors.push(error);
      }
    }
    if (webReady) {
      try {
        await this.required(
          this.options.runTailscale([
            "serve",
            "--yes",
            "--bg",
            "--https=9443",
            "https+insecure://127.0.0.1:9120",
          ]),
          "Tailscale Serve restore",
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, errors.map(message).join("; "));
    }
  }

  public async stop(): Promise<void> {
    await this.preflight();
    try {
      await this.stopTailscale();
      await this.stopService("tagging");
      await this.stopService("classify");
      await this.stopService("sync");
      await this.stopService("nginx");
      await this.options.waitForPort(9120, "closed");
      await this.stopService("gunicorn");
      await this.options.waitForPort(9121, "closed");
    } catch (stopError) {
      try {
        await this.start();
      } catch (rollbackError) {
        throw new AggregateError(
          [stopError, rollbackError],
          `${message(stopError)}; rollback failed: ${message(rollbackError)}`,
        );
      }
      throw stopError;
    }
  }

  private async preflight(): Promise<void> {
    for (const name of serviceNames) {
      await this.options.verifyPlist(this.plistPath(name));
    }
  }

  private plistPath(name: ServiceName): string {
    return join(this.options.home, "Library", "LaunchAgents", `${label(name)}.plist`);
  }

  private async startService(name: ServiceName, scheduled = false): Promise<void> {
    const serviceLabel = label(name);
    if (await this.options.isLoaded(serviceLabel)) {
      if (scheduled) {
        return;
      }
      await this.required(
        this.options.runLaunchctl(["kickstart", "-k", `${this.domain}/${serviceLabel}`]),
        `launchctl kickstart ${serviceLabel}`,
      );
      return;
    }
    await this.required(
      this.options.runLaunchctl(["bootstrap", this.domain, this.plistPath(name)]),
      `launchctl bootstrap ${serviceLabel}`,
    );
  }

  private async stopService(name: ServiceName): Promise<void> {
    const serviceLabel = label(name);
    if (!(await this.options.isLoaded(serviceLabel))) {
      return;
    }
    await this.required(
      this.options.runLaunchctl(["bootout", `${this.domain}/${serviceLabel}`]),
      `launchctl bootout ${serviceLabel}`,
    );
  }

  private async stopTailscale(): Promise<void> {
    const result = await this.options.runTailscale(["serve", "--yes", "--https=9443", "off"]);
    if (result.exitCode === 0 || result.stderr.includes("handler does not exist")) {
      return;
    }
    throw new Error(result.stderr.trim() || `Tailscale Serve stop failed with ${result.exitCode}`);
  }

  private async required(
    result: Promise<SlackLifecycleCommandResult>,
    description: string,
  ): Promise<void> {
    const receipt = await result;
    if (receipt.exitCode !== 0) {
      throw new Error(receipt.stderr.trim() || `${description} failed with ${receipt.exitCode}`);
    }
  }
}
