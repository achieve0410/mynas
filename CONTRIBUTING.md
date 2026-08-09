# Contributing to MyNAS

Thank you for improving MyNAS. Open an issue before starting a large change so
its storage, security, migration, and compatibility implications can be
discussed.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security vulnerabilities belong in GitHub private vulnerability reporting, not
public issues.

## Development setup

Requirements:

- macOS
- Bun 1.3.14 or newer
- Docker Desktop for packaging, live container, or MinIO checks

```sh
git clone https://github.com/achieve0410/mynas.git
cd mynas
bun install --frozen-lockfile
bun run verify
```

## Change discipline

- Add a failing test before changing behavior.
- Keep strict TypeScript and model untrusted boundaries with Zod.
- Preserve the localhost-first setup boundary and degraded-write refusal.
- Do not add compatibility shims or speculative abstractions.
- Keep source modules below 250 lines; split cohesive modules when needed.
- Never use fixed sleeps or timing-dependent polling in tests. Subscribe to the
  exact event or state transition and use a bounded timeout.
- Keep changes focused. Do not refactor unrelated code in a bug fix.

## Required checks

For source changes:

```sh
bun run lint
bun run typecheck
bun run build:web
bun run test
```

Run `bun run test:browser` for web behavior. It requires system Chrome and
captures ignored evidence below `.artifacts/qa/photos/`.

Run these when packaging changes:

```sh
bun run qa:packaging
bun run qa:docker
bun run qa:kubernetes
bun run qa:s3
```

The live harnesses must leave no containers, volumes, listeners, or temporary
paths.

## Fixtures and private data

Do not include credentials, tokens, private filenames, databases, machine
paths, hostnames, addresses, personal photos, or production data in issues,
tests, fixtures, logs, commits, or screenshots.

Tests must use deterministic generated or clearly synthetic data. Never commit
`.env`, SQLite files, downloaded originals, browser profiles, or `.artifacts`.

## Pull requests

Describe:

1. the user-visible problem;
2. the test that failed before the change;
3. the implementation boundary;
4. the exact verification commands and results; and
5. any migration, security, storage-integrity, or cleanup impact.

Keep commits atomic and use the repository’s existing conventional prefixes
such as `feat:`, `fix:`, `docs:`, and `test:`.
