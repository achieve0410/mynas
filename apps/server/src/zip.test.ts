import { describe, expect, test } from "bun:test";

import { createZip } from "./zip";

describe("createZip", () => {
  test("rejects entry paths that could escape an extraction directory", () => {
    const contents = new TextEncoder().encode("unsafe");

    for (const path of ["../escape.txt", "/absolute.txt", "folder\\escape.txt", "a/./b.txt"]) {
      expect(() => createZip([{ contents, path }])).toThrow("unsafe ZIP entry path");
    }
  });
});
