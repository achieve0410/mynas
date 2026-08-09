import { describe, expect, test } from "bun:test";

import { parseConfig } from "./config";

describe("parseConfig", () => {
  test("defaults to a localhost-only service", () => {
    expect(parseConfig({ MYNAS_DATA_DIR: "/tmp/mynas" })).toEqual({
      allowRemote: false,
      dataDir: "/tmp/mynas",
      host: "127.0.0.1",
      port: 7331,
    });
  });

  test("rejects remote binding unless explicitly enabled", () => {
    expect(() =>
      parseConfig({
        MYNAS_DATA_DIR: "/tmp/mynas",
        MYNAS_HOST: "0.0.0.0",
      }),
    ).toThrow("MYNAS_ALLOW_REMOTE=true");
  });
});
