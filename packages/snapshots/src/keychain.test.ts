import { expect, test } from "bun:test";

import { SnapshotKeychain, type SnapshotKeychainRunner } from "./keychain";

test("moves secrets through helper stdin and supports put get delete", async () => {
  const calls: unknown[] = [];
  const runner: SnapshotKeychainRunner = async (input) => {
    const request = JSON.parse(new TextDecoder().decode(input)) as {
      readonly account: string;
      readonly operation: string;
      readonly value?: string;
    };
    calls.push(request);
    return request.operation === "get"
      ? new TextEncoder().encode(
          JSON.stringify({ value: Buffer.from("secret").toString("base64") }),
        )
      : new TextEncoder().encode("{}");
  };
  const keychain = new SnapshotKeychain(runner, "io.mynas.slack-snapshot");

  await keychain.put("enc:v1", new TextEncoder().encode("secret"));
  expect(new TextDecoder().decode(await keychain.get("enc:v1"))).toBe("secret");
  await keychain.delete("enc:v1");

  expect(calls).toEqual([
    {
      account: "enc:v1",
      operation: "put",
      service: "io.mynas.slack-snapshot",
      value: "c2VjcmV0",
    },
    {
      account: "enc:v1",
      operation: "get",
      service: "io.mynas.slack-snapshot",
    },
    {
      account: "enc:v1",
      operation: "delete",
      service: "io.mynas.slack-snapshot",
    },
  ]);
});
