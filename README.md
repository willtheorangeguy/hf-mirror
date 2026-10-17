<!-- Logo -->
<h1 align="center">HF Mirror</h1>

<!-- Tagline -->
<h4 align="center">Back up Hugging Face models, datasets, and Spaces to Gitea or Forgejo through a web interface.</h4>

<!-- Badges -->
<p align="center">
  <a href="https://github.com/willtheorangeguy/hf-mirror/issues"><img alt="Issues" src="https://img.shields.io/github/issues/willtheorangeguy/hf-mirror"></a>
  <a href="https://github.com/willtheorangeguy/hf-mirror/pulls"><img alt="Pull requests" src="https://img.shields.io/github/issues-pr/willtheorangeguy/hf-mirror"></a>
  <a href="LICENSE"><img alt="License: AGPLv3" src="https://img.shields.io/badge/license-AGPLv3-blue"></a>
  <a href="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/astro-build-test.yml"><img alt="Build and regression tests" src="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/astro-build-test.yml/badge.svg"></a>
  <a href="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/e2e-tests.yml"><img alt="Container E2E" src="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/e2e-tests.yml/badge.svg"></a>
  <a href="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/publish-container.yml"><img alt="Publish container" src="https://github.com/willtheorangeguy/hf-mirror/actions/workflows/publish-container.yml/badge.svg"></a>
  <a href="https://github.com/willtheorangeguy/hf-mirror/releases"><img alt="Release" src="https://img.shields.io/github/v/release/willtheorangeguy/hf-mirror"></a>
</p>

<!-- Nav -->
<p align="center">
  <a href="#key-features">Key Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#support">Support</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a> •
  <a href="#attribution">Attribution</a>
</p>

HF Mirror keeps local Git clones, transfers historical large files, and pushes
verified backups to your own forge. It is based on
[RayLabsHQ's gitea-mirror](https://github.com/RayLabsHQ/gitea-mirror), adapted for
Hugging Face repositories. Gitea is the default destination; Forgejo is beta.

## Key Features

- Discover models, datasets, and Spaces from accounts, organizations, likes, and collections.
- Transfer branches, tags, HF pull request refs, and historical LFS/Xet-backed files.
- Verify local large-file hashes, destination LFS availability, and Git refs.
- Archive metadata and discussions; represent HF pull requests as destination issues.
- Protect destination history with safety snapshots or approval before destructive updates.
- Schedule discovery and mirroring, track live progress, retry failures, and cancel transfers.
- Sign in with email/password, OIDC/SAML SSO, or trusted proxy headers; automate with API keys.
- Deploy Linux amd64/arm64 containers with persistent SQLite, clones, and metadata archives.

## Installation

Download `docker-compose.yml` and `env.example` from the
[latest release](https://github.com/willtheorangeguy/hf-mirror/releases/latest).
On a Linux Docker host with Compose and OpenSSL:

```sh
cp env.example .env
mkdir -p data
sudo chown 1001:1001 data
openssl rand -hex 32
```

Set `BETTER_AUTH_SECRET` in `.env` to the generated value and set
`BETTER_AUTH_URL` to your public address, such as `http://localhost:5321`.

```sh
docker compose pull
docker compose up -d
```

The container runs as UID/GID 1001. Preserve `data/`, including its hidden
encryption secret. See [installation](docs/installation.md) for source builds.

## Usage

Open your configured address, create the first account, and configure a Hugging
Face source plus your Gitea destination. Test both connections, add a small
repository by URL, and select **Mirror**. A successful transfer reaches
`mirrored`; check its large-file status before treating it as a complete backup.
See the [quickstart](docs/getting-started.md) for a full first-run walkthrough.

## Documentation

Full documentation lives in [`docs/`](docs/index.md):
[Installation](docs/installation.md) · [Usage](docs/usage.md) · [Configuration](docs/configuration.md) · [Troubleshooting](docs/troubleshooting.md)

Operations: [Deployment](docs/deployment.md) · [Backup and restore](docs/backup-restore.md) · [Authentication](docs/authentication.md) · [API](docs/api.md).

## Support

Open a [GitHub Discussion](https://github.com/willtheorangeguy/hf-mirror/discussions/new) or file an [issue](https://github.com/willtheorangeguy/hf-mirror/issues/new/choose).

## Contributing

Contributions welcome. See the org-wide [Contributing Guide](https://github.com/willtheorangeguy/.github/blob/main/CONTRIBUTING.md) and [Code of Conduct](https://github.com/willtheorangeguy/.github/blob/main/CODE_OF_CONDUCT.md).
Read the [development guide](docs/development.md) for local setup and validation.

## License

GNU AGPL version 3 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
The existing upstream license and attribution are retained.

## Attribution

This codebase is based on **[gitea-mirror by RayLabsHQ](https://github.com/RayLabsHQ/gitea-mirror)**,
distributed under GNU AGPLv3. HF Mirror builds on its application foundation
with Hugging Face discovery, verified large-file transfers, and metadata archives.
Upstream instructions describe a different feature set; use this repository's docs for HF Mirror.
