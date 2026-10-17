# HF Mirror — Configuration

Start from [`.env.example`](../.env.example), then configure sources, destination,
mirror options, automation, and notifications in the UI. The database stores
settings per user. Source connections also have dedicated rows in `sources`.
The validated settings are defined in [schema.ts](../src/lib/db/schema.ts);
the UI shape is defined in [config.ts](../src/types/config.ts).

## Environment and stored settings

Bun reads `.env` for source runs. Docker Compose uses `.env` for interpolation;
it only sends variables listed under the service's `environment` or `env_file`
to the container. Merely adding a variable to the host `.env` is insufficient.
Use a Compose override for additional settings, as shown in
[deployment](./deployment.md).

The environment loader runs when connection variables are present: any of
`HF_USERNAME`, `HF_TOKEN`, `GITEA_URL`, `GITEA_USERNAME`, or `GITEA_TOKEN`.
It targets the first-created account and updates its active configuration and
primary source after an account exists. Additional connections are managed
through the UI/API. `bun run startup-env-config` runs the same initialization
manually and can write configuration; it is not just a validation command.

Environment configuration is reapplied on startup. Several booleans have explicit
defaults even when unset, so an environment-managed installation can replace UI
preferences after restart. Either manage those preferences consistently through
environment variables or leave connection credentials in the UI and omit them
from the environment. Review saved scheduling and cleanup settings after restart.
Imported sources and mirrored destinations are protected by host-change locks.

## Runtime variables

| Variable | Default / purpose |
| --- | --- |
| `HF_MIRROR_VERSION` | `latest` in repository Compose; release assets pin a tag; interpolation only |
| `BETTER_AUTH_SECRET` | Set a random stable secret; Compose requires a nonempty value |
| `BETTER_AUTH_URL` | Public URL, including an optional path prefix; example uses `http://localhost:5321` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Additional comma-separated trusted origins; Compose sets the public URL |
| `BETTER_AUTH_LOG_LEVEL` | Auth logger level; see the parser in `src/lib/auth.ts` |
| `PORT` | `5321`; in Compose the host mapping is configurable, container port stays 5321 |
| `HOST` | Production runtime defaults to `0.0.0.0` |
| `BASE_URL` | `/`; production path prefix, such as `/hf-mirror` |
| `DATABASE_URL` | `data/hf-mirror.db`; accepts `file:`, `sqlite://`, or a plain path |
| `ENCRYPTION_SECRET` | Secret for stored credentials; generated and persisted by the container entrypoint when absent |
| `JWT_SECRET` | Legacy encryption fallback when `ENCRYPTION_SECRET` is absent |
| `MIRROR_CLONE_DIR` | Defaults to `mirrors/` beside the SQLite database; include custom locations in backups |
| `PUSH_CONCURRENCY` | `2`; positive integer, capped at 32, controls process-wide Git transfer concurrency |
| `NODE_ENV` | `production` in the container; tests set `test` |
| `NODE_EXTRA_CA_CERTS` | Optional extra CA bundle; container entrypoint can construct one from `/app/certs/*.crt` |
| `GITEA_SKIP_TLS_VERIFY` | Container entrypoint compatibility switch; `true` disables TLS verification globally for that runtime |

Encryption uses `ENCRYPTION_SECRET`, then `JWT_SECRET`, then
`BETTER_AUTH_SECRET`. Preserve the exact secret used for existing credentials.
Changing it does not re-encrypt existing values. The container's hidden files
are `.encryption_secret` and, when generated, `.better_auth_secret` in `data/`.
`PUBLIC_BETTER_AUTH_URL` is passed by Compose, but the server's primary public
URL setting is `BETTER_AUTH_URL`.

## Source and destination variables

Defaults here describe the environment loader; fresh UI defaults can differ.
Booleans recognize the literal lowercase values `true` and `false`.

| Variable | Behavior |
| --- | --- |
| `HF_USERNAME`, `HF_TOKEN` | Primary HF account name and read token |
| `SOURCE_URL` | HF base URL; normally `https://huggingface.co` |
| `HF_TYPE` | `personal` or `organization` |
| `PRIVATE_REPOSITORIES`, `PUBLIC_REPOSITORIES` | Included unless `false` |
| `INCLUDE_COLLABORATOR_REPOS` | Optional boolean source preference |
| `INCLUDE_ORGANIZATIONS` | Comma-separated organization names |
| `MIRROR_STARRED` | `true` includes likes; `starred` is the inherited internal name |
| `MIRROR_STARRED_LISTS` | Legacy named-list preference; HF collection discovery uses `sourceConfig.collections` |
| `STARRED_REPOS_ORG` | Destination organization for likes |
| `STARRED_REPOS_MODE` | `dedicated-org` or `preserve-owner` |
| `STARRED_DUPLICATE_STRATEGY` | `suffix`, `prefix`, or `owner-org`; retained preference |
| `MIRROR_STRATEGY` | `preserve`, `single-org`, `flat-user`, or `mixed` |
| `SKIP_FORKS`, `INCLUDE_ARCHIVED` | Inherited discovery flags; HF mapping does not report GitHub-style forks |
| `MIRROR_ORGANIZATIONS`, `PRESERVE_ORG_STRUCTURE`, `ONLY_MIRROR_ORGS` | Legacy organization/strategy inputs; use saved source settings to inspect the effective policy |
| `SKIP_STARRED_ISSUES`, `AUTO_MIRROR_STARRED` | Liked-repository mirroring preferences |
| `DESTINATION_PROVIDER` | `gitea` or `forgejo`; Gitea is default |
| `GITEA_URL`, `GITEA_USERNAME`, `GITEA_TOKEN` | Destination API URL, account, and write token |
| `GITEA_EXTERNAL_URL` | Optional browser-facing forge URL |
| `GITEA_ORGANIZATION` | Organization used by applicable destination strategies |
| `GITEA_ORG_VISIBILITY` | `public`, `private`, `limited`, or `default`; organization visibility |
| `GITEA_LFS` | Enabled unless `false`; disabling excludes large-file objects |
| `GITEA_CREATE_ORG`, `GITEA_ADD_TOPICS` | Environment parser enables these only for `true` |
| `GITEA_PRESERVE_VISIBILITY` | Enabled unless `false`; private and gated sources still require private destinations |
| `GITEA_TEMPLATE_OWNER`, `GITEA_TEMPLATE_REPO`, `GITEA_TOPIC_PREFIX`, `GITEA_FORK_STRATEGY` | Inherited settings; do not imply HF support beyond [limitations](./roadmap.md) |

Only `huggingface` is accepted as a source provider. GitHub, GitLab, and
Gitea-as-source instructions from upstream do not apply here. Configure repository
types and collection slugs in source settings; there are no corresponding
`HF_REPO_TYPES` or `HF_COLLECTIONS` variables in the loader.

## Mirror content and history protection

| Variable | Environment-loader behavior |
| --- | --- |
| `MIRROR_METADATA` | Enabled unless `false`; controls topic metadata handling |
| `MIRROR_ISSUES` | Enabled unless `false`; archive HF discussions and copy them as issues |
| `MIRROR_PULL_REQUESTS` | Enabled unless `false`; archive HF PR conversations and copy them as issues |
| `MIRROR_WIKI`, `MIRROR_RELEASES`, `MIRROR_LABELS`, `MIRROR_MILESTONES` | Retained inherited inputs; not separate HF export implementations |
| `RELEASE_LIMIT`, `RELEASE_ASSET_LIMIT` | Retained release settings; HF is not release-capable in the provider registry |
| `MIRROR_ISSUE_CONCURRENCY`, `MIRROR_PULL_REQUEST_CONCURRENCY` | Retained metadata concurrency preferences; Git concurrency uses `PUSH_CONCURRENCY` |

Fresh UI-created configurations enable LFS, metadata, discussions, and PR backup.
The metadata step still obtains and writes a repository JSON archive even when
individual copy options are disabled. Read the transfer's selected-content status
and manifest rather than assuming every inherited switch describes a distinct export.

The UI stores these history settings in `giteaConfig`:

| Field | Default / meaning |
| --- | --- |
| `backupStrategy` | `on-force-push`; also `disabled`, `always`, `block-on-force-push` |
| `backupRetentionCount` | `5` bundles per source identity |
| `backupRetentionDays` | `30`; `0` disables age expiration; newest bundle is retained |
| `backupDirectory` | Normally `data/repo-backups`; custom paths need persistent mounts |
| `blockSyncOnBackupFailure` | `true`; stop if the safety snapshot fails |
| `hfReposOrg` | Optional default organization for all HF types and likes |

These history settings have no dedicated environment inputs in the loader.
Use the UI, including repository/organization mirror overrides where available.
See [usage](./usage.md) for placement precedence and
[backup and restore](./backup-restore.md) for snapshot contents.

## Scheduling and activity cleanup

| Variable | Meaning / units |
| --- | --- |
| `SCHEDULE_ENABLED` | `true` enables scheduling |
| `SCHEDULE_INTERVAL` | Duration (`8h`, `3600` seconds) or supported five-field cron expression |
| `DELAY` | Legacy fallback interval; either interval variable enables scheduling even if `SCHEDULE_ENABLED=false` |
| `SCHEDULE_TIMEZONE` | IANA timezone, e.g. `UTC` or `America/Edmonton` |
| `SCHEDULE_CONCURRENT` | Schedule concurrency preference |
| `SCHEDULE_BATCH_SIZE` | Repositories per batch |
| `SCHEDULE_PAUSE_BETWEEN_BATCHES` | Milliseconds |
| `SCHEDULE_RETRY_ATTEMPTS` | Retry count |
| `SCHEDULE_RETRY_DELAY`, `SCHEDULE_TIMEOUT` | Milliseconds |
| `SCHEDULE_AUTO_RETRY`, `SCHEDULE_CLEANUP_BEFORE_MIRROR` | Boolean automation preferences |
| `SCHEDULE_NOTIFY_ON_FAILURE`, `SCHEDULE_NOTIFY_ON_SUCCESS` | Schedule notification preferences |
| `SCHEDULE_LOG_LEVEL` | `error`, `warn`, `info`, or `debug` |
| `SCHEDULE_ONLY_MIRROR_UPDATED` | Prefer changed repositories |
| `SCHEDULE_UPDATE_INTERVAL` | Milliseconds |
| `SCHEDULE_SKIP_RECENTLY_MIRRORED`, `SCHEDULE_RECENT_THRESHOLD` | Skip recent work; threshold in milliseconds |
| `AUTO_IMPORT_REPOS` | Enabled unless `false` |
| `AUTO_MIRROR_REPOS` | Enabled only for `true` |
| `CLEANUP_ENABLED` | Environment loader enables activity cleanup only for `true` |
| `CLEANUP_RETENTION_DAYS` | Integer days at the environment boundary; stored as seconds |

Scheduling is opt-in. The fresh UI default interval is daily at 22:00 in the
configured timezone, with scheduling disabled. Clock-mode UI settings are saved
as an expression and timezone. Environment initialization and schema fallbacks
have different defaults, so inspect the actual saved configuration and next run.
Activity cleanup is distinct from destination reconciliation and content backups.

Authentication variables are documented in [authentication](./authentication.md).
Notification configuration is stored through the UI/API; see
[notifications](./notifications.md). For exact environment mapping, consult
[env-config-loader.ts](../src/lib/env-config-loader.ts) and
[config-defaults.ts](../src/lib/utils/config-defaults.ts).
