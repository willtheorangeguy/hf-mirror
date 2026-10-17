# Getting started

This path uses a published container on a Linux Docker host. You need Docker
with Compose, OpenSSL, an existing Gitea instance with LFS enabled, and credentials
for your repositories. Other paths are in [installation](./installation.md).

## Prerequisites

Check your tools before starting:

```bash
docker --version
docker compose version
openssl version
```

The published images support Linux amd64 and arm64. Your Gitea account needs
repository and organization write access. The HF account must already have
permission to any private or gated content.

## Install

1. Download `docker-compose.yml` and `env.example` from a
   [release](https://github.com/willtheorangeguy/hf-mirror/releases/latest) into an empty directory.
   These assets appear after the publishing workflow succeeds.
2. Prepare the configuration and writable storage:

   ```sh
   cp env.example .env
   mkdir -p data
   sudo chown 1001:1001 data
   openssl rand -hex 32
   ```

3. Edit `.env`. Replace the placeholder `BETTER_AUTH_SECRET` with the generated
   value. Set `BETTER_AUTH_URL` to the browser-facing address, for example
   `http://192.168.1.10:5321` or `https://mirror.example.com`.
   Leave credentials blank to configure them in the UI.
4. Start the application:

   ```sh
   docker compose pull
   docker compose up -d
   docker compose logs -f hf-mirror
   ```

Open `BETTER_AUTH_URL` and create the first account promptly. Email/password
registration closes after an account exists unless explicitly enabled. A working
installation displays the dashboard. `/api/health` returns JSON containing the
database and recovery status.

## First run

1. Open **Configuration** and add a Hugging Face source. Use your HF account name
   and a token with read access to the repositories you need. A gated repository
   also requires that account to have accepted the gate and received access.
2. Configure the Gitea URL, account name, and token. The application needs
   `write:repository` and `write:organization` permissions and access to the
   selected destination owner. Test both connections.
3. Keep large-file, metadata, discussion, and pull request backup enabled for a
   full first test. Use a small repository whose contents you can inspect.
4. Open **Repositories**, add its Hugging Face URL, then select **Mirror**.
   Accepted URL shapes include `https://huggingface.co/OWNER/MODEL`,
   `https://huggingface.co/datasets/OWNER/DATASET`, and
   `https://huggingface.co/spaces/OWNER/SPACE`.
5. Watch activity and repository progress. The status should progress
   from `imported` through `mirroring` to `mirrored`.

## What just happened

Discovery created a tracked repository row. The mirror job fetched the source
into a persistent clone, transferred selected content, verified the destination,
and archived metadata.

Confirm that the destination contains the expected branches and tags, and that
large-file backup reports completion. Selected HF discussions and PRs appear as
issues; the JSON archive preserves source metadata. A Git-only backup excludes
large files.

## Next steps

Preserve `data/` and its hidden secret files across restarts. Before adding large
models or enabling a schedule, read [usage](./usage.md),
[configuration](./configuration.md), and [backup and restore](./backup-restore.md).
