import { describe, expect, test } from "bun:test";

import { ensureDockerContextReady, mysqlLogicalDumpArguments } from "./runtime";

describe("Slack snapshot runtime", () => {
  test("pins mysqldump to the configured Docker context", () => {
    expect(mysqlLogicalDumpArguments("slack_dashboard_db", "colima").slice(0, 5)).toEqual([
      "docker",
      "--context",
      "colima",
      "exec",
      "slack_dashboard_db",
    ]);
  });

  test("starts Colima before backup when its Docker context is unavailable", async () => {
    const calls: string[] = [];
    let dockerChecks = 0;

    await ensureDockerContextReady("colima", async (arguments_) => {
      calls.push(arguments_.join(" "));
      if (arguments_[0] === "docker") {
        dockerChecks += 1;
        return dockerChecks === 1
          ? { exitCode: 1, stderr: "daemon unavailable", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: "ready" };
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    });

    expect(calls).toEqual([
      "docker --context colima info",
      "colima start --activate=false",
      "docker --context colima info",
    ]);
  });
});
