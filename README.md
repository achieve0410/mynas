# MyNAS

MyNAS v0.1.0 is a macOS-first, localhost-first NAS service with mirrored storage,
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
- JPEG ingestion, WebP previews, checksum deduplication, timeline, lightbox,
  and albums
- One localhost owner, expiring browser sessions, and revocable API tokens
- Responsive dashboard with bundled fonts and no external web dependencies
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

Native development and operation:

- macOS
- [Bun](https://bun.sh/) 1.3.14 or newer

Container operation:

- Docker Desktop with Compose
- A host directory shared with Docker Desktop when using local backends

## Native macOS quick start

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

Create a healthy mirror with the exact ID `photos` before uploading. v0.1.0
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
```

`qa:docker` rebuilds the image from the current checkout, creates isolated
synthetic data, waits on the container health state, performs a literal
mirrored file roundtrip, and removes its containers, volumes, ports, and
temporary bind path. `qa:kubernetes` uses a server-side dry-run when a local
cluster is available; otherwise it records strict pinned schema validation.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.

## Known limitations in v0.1.0

- Mirrors have exactly two members; there is no parity or multi-member RAID.
- The Files page addresses known object paths; it is not a directory browser.
- Photo ingestion is JPEG-only.
- File uploads are limited to 64 MiB and photo uploads to 25 MiB in v0.1.0.
- Repair and scrub operations are synchronous.
- S3 buckets and local backend directories must already exist.
- The Kubernetes manifest is single-replica and does not mount a data backend.
- No application-level encryption at rest, TLS termination, sharing links,
  remote-user administration, mobile app, or automatic disk management.
- Only macOS and the packaged Linux container have been exercised for v0.1.0.

## Release and support

- [v0.1.0 release notes](RELEASE_NOTES.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contribution guide](CONTRIBUTING.md)

MyNAS is licensed under Apache-2.0. See [LICENSE](LICENSE).
