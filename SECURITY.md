# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| 0.1.x | No |
| Earlier or unreleased snapshots | No |

Security fixes are provided for the current v0.2 patch line.

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
- S3 configuration stores environment-variable names instead of credentials.
- Logs redact authorization and password fields and omit machine identity.
- Mirror writes stop when either member is unavailable.

MyNAS v0.2.0 does not provide TLS termination, application-level encryption at
rest, sandboxing of the host directories you explicitly grant, multi-user
authorization, or safe direct internet exposure. Use operating-system
permissions, encrypted disks, Kubernetes Secrets, private networking, and a
separate trusted TLS boundary where appropriate.

Compromise of the MyNAS process grants access to its configured local roots,
SQLite catalog, and environment-provided cloud credentials. Grant only the
minimum required paths and bucket permissions.
