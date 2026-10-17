# HF Mirror — Installation

Use [quickstart](./quickstart.md) for the shortest container path. This page
covers the installation mechanisms present in this repository.

## Requirements

| Installation | Requirements |
| --- | --- |
| Published container | Docker with Compose; Linux amd64 or arm64 image support; writable storage |
| Source | Bun >= 1.2.9, Git, Git LFS, and dependencies installed with Bun |
| Local image build | Docker BuildKit and network access for base images, dependencies, and Git LFS build tools |
| Mirroring | Access to HF API, Git and large-file hosts; Gitea/Forgejo API, Git and LFS endpoints |

CI and the Dockerfile use Bun 1.3.14; `package.json` records `bun@1.3.10` as its
package manager. Use the CI version when reproducing CI results. Node alone
cannot run the application because it uses `bun:sqlite` and Bun subprocess APIs.

Storage must accommodate historical objects, local clones, safety bundles, and
metadata archives, plus the destination's own storage. There is no fixed minimum
suitable for every model. See [backup and restore](./backup-restore.md).

## Published image with release assets

Download `docker-compose.yml` and `env.example` from the desired
[release](https://github.com/willtheorangeguy/hf-mirror/releases). Rename the latter
to `.env`, set the auth secret and public URL, prepare `data/` for UID/GID 1001,
then run `docker compose pull` and `docker compose up -d`.

Release assets pin the image to the release tag. The repository's Compose file
defaults to `latest`. Set `HF_MIRROR_VERSION` explicitly for reproducible deploys.
Container lifecycle and proxy setup are in [deployment](./deployment.md).

## Run from source

From a terminal with Bun, Git, and Git LFS available:

```sh
git clone https://github.com/willtheorangeguy/hf-mirror.git
cd hf-mirror
cp .env.example .env
git lfs install
```

On PowerShell, use `Copy-Item .env.example .env` for the copy step. Set a random
`BETTER_AUTH_SECRET` and the public `BETTER_AUTH_URL` in `.env` before first use.
For source runs, set a separate stable `ENCRYPTION_SECRET` if desired; otherwise
encryption falls back to the auth secret. Container secret-file generation
does not run in a source installation.

```sh
bun run setup
bun run dev
```

`setup` installs dependencies and initializes the database. The Astro dev server
uses port 5321. For a production build:

```sh
bun run build
bun run start
```

Keep `dist/`, runtime dependencies, `drizzle/`, the runtime server script, and
data paths available. `bun run preview` previews the build; use `bun run start`
for the production runtime and its base-path handling.

## Build an image locally

Use the repository's Compose file with an override named `compose.local.yml`:

```yaml
services:
  hf-mirror:
    image: hf-mirror:local
    build: .
```

Prepare `.env` and `data/` as for a published image, then run:

```sh
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
```

The Dockerfile builds Astro and operational scripts, installs production
dependencies, includes Git and Git LFS, and runs as an unprivileged user.
No Helm chart, native package, or additional production Compose variant is
included here. Upstream gitea-mirror files may assume different providers,
ports, and data layouts.

Next: [configuration](./configuration.md) and [usage](./usage.md).
