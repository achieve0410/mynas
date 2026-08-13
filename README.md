# MyNAS

MyNAS v0.3.0 is a macOS-first, localhost-first NAS service with mirrored storage,
integrity repair, S3-compatible backends, and a private photo library. It ships
as a strict TypeScript/Bun service, CLI, responsive web dashboard, Docker image,
Compose stack, and single-replica Kubernetes manifest.

MyNAS does not format, mount, eject, or repartition disks. You choose existing
directories and remain responsible for the underlying filesystems and backups.

## Features

- Local directories on internal or external macOS volumes
- S3-compatible storage with credentials supplied only through environment
  variables
- Exactly two storage members per software mirror
- SHA-256-addressed blobs and versioned file metadata in SQLite
- Degraded-member detection with write refusal
- Scrub reports, replica repair, range downloads, and exact-path file versions
- Scheduled catalog snapshots, mirror scrubs, bounded retention, and a durable
  maintenance run ledger
- JPEG ingestion, WebP previews, checksum deduplication, timeline, lightbox,
  and albums
- One localhost owner, expiring browser sessions, and revocable API tokens
- Responsive dashboard with bundled fonts and no external web dependencies
- Self-contained Apple Silicon runtime bundle, guided local mirror bootstrap,
  and managed launchd lifecycle
- Non-root Docker runtime and a one-replica Kubernetes deployment

## Safety model

- The native service binds to `127.0.0.1` unless a different host is explicitly
  passed.
- Initial owner setup is accepted only from a loopback peer.
- A mirror write is rejected if either member is unavailable.
- Stored backend configuration contains environment-variable names, never S3
  access keys or secret keys.
- The server database stores the Argon2id password hash plus session and API
  token hashes; the browser keeps its active session credential in
  `localStorage`.
- Browser sign-out revokes the active server session before clearing the local
  credential.
- MyNAS does not provide encryption at rest, TLS termination, internet exposure,
  RAID, filesystem repair, or a replacement for offline backups.

Do not expose port 7331 directly to an untrusted network. See
[SECURITY.md](SECURITY.md) for the supported threat model.

## Requirements

Packaged native operation:

- Apple Silicon macOS

Native development:

- macOS
- [Bun](https://bun.sh/) 1.3.14 or newer

Container operation:

- Docker Desktop with Compose
- A host directory shared with Docker Desktop when using local backends

## Packaged macOS quick start

For a tagged v0.2.0-or-newer release that contains macOS assets, download
`mynas-darwin-arm64.tar.gz` and its `.sha256` file from that same release,
then verify and install them. The existing v0.1.0 release predates this
packaging pipeline and has no native archive.

```sh
shasum -a 256 --check mynas-darwin-arm64.tar.gz.sha256
tar -xzf mynas-darwin-arm64.tar.gz
./mynas-darwin-arm64/install
export PATH="$HOME/.local/bin:$PATH"
```

The installer atomically places the self-contained Bun runtime, MyNAS
application, native Sharp libraries, and web assets under
`$HOME/Library/Application Support/MyNAS/runtime`. It does not require a
system Bun installation and does not touch catalog or mirror data.
It refuses to replace an unrelated `~/.local/bin/mynas` command and recovers
the previous runtime if an update was interrupted. A source checkout on Apple
Silicon can produce the same layout with `bun run package:macos`.

Choose two existing, independent storage locations. The bootstrap creates
missing directories, initializes the owner and catalog, records them as
`primary` and `secondary`, creates a `photos` mirror, verifies it as healthy,
and is safe to repeat only with the same password and topology:

```sh
printf 'MyNAS owner password: ' >&2
IFS= read -r -s MYNAS_PASSWORD
printf '\n' >&2
printf '%s\n' "$MYNAS_PASSWORD" |
  mynas bootstrap \
    --data-dir "$HOME/Library/Application Support/MyNAS/data" \
    --primary-root "/Volumes/Primary/MyNAS" \
    --secondary-root "/Volumes/Secondary/MyNAS" \
    --password-stdin
unset MYNAS_PASSWORD

mynas service install \
  --data-dir "$HOME/Library/Application Support/MyNAS/data"
mynas service status
open http://127.0.0.1:7331
```

The owner password is read from one standard-input line and never printed in
the bootstrap receipt. A wrong password or changed storage root is refused
without silently replacing the existing topology. The two roots must resolve
to distinct filesystem devices. Separate APFS volumes can still share one
physical disk, so choosing independent physical failure domains remains the
operator's responsibility.

`service install` writes a mode-0600 launch agent at
`~/Library/LaunchAgents/com.mynas.service.plist`, replaces an already loaded
instance, and keeps the service on loopback by default. Logs are stored under
`<data-dir>/logs`. Use `--no-start` to inspect the plist without loading it.
`mynas service uninstall` removes only the launch agent; it never deletes the
catalog, runtime, or backend data. Re-run the installer and `service install`
to repair or update the runtime.

For S3 or other service-only environment values, select each existing variable
explicitly during installation, for example `--env AWS_ACCESS_KEY_ID --env
AWS_SECRET_ACCESS_KEY`. Selected values are XML-escaped into the mode-0600
plist; no unselected shell environment is copied. A non-loopback service
automatically persists the already-required `MYNAS_ALLOW_REMOTE=true`.

Release archives are SHA-256 checksummed and the included Bun executable
retains the ad-hoc signature present on the pinned Bun runtime; this verifies
file structure, not an Apple Team identity. The archive includes the MyNAS
license, Bun redistribution notice, Sharp package licenses, full GPL/LGPL
terms, and the libvips source/build notice. MyNAS releases are not yet
Apple-notarized. Inspect the downloaded archive and approve its Terminal
execution according to your macOS security policy.

## Source macOS quick start

```sh
git clone https://github.com/achieve0410/mynas.git
cd mynas
bun install --frozen-lockfile
bun run build:web

mkdir -p "$HOME/MyNAS/data" "$HOME/MyNAS/disk-a" "$HOME/MyNAS/disk-b"
bun run mynas serve \
  --data-dir "$HOME/MyNAS/data" \
  --host 127.0.0.1 \
  --port 7331
```

Open <http://127.0.0.1:7331>, create the owner, then add the two existing
directories as local backends. Create a mirror named `photos` to enable the
photo library. The paths are not created, mounted, or modified by setup.

The SQLite catalog is stored at `<data-dir>/mynas.sqlite`. Mirror bytes are
stored below each backend root.

Native service binding is loopback-only unless the process explicitly sets
`MYNAS_ALLOW_REMOTE=true`. A remote bind still uses plain HTTP; place it only
on a trusted private network behind a separately managed TLS boundary.

### CLI authentication

The CLI defaults to `http://127.0.0.1:7331`. Set `MYNAS_URL` to use another
local endpoint. `login` returns JSON containing an expiring session token; copy
that value into `MYNAS_TOKEN` before protected commands.

```sh
printf 'MyNAS password: ' >&2
IFS= read -r -s MYNAS_PASSWORD
printf '\n' >&2
printf '%s' "$MYNAS_PASSWORD" |
  bun run mynas login --username owner --password-stdin
unset MYNAS_PASSWORD

export MYNAS_TOKEN='copy-the-returned-token'

bun run mynas backend add-local disk-a "$HOME/MyNAS/disk-a" --json
bun run mynas backend add-local disk-b "$HOME/MyNAS/disk-b" --json
bun run mynas volume create photos disk-a disk-b --json

bun run mynas put photos documents/example.txt ./example.txt --json
bun run mynas get photos documents/example.txt ./downloaded.txt --json
cmp ./example.txt ./downloaded.txt

bun run mynas volume scrub photos --wait --json
bun run mynas volume repair photos --wait --json
```

Create a longer-lived revocable API token with the Settings page or:

```sh
bun run mynas token-create --name automation
bun run mynas token-list
bun run mynas token-revoke TOKEN_ID
```

The raw API token is shown only when it is created. Its ID, name, and creation
time remain available in Settings and `token-list` so the owner can revoke it.

### Automatic maintenance

Open **Settings → Maintenance** to configure one policy for the service:

- choose an absolute backup directory outside the MyNAS data directory;
- choose catalog-backup and volume-scrub intervals from 1 to 8,760 hours;
- keep between 1 and 100 managed catalog backups; and
- enable the scheduler, or leave it disabled and use **Run maintenance now**.

The backup directory must be on storage that remains mounted and writable by
the MyNAS process. For Docker or Kubernetes, mount a separate persistent
directory at that path; a path that exists only in the container filesystem
will disappear when the container is replaced. Saving the policy assigns that
destination a random identity and creates a hidden, regular-file marker in the
directory. Markers are not shared between previously configured destinations.
If the mounted destination disappears, is substituted, or presents a marker
symlink, backup runs fail visibly instead of recreating the path on a different
filesystem. MyNAS verifies the marker before and after snapshot publication
and retention.

Each batch creates separate catalog-backup and volume-scrub records in the
Settings run ledger. A catalog backup is validated before it is marked
completed. Retention removes only snapshots owned by this MyNAS data directory
and always preserves the current successful snapshot; unrelated files and
snapshots from other instances are left untouched. A scrub checks every
configured mirror and records per-volume failures, but it does not repair
replicas automatically.

Scheduled intervals are measured from the policy update or the operation's
last finished attempt. The service serializes maintenance batches, refuses a
second manual run while one is active, and waits for an active batch before
closing its catalog during SIGINT/SIGTERM graceful shutdown. On the next
startup, an operation interrupted by a crash is marked failed rather than left
running forever. Inspect failed runs in Settings, resolve the reported storage
or path issue, and run maintenance again.

Automatic catalog snapshots contain credentials and metadata but not mirrored
blob bytes. Protect the backup directory and maintain an independent backup of
local backend roots or S3 objects. Recovery remains an explicit offline
operation described below.

### Catalog backup and recovery

Create catalog backups regularly and before changing storage configuration.
Backup may run while the service is online: SQLite creates a consistent
snapshot that includes committed WAL data. The output path must not already
exist.

```sh
mkdir -p "$HOME/MyNAS/backups"
bun run mynas catalog backup \
  --data-dir "$HOME/MyNAS/data" \
  --output "$HOME/MyNAS/backups/mynas-catalog.sqlite"
```

The command validates both the source and completed snapshot, then prints JSON
containing `integrity: "ok"` and the absolute backup path. Catalog backups
contain owner password hashes, session and API token hashes, backend
configuration, file/version metadata, and photo metadata. Store them with
permissions and encryption appropriate for credentials.

A catalog backup does **not** contain mirrored blob bytes. Back up local backend
roots independently and retain S3 objects according to the provider's
versioning or backup policy. A restored catalog cannot recreate missing
objects.

Restore is offline-only. Stop MyNAS, select a data directory with no existing
`mynas.sqlite`, `mynas.sqlite-wal`, or `mynas.sqlite-shm`, then restore and
restart the service:

```sh
bun run mynas catalog restore \
  --data-dir "$HOME/MyNAS/restored-data" \
  --input "$HOME/MyNAS/backups/mynas-catalog.sqlite"

bun run mynas serve \
  --data-dir "$HOME/MyNAS/restored-data" \
  --host 127.0.0.1 \
  --port 7331
```

Restore validates catalog integrity, foreign keys, and schema compatibility
before atomically installing `mynas.sqlite`. It refuses to replace an existing
catalog. Keep the original data directory unchanged until the restored service
and configured storage backends have been verified.

For Compose or Kubernetes, stop the workload before restore and mount the
existing metadata volume at the same data path in a one-off MyNAS container.
Do not delete the Compose volume or persistent volume during recovery.

## Storage backends

### Local directories

A local root should:

- be an existing directory, preferably expressed as an absolute path;
- remain at the same canonical path and filesystem identity;
- be writable by the MyNAS process; and
- be independently available when it is used as a mirror member.

For external macOS volumes, use a path below `/Volumes`. MyNAS reports the
member unavailable if the volume is removed, renamed, replaced, or mounted at a
different identity.

Two directories on one physical disk do not protect against disk failure. Use
independent devices or combine local and S3 members when failure independence
matters.

### S3-compatible storage

Add an S3 backend from the Storage page. Enter:

- endpoint URL;
- existing bucket;
- region;
- the name of the access-key environment variable; and
- the name of the secret-key environment variable.

For example, start the native service with `MYNAS_S3_ACCESS_KEY` and
`MYNAS_S3_SECRET_KEY` in its environment, then enter those names in the form.
Credential references must begin with `MYNAS_S3_`. The bucket must already
exist, and non-loopback endpoints must use HTTPS. MyNAS stores only the two
environment-variable names.

For Docker or Kubernetes, inject the same variables through a local Compose
override or a Kubernetes Secret. Never put their values in `compose.yaml`,
`k8s/mynas.yaml`, Git, logs, or screenshots.

## Docker Compose

The default Compose service binds only to host loopback, persists metadata in
the `mynas-data` volume, and mounts `./storage` at `/storage`. The image opts
into its internal `0.0.0.0` bind, but no host interface is exposed unless the
operator publishes one.

```sh
mkdir -p storage/disk-a storage/disk-b
docker compose up --build --detach --wait mynas
```

Owner setup must originate inside the container so the request remains on its
loopback interface:

```sh
printf 'MyNAS password: ' >&2
IFS= read -r -s MYNAS_PASSWORD
printf '\n' >&2
printf '%s' "$MYNAS_PASSWORD" |
  docker compose exec --no-TTY mynas \
    bun apps/cli/src/main.ts setup \
    --username owner \
    --password-stdin
unset MYNAS_PASSWORD
```

Open <http://127.0.0.1:7331> and use `/storage/disk-a` and
`/storage/disk-b` as local backend paths.

Set `MYNAS_STORAGE_PATH` to bind a different host directory. On macOS, that
path must be shared in Docker Desktop:

```sh
MYNAS_STORAGE_PATH=/Volumes/External/MyNAS docker compose up --detach --wait mynas
```

`docker compose down` keeps the metadata volume. `docker compose down
--volumes` permanently removes the containerized MyNAS catalog.

The `qa` profile runs MinIO with public synthetic defaults for local testing. It
is not a production S3 deployment:

```sh
docker compose --project-name mynas-minio-qa --profile qa up --detach minio
docker compose --project-name mynas-minio-qa --profile qa run --rm minio-init
docker compose --project-name mynas-minio-qa --profile qa down --volumes
```

## Kubernetes

`k8s/mynas.yaml` defines:

- a `mynas` namespace;
- a 5 GiB `ReadWriteOnce` PVC for SQLite metadata;
- one non-root `Recreate` deployment; and
- a private `ClusterIP` service on port 7331 with namespace-scoped ingress.

```sh
kubectl apply -f k8s/mynas.yaml
kubectl -n mynas rollout status deployment/mynas
kubectl -n mynas port-forward service/mynas 7331:7331
```

Run initial setup from inside the pod:

```sh
printf 'MyNAS password: ' >&2
IFS= read -r -s MYNAS_PASSWORD
printf '\n' >&2
printf '%s' "$MYNAS_PASSWORD" |
  kubectl -n mynas exec --stdin deployment/mynas -- \
    bun apps/cli/src/main.ts setup \
    --username owner \
    --password-stdin
unset MYNAS_PASSWORD
```

The supplied PVC stores the catalog only. Add storage mounts or inject S3
credentials for data backends. Keep `replicas: 1`; this release does not
coordinate SQLite or local files across pods. The manifest intentionally ships
without an Ingress or TLS policy.

## Photos

Create a healthy mirror with the exact ID `photos` before uploading. v0.2.0
accepts JPEG originals, records dimensions and import time, generates WebP
previews, deduplicates by SHA-256, and supports timeline and album views.
Originals are downloaded only through an explicit action.

## Development and QA

```sh
bun install --frozen-lockfile
bun run verify
bun run qa:packaging
```

Docker and Kubernetes acceptance harnesses:

```sh
bun run qa:docker
bun run qa:kubernetes
bun run qa:s3
```

`qa:docker` rebuilds the image from the current checkout, creates isolated
synthetic data, waits on the container health state, performs a literal
mirrored file roundtrip, and removes its containers, volumes, ports, and
temporary bind path. `qa:kubernetes` uses a server-side dry-run when a local
cluster is available; otherwise it records strict pinned schema validation.
`qa:s3` provisions the synthetic MinIO profile, verifies a local-plus-S3
mirror roundtrip, and removes its MinIO containers, volume, port, and temporary
data.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.

## Known limitations in v0.3.0

- Mirrors have exactly two members; there is no parity or multi-member RAID.
- Photo ingestion accepts JPEG, PNG, and HEIC originals and derives WebP previews.
- File and photo pickers support multiple items and Chrome-family directory selection with relative
  paths preserved; empty directories are not represented by the browser picker.
- Batch uploads keep successful items and report only failed item paths. Selected files, folders,
  and photos download as path-preserving ZIP archives.
- File uploads are limited to 64 MiB and photo uploads to 25 MiB.
- Maintenance is serialized and scheduled, but has no external alert delivery.
- S3 buckets and local backend directories must already exist.
- The Kubernetes manifest is single-replica and does not mount a data backend.
- No application-level encryption at rest, TLS termination, sharing links,
  remote-user administration, mobile app, or automatic disk management.
- Native packaging is Apple Silicon-only; the Linux container is the other
  exercised packaged runtime.

## Release and support

- [v0.3.0 release notes and earlier history](RELEASE_NOTES.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contribution guide](CONTRIBUTING.md)

MyNAS is licensed under Apache-2.0. See [LICENSE](LICENSE).
