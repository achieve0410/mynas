# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.4.x | Yes |
| 0.3.x and earlier | No |
| Unreleased snapshots | No |

Security fixes are provided for the current v0.4 patch line.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/achieve0410/mynas/security/advisories/new).
Include the affected version, reproduction steps, impact, and a minimal
synthetic proof without real credentials or personal data.

The project will acknowledge a complete report within seven days and coordinate
disclosure before publishing an advisory or fix.

## Security boundary

MyNAS is designed for a trusted local machine or private cluster:

- Native service startup defaults to `127.0.0.1`.
- Compose publishes port 7331 only on host loopback.
- Initial owner setup is restricted to a loopback peer.
- The server database persists the Argon2id password hash plus session and API
  token hashes.
- The browser keeps its active session credential in `localStorage`; treat
  script execution in the MyNAS origin as trusted.
- Browser sign-out revokes the active server session.
- Catalog restore requires a replacement owner credential and removes restored
  users, browser sessions, and API tokens before publication.
- S3 configuration stores environment-variable names instead of credentials.
- Logs redact authorization and password fields and omit machine identity.
- Mirror writes stop when either member is unavailable.
- Snapshot-bundle encryption and signing keys, producer API tokens, and
  optional notification credentials are held in the macOS Keychain; encrypted
  bundle storage does not encrypt ordinary MyNAS file or photo objects.
- The optional Slack snapshot agent is a privileged local integration. When
  explicitly configured it can read selected database, environment, artifact,
  token, and TLS paths; control matching launchd jobs; access the selected
  Docker context; and update a Tailscale Serve route.

MyNAS v0.4.0 does not provide TLS termination, application-level encryption at
rest for general file/photo storage, sandboxing of the host directories you
explicitly grant, multi-user authorization, or safe direct internet exposure.
Use operating-system
permissions, encrypted disks, Kubernetes Secrets, private networking, and a
separate trusted TLS boundary where appropriate.

Treat Docker access, launchd control, Tailscale administration, snapshot
signing keys, and configured backup roots as administrator-level capabilities.
The optional Slack snapshot agent should use a dedicated scoped MyNAS token and
must not be installed on a host where those local capabilities are untrusted.

Compromise of the MyNAS process grants access to its configured local roots,
SQLite catalog, and environment-provided cloud credentials. Grant only the
minimum required paths and bucket permissions.
