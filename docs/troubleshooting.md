# Troubleshooting

Start with `docker compose ps`, `docker compose logs --tail=100 hf-mirror`, the
repository's error/progress, and `/api/health` JSON. Include override files in
Compose commands when used. Health checks do not prove a content backup is complete.

## Startup and storage

| Symptom | Meaning and action |
| --- | --- |
| Compose asks for `BETTER_AUTH_SECRET` | Set a nonempty stable random value in the deployment's `.env` |
| Permission denied creating database or secret files | Make only the intended data directory writable by container UID/GID 1001 |
| Missing release assets or image tag | Inspect the release's publishing workflow; files attach after the multi-architecture build succeeds |
| Image pull denied | Check the GHCR package visibility or registry credentials and the requested tag |
| SQLite table/column error | Preserve a backup, inspect startup migrations and image version, and use migration validation before changing schema |
| `No encryption secret found` | Supply a stable encryption/auth secret; source runs do not execute container secret generation |
| Credential decryption fails after restore | Restore the original encryption secret/environment with the matching database |
| Disk full or incomplete large-file writes | Free space outside active data first; check local clone, archive, snapshot, and forge storage; retry after capacity is available |

Do not start recovery by deleting the database or regenerating encryption secrets.
Restore complete state as described in [backup and restore](./backup-restore.md).

## Login, proxy, and SSO

`SIGNUP_CLOSED` means an account already exists. Sign in, recover its password,
or intentionally enable additional local registrations with
`AUTH_ALLOW_SIGNUP=true`. Header provisioning and registered SSO are separate.

For login loops, invalid origins, or cookies that do not persist, compare the
browser URL with `BETTER_AUTH_URL`, trusted origins, proxy scheme/host, and
`BASE_URL`. A browser cannot use a container-only hostname. After a port or
public-path change, update OIDC/SAML redirects and clear obsolete cookies if needed.

For OIDC discovery failures, check issuer spelling, endpoints, IdP availability,
DNS, and certificate trust from the application container. The discovery parser
requires authorization/token endpoints and uses a ten-second timeout. Registered
IdP origins are trusted automatically, but unreachable endpoints still fail.

For header-auth redirects to `/login`, verify that the trusted proxy sends the
configured username header, that the user exists or provisioning is enabled,
and that the browser receives the bridged session cookie. Prevent direct client
access when trusting identity headers. See [authentication](./authentication.md).

## HF discovery and access

| Error or symptom | Action |
| --- | --- |
| `HF request failed (401)` | Verify token validity and account name; test the source connection |
| HF 403 or inaccessible gated files | Confirm the token owner has repository permission and accepted the gate |
| HF 404 | Check the URL, repository type, and permission; HF can hide private/inaccessible repositories with 404 |
| No personal discovery for a public-only source | Bulk discovery skips tokenless connections; manually import public repositories/organizations or add a token |
| Dataset/Space imported as a model | Use its full `datasets/` or `spaces/` URL or explicit `repoType` |
| `No connected source matches host` | Add/enable that source or select the matching connection |
| Organization discovery incomplete | Inspect the named organization's access and retry; do not treat a partial listing as complete |
| HF rate-limit reset exceeds ten minutes | Wait for the source limit to reset and retry later |

The provider retries bounded 429/5xx responses and reports long waits. Avoid
repeatedly cancelling and restarting a legitimate rate-limit wait.

## Destination and content failures

Verify the API URL from the container, `write:repository` and
`write:organization` permissions, membership in destination organizations, and
destination LFS support. `localhost` refers to the running container, not your host.

An archived destination must be unarchived before pushing. A provenance/identity
mismatch means the target does not match the tracked HF source; use a different
destination or reconcile the intended managed mirror. Do not remove protection
markers merely to force an overwrite.

`Incomplete LFS object`, `Corrupt LFS object`, or `Destination is missing LFS
object` means large-file verification failed. Check storage, network access,
source permissions, and the destination's LFS endpoint. Preserve the persistent
clone for retries. Turning LFS off changes the backup's scope and does not repair
missing large-file content.

`Destination ref verification failed; backup is incomplete` means the final refs
do not match. Inspect forge branch protection, server-side hooks, errors, and
concurrent writers, then retry after resolving the cause. A managed destination
should not receive independent writes while mirroring.

If Git completes but metadata fails, the job can still be `failed`. Read the
component status, inspect issue/comment/topic API access, and retry. Downloaded
metadata is archived before destination conversation updates, so it may remain
available even after a destination metadata failure.

## Stalled work and approvals

`pending-approval` is expected with block-on-force-push protection. Review the
listed destructive changes, then approve or dismiss the selected repositories.
See [usage](./usage.md).

For stale `mirroring`/`syncing` states after a crash, inspect recovery information
and startup logs. The container runs recovery before serving requests, and
middleware retries interrupted work with throttling. If a manual pass is needed,
stop the service first and run the recovery script from an offline maintenance
container or source checkout with the same data and secrets. Do not run an
orphan-reset pass against another process's active jobs.

An active cancellation retains downloaded objects and marks work ignored.
**Stop Pending Mirrors** only ignores queued work. Use retry/re-enable actions
as appropriate after checking the recorded status.

## Settings and live updates

If a host `.env` edit has no effect, verify the variable is forwarded into the
container and recreate the service. If a UI setting changes after restart,
review environment-loader defaults and manage that preference consistently.
See [configuration](./configuration.md) and [deployment](./deployment.md).

If live progress stops while logs advance, inspect proxy buffering/timeouts for
`/api/events` and `/api/sse`, browser connectivity, and session expiry. If schedules
run at unexpected times, compare the saved expression, IANA timezone, next run,
and environment settings; an interval variable itself enables scheduling.

When reporting a problem, include the image tag, installation method, public-path
shape, relevant sanitized logs, and affected workflow. Remove API keys, tokens,
passwords, cookie values, secret files, and sensitive repository data. Keep a
reproduction small and use disposable repositories.
