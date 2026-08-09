# MyNAS v0.1.0

MyNAS v0.1.0 is the first public release of a macOS-first, localhost-first NAS with
two-member mirrors, integrity repair, S3-compatible storage, and a private photo
gallery.

## Highlights

- Strict TypeScript on Bun 1.3.14
- SQLite catalog with explicit migrations, foreign keys, and WAL mode
- Existing local-directory and S3-compatible storage backends
- Exactly two members per mirror with degraded-write refusal
- SHA-256-addressed content, version metadata, byte ranges, tombstones, and
  restore
- Scrub reports for healthy, corrupt, missing, unavailable, and unrecoverable
  replicas
- Replica repair from the healthy member
- JPEG metadata ingestion, WebP previews, deduplication, timeline, lightbox,
  and albums
- Local owner setup, Argon2id passwords, expiring sessions, and revocable API
  tokens
- Browser sign-out revokes the active server session
- Responsive dashboard with bundled Latin, Korean, and Japanese fonts
- Native CLI for service, authentication, local backends, mirrors, file
  transfer, scrub, and repair
- Non-root Docker image, Compose stack with QA MinIO, and single-replica
  Kubernetes resources

## Verified release surfaces

- Native authenticated local-mirror upload/download and literal file comparison
- One-replica corruption detection, repair, post-repair scrub, external-volume
  removal, and degraded-write refusal
- Local plus MinIO mirror roundtrip with QA-only credentials
- Real Chrome photo upload, album membership, keyboard lightbox, mobile
  overflow, CJK filenames, and original SHA-256
- Docker image health, two mounted members, mirrored file roundtrip, and full
  teardown
- Strict Kubernetes 1.31 schema validation for Namespace, PVC, Deployment, and
  Service; no local cluster was available for server-side dry-run

All repository fixtures are synthetic. Ignored QA evidence contains synthetic,
non-personal data only.

## Upgrade and compatibility

This is the first persistence format. There is no supported upgrade path from
development snapshots. Start v0.1.0 with a new data directory.

The release is tested on macOS and in the packaged Linux container. Other host
platforms are not part of the v0.1.0 support statement.

## Operational notes

- Create local directories and S3 buckets before registering them.
- Use independent failure domains for meaningful mirror protection.
- Create a mirror with the exact ID `photos` before using the photo library.
- Keep native and Compose endpoints on loopback.
- Run Docker owner setup from inside the container.
- Keep the Kubernetes deployment at one replica.
- Preserve independent offline backups. A mirror is not a backup.

## Known limitations

- Two members per mirror; no parity, erasure coding, or multi-member RAID
- Exact-path file access rather than directory browsing
- JPEG-only photo ingestion
- Synchronous scrub and repair
- No automatic disk discovery, formatting, mounting, or ejection
- No TLS termination, application-level encryption at rest, sharing links,
  remote-user administration, or direct internet-exposure support
- Kubernetes manifest stores metadata on its PVC but requires operator-provided
  data mounts or S3 credentials

See [README.md](README.md) for installation and operation and
[SECURITY.md](SECURITY.md) for the security boundary.
