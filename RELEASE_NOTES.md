# MyNAS v0.4.0

MyNAS v0.4.0 strengthens recovery truth and operational visibility without
claiming complete catalog-and-blob backup coverage.

## Highlights

- credential-safe catalog restore requiring a replacement owner password,
  with old users, browser sessions, and API tokens removed before publication
- supported v0.3.0 schema-6 catalog staging and migration before restore
- durable catalog-backup and volume-scrub incidents with restart-safe identity,
  occurrence tracking, resolution, impact, and remediation
- authenticated responsive Protection UI with explicit unknown/error state and
  independent active-incident truth
- route-independent transfer queues with a three-job bound, progress,
  cancellation, bounded terminal history, and foreground resume
- protected photo import review with SHA-256 receipts, EXIF capture/GPS
  metadata backfill, capture-time ordering, album management, and safe
  library/album deletion semantics
- authenticated encrypted snapshot bundles with manifest-last publication,
  verified CLI download, Keychain-backed agent credentials, retention, and
  optional Slack workflow notifications

## Verification and compatibility

- Strict Biome and TypeScript checks, production web build, repository tests,
  and real Chrome journeys cover protection incidents, secure restore, transfer
  queues, photo workflows, and responsive layouts.
- macOS package and release audits verify version coupling, runtime contents,
  licenses, checksums, and private-data exclusion.
- Existing v0.3.0 catalogs migrate in place through schema 10. Catalog restore
  accepts the supported v0.3.0 schema-6 staging format and migrates it before
  replacing owner credentials.

## Remaining recovery limits

- Catalog backups still exclude mirrored blob bytes.
- Complete general-purpose recovery sets, offsite replication, bounded
  streaming, and independent delivery of protection-incident alerts remain
  future work.

---

## MyNAS v0.3.0

MyNAS v0.3.0 expands protected transfers across the Files and Photos workspaces
while preserving the existing local-first, two-replica storage contract.

## Highlights

- JPEG, PNG, and HEIC photo ingestion with byte-verified format detection,
  content-addressed originals, and WebP previews
- Multiple-file and Chrome-family directory uploads for Files and Photos with
  relative paths preserved
- Per-item upload isolation: successful items remain protected while only
  failed relative paths are reported for retry
- Selected file, folder, and photo downloads as UTF-8 path-preserving ZIP
  archives with zip-slip path rejection
- Schema v6 migration preserving existing JPEG photo rows and packaged
  `heic-decode`/`libheif-js` support for Apple Silicon releases

## Verification surfaces

- RED-to-GREEN service/API coverage for PNG and real HEIC decoding, original
  MIME types, schema migration, archive contents, and unsafe ZIP entry paths
- Real Chrome journeys for mixed-success directory uploads, retained successes,
  failed-path reporting, multi-selection, and ZIP downloads
- Full Biome, strict TypeScript, production web build, 128-test repository
  suite, macOS package assembly, checksum, runtime-layout, and license audit

## Remaining limitations

- The macOS package remains Apple Silicon-only and is not Apple-notarized
- Directory selection depends on Chrome-family `webkitdirectory` behavior and
  cannot represent empty directories
- Photo processing remains foreground work without sharing, TLS termination,
  or encryption at rest
- Product-market fit and willingness to pay remain unproven until external
  paid-beta users validate them

# MyNAS v0.2.0 release candidate

The v0.2.0 code on `main` is prepared for the first self-contained Apple
Silicon package. The immutable GitHub release and its native assets are created
only when the matching `v0.2.0` tag is pushed; v0.1.0 remains the historical
source/container release and has no macOS archive.

## Highlights

- Catalog-first folder browsing, bounded binary-prefix pagination, version
  history, checksum-verified restore, and authenticated download
- Persisted automatic catalog-backup and mirror-scrub policy with independent
  run history, retention, destination identity, overlap serialization, and
  graceful shutdown
- Self-contained Apple Silicon runtime with Bun, Sharp/libvips, the production
  web build, licenses/notices, atomic clean-HOME installer, and SHA-256 archive
- Password-stdin offline bootstrap for one owner, two distinct filesystem
  devices, and a healthy `photos` mirror; exact reruns are database-idempotent
- Mode-0600 launchd lifecycle with staged replacement rollback, loaded/running
  status, explicit environment selection, and data-preserving uninstall
- Same-origin JSON owner setup, loopback-by-default service binding, artifact
  path/permission audit, immutable tag/version coupling, and split read/write
  release credentials

## Verification surfaces

- Focused RED-to-GREEN tests for bootstrap safety, launchd rollback, installer
  recovery, packaging layout, workflow permissions, and bundled CSP
- Full TypeScript, Biome, production web build, repository test, and real
  Chromium gates
- Clean-HOME package install, exact-repeat and bad-input bootstrap, temporary
  distinct-device APFS validation, live packaged HTTP/photo preview, launchd
  lifecycle, checksum, archive-path/mode scan, and cleanup proof

## Remaining paid-beta limitations

- Package is Apple Silicon-only and not Apple-notarized
- Photo ingestion remains JPEG-only and foreground processing remains limited
  compared with mature photo products
- No direct internet-exposure support, TLS termination, sharing, or encryption
  at rest
- A separate filesystem device is enforceable; truly independent physical
  failure domains remain the operator's responsibility
- Product-market fit and willingness to pay remain unproven until external
  paid-beta users validate them

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
- Strict Kubernetes 1.31 schema validation for Namespace, PVC, Deployment,
  Service, and NetworkPolicy; no local cluster was available for server-side
  dry-run

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
