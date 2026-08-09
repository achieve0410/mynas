# MyNAS

MyNAS is a local-first, open-source NAS for macOS. It combines internal disks,
external volumes, and S3-compatible storage behind one virtual namespace.
Two-member software mirrors, checksum scrubbing and repair, and a private photo
gallery are the core of the first release.

> MyNAS is under active development. Version 0.1.0 is not yet released.

## Principles

- Preserve bytes and prove their integrity with SHA-256.
- Refuse degraded writes rather than create divergent mirrors.
- Bind to localhost by default and keep credentials out of stored configuration.
- Never format, mount, or eject a user's disks.
- Use synthetic fixtures only in the public repository.

## Development

Requirements: macOS and [Bun](https://bun.sh/) 1.3.14 or newer.

```sh
bun install --frozen-lockfile
bun run verify
```

The complete operator guide and release notes will be published with v0.1.0.

## License

Apache-2.0. See [LICENSE](LICENSE).

