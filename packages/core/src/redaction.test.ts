import { describe, expect, test } from "bun:test";

import { redactLogFields } from "./redaction";

describe("redactLogFields", () => {
  test("removes credentials while preserving operational fields", () => {
    expect(
      redactLogFields({
        authorization: "Bearer secret-token",
        cookie: "session=secret",
        password: "correct horse battery staple",
        requestId: "req-01",
      }),
    ).toEqual({
      authorization: "[Redacted]",
      cookie: "[Redacted]",
      password: "[Redacted]",
      requestId: "req-01",
    });
  });
});
