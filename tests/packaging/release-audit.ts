import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { command, repositoryRoot, requireSuccess } from "./docker-helpers";

const forbiddenPath =
  /(^|\/)(\.env|\.artifacts|\.omo)(\/|$)|\.(db|sqlite|sqlite3|pem|key|p12|pfx|mobileprovision|log)$/i;
const forbiddenContent = [
  new RegExp("/" + "Users/"),
  new RegExp("/var/" + "folders/"),
  new RegExp("Mac" + "mini", "i"),
  new RegExp("won" + "hyo", "i"),
  new RegExp("BEGIN " + "(RSA|OPENSSH|EC) PRIVATE KEY"),
  new RegExp("A" + "KIA[0-9A-Z]{16}"),
  new RegExp("g" + "h[pousr]_[A-Za-z0-9_]{20,}"),
] as const;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const allowedPublicEmails = new Set(["licensing@fsf.org"]);
const publicIdentities = new Set([
  "achieve0410\u0000achieve0410@users.noreply.github.com",
  "Won" + "hyo Choi\u000037432155+achieve0410@users.noreply.github.com",
]);
const releaseAuditRef = process.env.MYNAS_RELEASE_AUDIT_REF ?? "HEAD";

const trackedOutput = requireSuccess(
  await command(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {}),
  "tracked-file inventory",
);
const trackedFiles = trackedOutput.split("\0").filter((path) => path.length > 0);
const forbiddenPaths = trackedFiles.filter((path) => forbiddenPath.test(path));
if (forbiddenPaths.length > 0) {
  throw new Error(`private artifacts are tracked: ${forbiddenPaths.join(", ")}`);
}

for (const path of trackedFiles) {
  const contents = await readFile(resolve(repositoryRoot, path));
  if (contents.includes(0)) {
    throw new Error(`tracked binary requires explicit release review: ${path}`);
  }
  const text = contents.toString("utf8");
  for (const pattern of forbiddenContent) {
    if (pattern.test(text)) {
      throw new Error(`private content matched ${pattern.source} in ${path}`);
    }
  }
  const emails = text.match(emailPattern) ?? [];
  if (
    emails.some(
      (email) =>
        !email.endsWith("@users.noreply.github.com") &&
        !allowedPublicEmails.has(email.toLowerCase()),
    )
  ) {
    throw new Error(`non-public email address found in ${path}`);
  }
}

const history = requireSuccess(
  await command(["git", "log", "--all", "-p", "--", ".", ":(exclude)bun.lock"], {}),
  "history export",
);
for (const pattern of forbiddenContent) {
  if (pattern.test(history)) {
    throw new Error(`private content matched ${pattern.source} in Git history`);
  }
}

const identities = requireSuccess(
  await command(["git", "log", releaseAuditRef, "--format=%an%x00%ae"], {}),
  "release ancestry identity inventory",
)
  .split("\n")
  .filter((identity) => identity.length > 0);
if (identities.some((identity) => !publicIdentities.has(identity))) {
  throw new Error("Git history contains a non-public commit identity");
}

requireSuccess(
  await command(["gitleaks", "git", "--no-banner", "--redact", "."], {}),
  "Gitleaks history scan",
);
requireSuccess(
  await command(
    ["trufflehog", "git", `file://${repositoryRoot}`, "--only-verified", "--no-update", "--fail"],
    {},
  ),
  "TruffleHog verified history scan",
);

const artifactRoot = resolve(repositoryRoot, ".artifacts/qa/release");
await mkdir(artifactRoot, { recursive: true });
await writeFile(
  resolve(artifactRoot, "audit.json"),
  `${JSON.stringify(
    {
      commitIdentities: [...new Set(identities)],
      forbiddenContentMatches: 0,
      forbiddenTrackedPaths: 0,
      gitleaksHistory: "clean",
      trackedBinaryFiles: 0,
      trackedFiles: trackedFiles.length,
      trufflehogVerifiedSecrets: 0,
    },
    null,
    2,
  )}\n`,
);
console.log("RELEASE_AUDIT_PASS=1");
