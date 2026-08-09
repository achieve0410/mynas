# Contributing

Thank you for improving MyNAS. Open an issue before starting a large change so
its storage and compatibility implications can be discussed.

## Development checks

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
```

Do not include credentials, tokens, private file names, databases, or personal
photos in issues, tests, fixtures, logs, or commits. Tests must use generated
or clearly synthetic data.

