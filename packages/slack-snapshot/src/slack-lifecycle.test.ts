import { describe, expect, test } from "bun:test";

import {
  SlackDashboardLifecycle,
  type SlackLifecycleCommandRunner,
  type SlackPortWaiter,
} from "./slack-lifecycle";

const labels = [
  "io.mynas.slack-dashboard.gunicorn",
  "io.mynas.slack-dashboard.nginx",
  "io.mynas.slack-dashboard.sync",
  "io.mynas.slack-dashboard.tagging",
  "io.mynas.slack-dashboard.classify",
] as const;

const fixture = (loaded = false) => {
  const calls: string[] = [];
  const runLaunchctl: SlackLifecycleCommandRunner = async (arguments_) => {
    calls.push(`launchctl ${arguments_.join(" ")}`);
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const runTailscale: SlackLifecycleCommandRunner = async (arguments_) => {
    calls.push(`tailscale ${arguments_.join(" ")}`);
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const waitForPort: SlackPortWaiter = async (port, state) => {
    calls.push(`port ${port} ${state}`);
  };
  return {
    calls,
    lifecycle: new SlackDashboardLifecycle({
      home: "/home/owner",
      isLoaded: async () => loaded,
      runLaunchctl,
      runTailscale,
      uid: 501,
      verifyPlist: async () => undefined,
      waitForPort,
    }),
  };
};

describe("SlackDashboardLifecycle", () => {
  test("stops every loaded writer and ingress before the snapshot", async () => {
    const { calls, lifecycle } = fixture(true);

    await lifecycle.stop();

    expect(calls).toEqual([
      "tailscale serve --yes --https=9443 off",
      "launchctl bootout gui/501/io.mynas.slack-dashboard.tagging",
      "launchctl bootout gui/501/io.mynas.slack-dashboard.classify",
      "launchctl bootout gui/501/io.mynas.slack-dashboard.sync",
      "launchctl bootout gui/501/io.mynas.slack-dashboard.nginx",
      "port 9120 closed",
      "launchctl bootout gui/501/io.mynas.slack-dashboard.gunicorn",
      "port 9121 closed",
    ]);
  });

  test("restores unloaded services and Tailnet ingress in dependency order", async () => {
    const { calls, lifecycle } = fixture();

    await lifecycle.start();

    expect(calls).toEqual([
      "launchctl bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.gunicorn.plist",
      "port 9121 open",
      "launchctl bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.nginx.plist",
      "port 9120 open",
      "port 9130 open",
      "launchctl bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.sync.plist",
      "launchctl bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.tagging.plist",
      "launchctl bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.classify.plist",
      "tailscale serve --yes --bg --https=9443 https+insecure://127.0.0.1:9120",
    ]);
  });

  test("kickstarts loaded core jobs without rerunning loaded schedules", async () => {
    const { calls, lifecycle } = fixture(true);

    await lifecycle.start();

    expect(calls).toEqual([
      "launchctl kickstart -k gui/501/io.mynas.slack-dashboard.gunicorn",
      "port 9121 open",
      "launchctl kickstart -k gui/501/io.mynas.slack-dashboard.nginx",
      "port 9120 open",
      "port 9130 open",
      "launchctl kickstart -k gui/501/io.mynas.slack-dashboard.sync",
      "tailscale serve --yes --bg --https=9443 https+insecure://127.0.0.1:9120",
    ]);
  });

  test("missing plist preflight causes no system mutation", async () => {
    const calls: string[] = [];
    const lifecycle = new SlackDashboardLifecycle({
      home: "/home/owner",
      isLoaded: async () => true,
      runLaunchctl: async (arguments_) => {
        calls.push(`launchctl ${arguments_.join(" ")}`);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      runTailscale: async (arguments_) => {
        calls.push(`tailscale ${arguments_.join(" ")}`);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      uid: 501,
      verifyPlist: async (path) => {
        if (path.endsWith("sync.plist")) {
          throw new Error("missing sync plist");
        }
      },
      waitForPort: async () => undefined,
    });

    await expect(lifecycle.stop()).rejects.toThrow("missing sync plist");
    expect(calls).toEqual([]);
  });

  test("partial stop failure attempts complete rollback startup", async () => {
    const calls: string[] = [];
    const lifecycle = new SlackDashboardLifecycle({
      home: "/home/owner",
      isLoaded: async () => true,
      runLaunchctl: async (arguments_) => {
        calls.push(arguments_.join(" "));
        return arguments_.includes("gui/501/io.mynas.slack-dashboard.sync") &&
          arguments_[0] === "bootout"
          ? { exitCode: 5, stderr: "sync bootout rejected", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: "" };
      },
      runTailscale: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      uid: 501,
      verifyPlist: async () => undefined,
      waitForPort: async () => undefined,
    });

    await expect(lifecycle.stop()).rejects.toThrow("sync bootout rejected");
    expect(calls).toContain("kickstart -k gui/501/io.mynas.slack-dashboard.gunicorn");
    expect(calls).toContain("kickstart -k gui/501/io.mynas.slack-dashboard.sync");
  });

  test("start restores independent jobs but withholds ingress after web failure", async () => {
    const calls: string[] = [];
    const lifecycle = new SlackDashboardLifecycle({
      home: "/home/owner",
      isLoaded: async () => false,
      runLaunchctl: async (arguments_) => {
        calls.push(arguments_.join(" "));
        return arguments_.at(-1)?.endsWith("gunicorn.plist")
          ? { exitCode: 5, stderr: "gunicorn bootstrap rejected", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: "" };
      },
      runTailscale: async (arguments_) => {
        calls.push(arguments_.join(" "));
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      uid: 501,
      verifyPlist: async () => undefined,
      waitForPort: async () => undefined,
    });

    await expect(lifecycle.start()).rejects.toThrow("gunicorn bootstrap rejected");
    expect(calls).toContain(
      "bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.sync.plist",
    );
    expect(calls).toContain(
      "bootstrap gui/501 /home/owner/Library/LaunchAgents/io.mynas.slack-dashboard.classify.plist",
    );
    expect(calls.some((call) => call.startsWith("serve "))).toBe(false);
  });

  test("preflights every exact installed plist", async () => {
    const paths: string[] = [];
    const lifecycle = new SlackDashboardLifecycle({
      home: "/home/owner",
      isLoaded: async () => false,
      runLaunchctl: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      runTailscale: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      uid: 501,
      verifyPlist: async (path) => {
        paths.push(path);
      },
      waitForPort: async () => undefined,
    });

    await lifecycle.start();
    expect(paths).toEqual(
      labels.map((service) => `/home/owner/Library/LaunchAgents/${service}.plist`),
    );
  });
});
