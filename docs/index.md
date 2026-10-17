# HF Mirror

HF Mirror backs up Hugging Face models, datasets, and Spaces to Gitea or
Forgejo. It gives operators a web interface for discovery, verified Git and
large-file transfers, schedules, and metadata archives. The codebase is based on
[gitea-mirror by RayLabsHQ](https://github.com/RayLabsHQ/gitea-mirror).

## Key features

- Discover repositories from HF accounts, organizations, likes, and collections.
- Transfer historical Git refs and large-file objects, with verification.
- Archive metadata and discussions, including HF PR conversations as forge issues.
- Protect destination history with snapshots or approval before destructive syncs.
- Schedule backups and track progress, failures, retries, and cancellation.
- Authenticate through local accounts, SSO, trusted proxies, or API keys.

## Quick start

Download the pinned Compose file and environment example from the
[latest release](https://github.com/willtheorangeguy/hf-mirror/releases/latest).
Set the auth secret and public URL, prepare writable persistent storage, then run:

```bash
docker compose pull
docker compose up -d
```

Follow [Getting started](getting-started.md) for the complete setup and first
verified repository backup. Keep the data directory and its encryption secret.

## Where to next

<div class="wt-grid" markdown>

[:material-rocket-launch: **Getting started**<br>Deploy and complete a first backup](getting-started.md){ .wt-card }

[:material-download: **Installation**<br>Published images and source builds](installation.md){ .wt-card }

[:material-tune: **Configuration**<br>Environment, credentials, and stored settings](configuration.md){ .wt-card }

[:material-content-save-check: **Backup and restore**<br>Preserve state and recover history](backup-restore.md){ .wt-card }

[:material-sitemap: **Architecture**<br>Understand the transfer pipeline](architecture.md){ .wt-card }

[:material-api: **API**<br>Automate discovery and mirroring](api.md){ .wt-card }

</div>

For day-to-day work, read [Usage](usage.md), [Deployment](deployment.md), and
[Troubleshooting](troubleshooting.md). Contributors can start with
[Development](development.md), [Testing](testing.md), and [Documentation](documentation.md).
The [FAQ](faq.md) explains archive scope, privacy, storage, and upstream differences.

## Support

Open a [GitHub Discussion](https://github.com/willtheorangeguy/hf-mirror/discussions)
or file an [issue](https://github.com/willtheorangeguy/hf-mirror/issues/new/choose).
Read [Attribution](attribution.md) and [License](license.md) for upstream credit
and the retained GNU AGPLv3 terms.
