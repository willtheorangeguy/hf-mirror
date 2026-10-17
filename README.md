# HF Mirror

Mirror Hugging Face repositories to Gitea with a web interface.

## Deploy with Docker Compose

Download `docker-compose.yml` and `env.example` from the
[latest release](https://github.com/willtheorangeguy/hf-mirror/releases/latest)
into a directory on your server. Release downloads become available after the
container publishing workflow succeeds. Images support Linux amd64 and arm64.

```sh
cp env.example .env
mkdir -p data
sudo chown -R 1001:1001 data
openssl rand -hex 32
```

Edit `.env`: set `BETTER_AUTH_SECRET` to the generated value and
`BETTER_AUTH_URL` to the address you will use to access the app, such as
`https://mirror.example.com` or `http://192.168.1.10:4321`.
Set `PORT` if you want a host port other than 4321. Configure Hugging Face
and Gitea credentials in `.env` or through the web interface.

```sh
docker compose pull
docker compose up -d
docker compose logs -f
```

Open the configured address and create your account. The `data` directory holds
the database, mirror data, and generated encryption secret; preserve it across
upgrades and include it in backups. The container runs as UID/GID 1001, so this
directory must be writable by that user.

Release downloads pin `HF_MIRROR_VERSION` to that release. To upgrade, set it
to the desired release tag in `.env`, then run `docker compose pull` and
`docker compose up -d` again. The Compose file in the repository defaults to
`latest`, which tracks stable releases. Prereleases have their own version tag
and do not update `latest`.

## Build from source

```sh
bun run setup
bun run dev
```

To use a local container build with Compose, create `compose.local.yml`:

```yaml
services:
  hf-mirror:
    image: hf-mirror:local
    build: .
```

```sh
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
```

## Release publishing

Publishing a GitHub release triggers the
[container workflow](.github/workflows/publish-container.yml). It builds the
Dockerfile and publishes `ghcr.io/willtheorangeguy/hf-mirror:<release-tag>`
using the repository's `GITHUB_TOKEN`, then attaches deployment files to the
release. This follows GitHub's
[container publishing workflow](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

For the first publication, the GHCR package must be made public in its package
settings to allow servers to pull without authentication. Subsequent releases
retain that visibility.
