export const snapshotKeychainAccounts = {
  encryptionRoot: "enc:v1",
  signingPrivateKey: "sig:v1",
  signingPublicKey: "sig-public:v1",
  slackChannel: "notify:slack-channel:v1",
  slackToken: "notify:slack-bot:v1",
  snapshotToken: "mynas:slack-dashboard",
} as const;

export const decodeKeychainText = (value: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(value);
