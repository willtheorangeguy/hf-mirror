# Deployment

Use the Linux amd64 or arm64 container for a reproducible deployment. Initial
setup is in [quickstart](./getting-started.md); source and local-image builds are in
[installation](./installation.md).

## Container lifecycle

The [Compose service](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/docker-compose.yml) publishes host `${PORT:-5321}` to
container port 5321, mounts `./data:/app/data`, and restarts unless stopped.
The process runs as UID/GID 1001. Prepare only the intended data directory with
appropriate ownership; existing bind mounts must be writable by that user.

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=100 hf-mirror
docker compose stop hf-mirror
docker compose start hf-mirror
```

The entrypoint configures certificates, persists generated secrets, initializes
environment settings when present, runs startup recovery, then starts the Bun
runtime. Database initialization applies Drizzle migrations. Read startup logs
after every upgrade.

`GET /api/health` reports database and recovery state. The Docker healthcheck
runs every 30 seconds with a five-second timeout and three retries. Its URL
respects `BASE_URL`. Inspect JSON as well as HTTP status: the handler can report
`degraded` or `error` in a successful response.

## Pass optional environment variables

Compose's host `.env` is an interpolation source, not automatic container
environment injection. For variables absent from your deployed Compose file,
add an explicit override. For example, `compose.settings.yml`:

```yaml
services:
  hf-mirror:
    environment:
      MIRROR_METADATA: ${MIRROR_METADATA:-true}
      MIRROR_ISSUES: ${MIRROR_ISSUES:-true}
      MIRROR_PULL_REQUESTS: ${MIRROR_PULL_REQUESTS:-true}
      SCHEDULE_ENABLED: ${SCHEDULE_ENABLED:-false}
      SCHEDULE_INTERVAL: ${SCHEDULE_INTERVAL:-}
      SCHEDULE_TIMEZONE: ${SCHEDULE_TIMEZONE:-UTC}
      AUTH_DEFAULT_METHOD: ${AUTH_DEFAULT_METHOD:-email}
      AUTH_ALLOW_SIGNUP: ${AUTH_ALLOW_SIGNUP:-false}
```

```sh
docker compose -f docker-compose.yml -f compose.settings.yml up -d
```

Use the same set of `-f` arguments for subsequent lifecycle commands. An override
is also how to supply header-auth settings, `DESTINATION_PROVIDER`,
`GITEA_EXTERNAL_URL`, or custom persistent paths. Inspect rendered configuration
privately with `docker compose config`; it contains resolved secrets.

## Reverse proxy and subpaths

Point your proxy to the container's port 5321 and set `BETTER_AUTH_URL` to the
external HTTPS address. Preserve host/protocol information and allow streaming
responses on `/api/events` and `/api/sse`; disable proxy buffering for these
paths and allow long-lived connections. Put HF Mirror and the forge on a shared
network or use a forge URL reachable from inside the container.

To restrict a host mapping to a local reverse proxy, an override can replace
the port list using Compose's `!override` tag:

```yaml
services:
  hf-mirror:
    ports: !override
      - "127.0.0.1:5321:5321"
```

Use a Compose version supporting that tag and confirm the rendered port list.
For proxies on a container network, use the service address and restrict host
exposure appropriately.

For `https://mirror.example.com/hf-mirror`, inject
`BASE_URL=/hf-mirror` and set the full `BETTER_AUTH_URL`. The production wrapper
strips that prefix before dispatching to Astro; forward the prefix intact from
the proxy. Use `bun run start` or the supplied container entrypoint. Paths
outside the prefix return 404. Verify login, assets, API calls, event streams,
and SSO redirects after a path change.

## Private certificate authorities

The entrypoint combines `/app/certs/*.crt` into `/app/certs/ca-bundle.crt` and sets
`NODE_EXTRA_CA_CERTS`. If you bind-mount that directory, it must be writable by
UID 1001 because the bundle is created there. For a read-only CA file, mount a
prepared bundle elsewhere and explicitly set `NODE_EXTRA_CA_CERTS` to it.

Git/Git LFS certificate trust must also work; if necessary supply the same bundle
through Git's `GIT_SSL_CAINFO` environment setting. Test the actual API and Git
connections from the running container. Prefer installing the correct trust
chain over `GITEA_SKIP_TLS_VERIFY=true`, which sets
`NODE_TLS_REJECT_UNAUTHORIZED=0` for the entire application runtime.

## Upgrade and roll back

1. Stop or finish active work and take a consistent [backup](./backup-restore.md).
2. Download current deployment files, review changed environment mappings, and set
   `HF_MIRROR_VERSION` to the desired release tag.
3. Run `docker compose pull`, then `docker compose up -d` with your overrides.
4. Check logs, health JSON, login, configuration, and a small sync.

Stable releases update `latest`; prereleases have their own tags and do not
move `latest`. Release downloads pin the version even when used without `.env`.
After schema migrations, an older image may need its matching pre-upgrade
database backup. Preserve a copy before attempting rollback.

When upgrading from v0.2.1 or earlier, use the updated Compose file. The default
host and container port is 5321. Update `.env`'s `PORT`, direct-access
`BETTER_AUTH_URL`, proxy upstream ports, and IdP redirect URLs if needed.

## Release publishing

Publishing a GitHub release triggers
[publish-container.yml](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/.github/workflows/publish-container.yml). It checks out
the release tag, builds amd64/arm64 images, and publishes
`ghcr.io/willtheorangeguy/hf-mirror:TAG` using `GITHUB_TOKEN`. It then attaches
the pinned Compose file, `env.example`, and README to the release. The workflow
requires content-write and package-write permissions for that job.

After the first publication, make the GHCR package public to permit anonymous
pulls. Subsequent releases retain its visibility. A failed workflow can leave a
release without deployment assets; inspect the job before assuming a download
or image exists. Keep the [source license and NOTICE](./attribution.md) with distributions.
