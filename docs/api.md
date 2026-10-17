# HF Mirror — API

Astro serves application routes under `/api`. Prepend the deployed `BASE_URL`
when present. This is the application's own API, not the HF Hub API or the forge
API. There is no generated OpenAPI specification or versioned `/v1` prefix.
The source of truth is [src/pages/api](../src/pages/api/).

## Authentication and responses

Use a signed-in session cookie or an HF Mirror API key in `x-api-key`. Resource
handlers scope records to the authenticated user; a client-provided `userId`
does not authorize access. Create keys through the UI after signing in. Keys
cannot manage other keys. See [authentication](./authentication.md).

Send `Content-Type: application/json` for JSON bodies. Responses vary by route;
there is no universal envelope. Inspect the HTTP status and the returned
`success`, `error`, or `message` fields. Common failures include 400 for invalid
input/configuration, 401 for authentication, 404 for unavailable owned records,
409 for conflicts or confirmation requirements, and 500 for server failures.
Job acceptance is not evidence that a transfer completed: poll repository state
or consume the event streams.

## Minimal automation

Set `HF_MIRROR_API_KEY` privately in your shell. These examples use a POSIX shell
and assume the source and destination are already configured:

```sh
curl -H "x-api-key: $HF_MIRROR_API_KEY" http://localhost:5321/api/source/repositories

curl -X POST http://localhost:5321/api/sync/repository \
  -H "x-api-key: $HF_MIRROR_API_KEY" -H 'Content-Type: application/json' \
  -d '{"owner":"OWNER","repo":"NAME","repoType":"model"}'

curl -X POST http://localhost:5321/api/job/mirror-repo \
  -H "x-api-key: $HF_MIRROR_API_KEY" -H 'Content-Type: application/json' \
  -d '{"repositoryIds":["REPOSITORY_ID"]}'
```

Replace `REPOSITORY_ID` with an ID returned by discovery/listing. Use
`repoType: "dataset"` or `"space"` for those repositories. An optional `sourceId`
selects a connection; `host` and `path` can preserve a pasted HF URL's identity.
The manual-import request requires `owner` and `repo`, even when passing `path`.

## Discovery, configuration, and sources

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/config` | Current configuration, source list, and lock state; UI-facing shape |
| POST | `/api/config` | Save UI-facing configuration and any required host-change confirmations |
| GET | `/api/sources` | Named connections and lock/count information |
| POST | `/api/sources` | Create `{provider:"huggingface",name?,url?,username?,token?,enabled?}` |
| PUT | `/api/sources/:id` | Update a connection; locked host changes require confirmation |
| DELETE | `/api/sources/:id` | Remove connection; `confirmRemoveSource` query confirmation when required |
| POST | `/api/source/test-connection` | Test `{provider?,url?,username?,token?}` against HF |
| POST | `/api/gitea/test-connection` | Test `{url,token,username,provider?}`; provider Gitea or Forgejo |
| GET | `/api/source/repositories` | Imported database rows, not a new remote discovery pass |
| GET | `/api/source/organizations` | Organization discovery/listing for connected sources |
| GET | `/api/source/collections` | HF collections; optional `sourceId` query selection |
| POST | `/api/sync` | Bulk discovery/import from enabled token-bearing connections |
| POST | `/api/sync/repository` | Manual import `{owner,repo,repoType?,sourceId?,host?,path?,force?,destinationOrg?}` |
| POST | `/api/sync/organization` | Manual organization import; `org`, `role`, optional source selection and `force` |
| GET | `/api/dashboard` | Dashboard statistics, repositories, organizations, and activities |

Configuration uses nested `sourceConfig`, `giteaConfig`, `scheduleConfig`,
`cleanupConfig`, `notificationConfig`, and mirror options. UI fields such as
source `username` and destination `username` map to database `owner` and
`defaultOwner`; do not send a raw database row as a save request. Consult
[config types](../src/types/config.ts) and the
[configuration handler](../src/pages/api/config/index.ts) for full payloads.
Use the UI confirmation flow for identity changes rather than guessing flags.

## Mirror jobs

| Method | Path | Body / behavior |
| --- | --- | --- |
| POST | `/api/job/mirror-repo` | `{repositoryIds:[...]}`; start initial mirrors |
| POST | `/api/job/sync-repo` | `{repositoryIds:[...]}`; sync existing mirrors |
| POST | `/api/job/retry-repo` | `{repositoryIds:[...]}`; retry failed work |
| POST | `/api/job/reset-metadata` | `{repositoryIds:[...]}`; reset metadata tracking for reprocessing |
| POST | `/api/job/mirror-org` | `{organizationIds:[...]}`; mirror organization repositories |
| POST | `/api/job/sync-org` | `{orgId:"..."}`; sync one organization |
| POST | `/api/job/schedule-sync-repo` | Run the configured scheduling operation across eligible repositories; no per-ID selection |
| POST | `/api/job/approve-sync` | `{repositoryIds:[...],action:"approve"}` or `"dismiss"`; pending approvals only |
| POST | `/api/job/cancel-repo` | `{repositoryId:"..."}`; request cancellation of an active owned mirror |
| POST | `/api/job/cancel-pending` | Ignore this user's queued imported/failed repositories; does not abort active work |

## Repository and organization records

| Method | Path | Behavior |
| --- | --- | --- |
| PATCH | `/api/repositories/:id` | Set optional `destinationOrg`, `mirrorOverrides`; updates settings without moving a mirror |
| PATCH | `/api/repositories/:id/status` | Set `{status:"..."}` within allowed transitions |
| POST | `/api/repositories/:id/move-mirror` | Transfer mirror ownership; `{destinationOrg:"..."}` or null to clear override |
| GET | `/api/repositories/:id/archive` | Download `{transfer,metadata}` JSON; 404 before archive files exist |
| GET | `/api/repositories/export` | Download repository inventory CSV |
| DELETE | `/api/repositories` | `{ids:[...]}`; delete owned tracking rows/jobs and clean local clones; no remote repository deletion in this route |
| PATCH | `/api/organizations/:id` | Optional destination, source pin, and mirror overrides |
| DELETE | `/api/organizations/:id` | Remove organization tracking according to the handler's cleanup behavior |
| PATCH | `/api/organizations/:id/status` | Set organization state with `{status:"..."}` |
| POST | `/api/organizations/:id/move-mirrors` | `{destinationOrg?,dryRun?}`; defaults to preview; inspect partial failures on apply |
| GET | `/api/organizations/export` | Download organization inventory CSV |
| GET | `/api/organizations/mirror-overrides` | Resolve inherited overrides by `name` query parameter |

An archive download contains JSON, not Git objects or LFS files. CSV exports
are inventories. Neither replaces [backups](./backup-restore.md).

## Activity, cleanup, and reconciliation

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/activities` | User activity/job history |
| POST | `/api/activities/cleanup` | Delete this user's activity/job history, including marking active job records interrupted |
| POST | `/api/cleanup/auto` | Invoke configured retention cleanup across eligible users; authenticated maintenance action |
| GET | `/api/cleanup/auto` | Returns 405 and asks callers to use POST |
| POST | `/api/cleanup/reconcile` | `{dryRun?,adoptUntracked?,resetMissing?,relocateMoved?}`; preview defaults to true |
| GET | `/api/events` | Server-sent rate-limit events scoped to the user |
| GET | `/api/sse` | Server-sent mirror-status events scoped to the user |
| POST | `/api/notifications/test` | `{notificationConfig:{...}}`; test selected provider |

Treat cleanup as maintenance, not as an active transfer cancellation mechanism.
Reconciliation relies on HF Mirror provenance markers; it reports unverified
destinations instead of treating arbitrary repositories as managed mirrors.

## Authentication and SSO routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Public database/recovery/version JSON |
| GET | `/api/auth/methods` | Public available sign-in methods and default tab |
| GET | `/api/auth/header-status` | Public header-auth status |
| GET | `/api/sso/providers/public` | Public login-provider information |
| ALL | `/api/auth/*` | Better Auth handler: login, logout, sessions, key management, callbacks, OAuth endpoints |
| GET, POST | `/api/auth/sso/register` | Authenticated SSO provider listing/registration |
| GET | `/api/auth/sso/sp-metadata` | SAML metadata for `providerId`; optional `format` |
| GET, POST | `/api/auth/oauth2/register` | Authenticated OAuth application listing/registration |
| GET, POST, PUT, DELETE | `/api/sso/providers` | Provider management; updates/deletion use `id` query selection |
| POST | `/api/sso/discover` | OIDC discovery for `{issuer:"..."}` |
| GET, POST, PUT, DELETE | `/api/sso/applications` | OAuth application management; updates/deletion use `id` |

The health response includes `status`, `version`, `latestVersion`,
`database.connected`, and recovery information. The JSON status can be `error`
or `degraded` even when HTTP is 200; uncaught health failures return 503.
Health does not verify every mirrored file or credential.

## External APIs and transports

The HF adapter uses `/api/whoami-v2`, model/dataset/Space listings and details,
organizations, likes, collections, and discussions. It enforces source-origin
pagination and retries bounded 429/5xx failures. A 404 can mean a private or
gated repository is inaccessible; it is not proof of deletion.

The destination adapter uses the Gitea-compatible `/api/v1` repository,
organization, issue, comment, topic, and transfer endpoints. Git and Git LFS
transfer objects separately over their transports. Notification providers add
their own HTTP endpoints. Refer to [architecture](./architecture.md) and
[notifications](./notifications.md) for those flows.
