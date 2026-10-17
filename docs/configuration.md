# Configuration

Start from [`.env.example`](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/.env.example), then configure sources, destination,
mirror options, automation, and notifications in the UI. The database stores
settings per user. Source connections also have dedicated rows in `sources`.
The validated settings are defined in [schema.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/db/schema.ts);
the UI shape is defined in [config.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/types/config.ts).

## Precedence

For process settings, the runtime environment takes precedence over application
defaults. Compose's explicit `environment` mapping overrides container image
defaults. Its host `.env` only provides values for interpolation.

For stored settings, a UI/API save updates the database. On restart, an eligible
environment initialization takes precedence over existing database settings for
the fields it supplies or defaults. Other fields retain their saved values or
use schema defaults. Repository and organization overrides take precedence over
global mirror options. There is no general CLI flag layer for these settings.

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
manually and writes configuration.

Environment configuration is reapplied on startup. Several booleans have explicit
defaults even when unset, so an environment-managed installation can replace UI
preferences after restart. Either manage those preferences consistently through
environment variables or leave connection credentials in the UI and omit them
from the environment. Review saved scheduling and cleanup settings after restart.
Imported sources and mirrored destinations are protected by host-change locks.

In the tables, `unset` means the environment does not supply a value at that
boundary. Saved settings and schema defaults can still apply as described above.
Examples with angle-bracket placeholders require your own secret or token.

### Invalid values

Environment booleans use literal `true`/`false` comparisons. Numeric settings use
the loader's parsing and field-specific validation. Invalid or nonpositive
`PUSH_CONCURRENCY` falls back to 2 and valid values are capped at 32. Unknown auth
log levels warn and use the default threshold. UI/API saves validate supported
providers, URLs, enums, and settings. Inspect the save response and startup logs
instead of assuming an invalid value was accepted.

## Runtime variables

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `HF_MIRROR_VERSION` | string | `latest` | `latest` in repository Compose; release assets pin a tag; interpolation only Example: `HF_MIRROR_VERSION=latest`. |
| `BETTER_AUTH_SECRET` | string | `unset` | Set a random stable secret; Compose requires a nonempty value Example: `BETTER_AUTH_SECRET=<generated-secret>`. |
| `BETTER_AUTH_URL` | string | `http://localhost:5321 (fallback)` | Public URL, including an optional path prefix; example uses `http://localhost:5321` Example: `BETTER_AUTH_URL=http://localhost:5321`. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | string | `unset` | Additional comma-separated trusted origins; Compose sets the public URL Example: `BETTER_AUTH_TRUSTED_ORIGINS=https://mirror.example.com`. |
| `BETTER_AUTH_LOG_LEVEL` | string | `warn` | Auth logger level; see the parser in `src/lib/auth.ts` Example: `BETTER_AUTH_LOG_LEVEL=warn`. |
| `PORT` | integer string | `5321` | `5321`; in Compose the host mapping is configurable, container port stays 5321 Example: `PORT=5321`. |
| `HOST` | string | `0.0.0.0` | Production runtime defaults to `0.0.0.0` Example: `HOST=0.0.0.0`. |
| `BASE_URL` | string | `/` | `/`; production path prefix, such as `/hf-mirror` Example: `BASE_URL=/hf-mirror`. |
| `DATABASE_URL` | string | `data/hf-mirror.db` | `data/hf-mirror.db`; accepts `file:`, `sqlite://`, or a plain path Example: `DATABASE_URL=file:data/hf-mirror.db`. |
| `ENCRYPTION_SECRET` | string | `unset` | Secret for stored credentials; generated and persisted by the container entrypoint when absent Example: `ENCRYPTION_SECRET=<stable-encryption-secret>`. |
| `JWT_SECRET` | string | `unset` | Legacy encryption fallback when `ENCRYPTION_SECRET` is absent Example: `JWT_SECRET=<legacy-secret>`. |
| `MIRROR_CLONE_DIR` | string | `mirrors/ beside database` | Defaults to `mirrors/` beside the SQLite database; include custom locations in backups Example: `MIRROR_CLONE_DIR=data/mirrors`. |
| `PUSH_CONCURRENCY` | integer string | `2` | `2`; positive integer, capped at 32, controls process-wide Git transfer concurrency Example: `PUSH_CONCURRENCY=2`. |
| `NODE_ENV` | string | `production (image)` | `production` in the container; tests set `test` Example: `NODE_ENV=production`. |
| `NODE_EXTRA_CA_CERTS` | string | `unset` | Optional extra CA bundle; container entrypoint can construct one from `/app/certs/*.crt` Example: `NODE_EXTRA_CA_CERTS=/app/certs/ca-bundle.crt`. |
| `GITEA_SKIP_TLS_VERIFY` | string | `unset` | Container entrypoint compatibility switch; `true` disables TLS verification globally for that runtime Example: `GITEA_SKIP_TLS_VERIFY=false`. |

Encryption uses `ENCRYPTION_SECRET`, then `JWT_SECRET`, then
`BETTER_AUTH_SECRET`. Preserve the exact secret used for existing credentials.
Changing it does not re-encrypt existing values. The container's hidden files
are `.encryption_secret` and, when generated, `.better_auth_secret` in `data/`.
`PUBLIC_BETTER_AUTH_URL` is passed by Compose, but the server's primary public
URL setting is `BETTER_AUTH_URL`.

## Source and destination variables

Defaults here describe the environment loader; fresh UI defaults can differ.
Booleans recognize the literal lowercase values `true` and `false`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `HF_USERNAME`, `HF_TOKEN` | string | `unset` | Primary HF account name and read token Example: `HF_USERNAME=alice`, `HF_TOKEN=<hf-read-token>`. |
| `SOURCE_URL` | string | `unset` | HF base URL; normally `https://huggingface.co` Example: `SOURCE_URL=https://huggingface.co`. |
| `HF_TYPE` | string | `unset` | `personal` or `organization` Example: `HF_TYPE=personal`. |
| `PRIVATE_REPOSITORIES`, `PUBLIC_REPOSITORIES` | boolean string | `true` | Included unless `false` Example: `PRIVATE_REPOSITORIES=true`, `PUBLIC_REPOSITORIES=true`. |
| `INCLUDE_COLLABORATOR_REPOS` | boolean string | `unset` | Optional boolean source preference Example: `INCLUDE_COLLABORATOR_REPOS=true`. |
| `INCLUDE_ORGANIZATIONS` | string | `unset` | Comma-separated organization names Example: `INCLUDE_ORGANIZATIONS=raylabs`. |
| `MIRROR_STARRED` | boolean string | `false` | `true` includes likes; `starred` is the inherited internal name Example: `MIRROR_STARRED=true`. |
| `MIRROR_STARRED_LISTS` | string | `unset` | Legacy named-list preference; HF collection discovery uses `sourceConfig.collections` Example: `MIRROR_STARRED_LISTS=models`. |
| `STARRED_REPOS_ORG` | string | `unset` | Destination organization for likes Example: `STARRED_REPOS_ORG=liked`. |
| `STARRED_REPOS_MODE` | string | `unset` | `dedicated-org` or `preserve-owner` Example: `STARRED_REPOS_MODE=dedicated-org`. |
| `STARRED_DUPLICATE_STRATEGY` | string | `unset` | `suffix`, `prefix`, or `owner-org`; retained preference Example: `STARRED_DUPLICATE_STRATEGY=suffix`. |
| `MIRROR_STRATEGY` | string | `unset` | `preserve`, `single-org`, `flat-user`, or `mixed` Example: `MIRROR_STRATEGY=preserve`. |
| `SKIP_FORKS`, `INCLUDE_ARCHIVED` | boolean string | `false` | Inherited discovery flags; HF mapping does not report GitHub-style forks Example: `SKIP_FORKS=true`, `INCLUDE_ARCHIVED=true`. |
| `MIRROR_ORGANIZATIONS`, `PRESERVE_ORG_STRUCTURE`, `ONLY_MIRROR_ORGS` | boolean string | `false` | Legacy organization/strategy inputs; use saved source settings to inspect the effective policy Example: `MIRROR_ORGANIZATIONS=true`, `PRESERVE_ORG_STRUCTURE=true`, `ONLY_MIRROR_ORGS=true`. |
| `SKIP_STARRED_ISSUES`, `AUTO_MIRROR_STARRED` | boolean string | `false` | Liked-repository mirroring preferences Example: `SKIP_STARRED_ISSUES=true`, `AUTO_MIRROR_STARRED=true`. |
| `DESTINATION_PROVIDER` | string | `unset` | `gitea` or `forgejo`; Gitea is default Example: `DESTINATION_PROVIDER=gitea`. |
| `GITEA_URL`, `GITEA_USERNAME`, `GITEA_TOKEN` | string | `unset` | Destination API URL, account, and write token Example: `GITEA_URL=https://forge.example.com`, `GITEA_USERNAME=alice`, `GITEA_TOKEN=<forge-write-token>`. |
| `GITEA_EXTERNAL_URL` | string | `unset` | Optional browser-facing forge URL Example: `GITEA_EXTERNAL_URL=https://forge.example.com`. |
| `GITEA_ORGANIZATION` | string | `unset` | Organization used by applicable destination strategies Example: `GITEA_ORGANIZATION=hf-backups`. |
| `GITEA_ORG_VISIBILITY` | string | `unset` | `public`, `private`, `limited`, or `default`; organization visibility Example: `GITEA_ORG_VISIBILITY=private`. |
| `GITEA_LFS` | boolean string | `true` | Enabled unless `false`; disabling excludes large-file objects Example: `GITEA_LFS=true`. |
| `GITEA_CREATE_ORG`, `GITEA_ADD_TOPICS` | boolean string | `false` | Environment parser enables these only for `true` Example: `GITEA_CREATE_ORG=true`, `GITEA_ADD_TOPICS=true`. |
| `GITEA_PRESERVE_VISIBILITY` | boolean string | `true` | Enabled unless `false`; private and gated sources still require private destinations Example: `GITEA_PRESERVE_VISIBILITY=true`. |
| `GITEA_TEMPLATE_OWNER`, `GITEA_TEMPLATE_REPO`, `GITEA_TOPIC_PREFIX`, `GITEA_FORK_STRATEGY` | string | `unset` | Inherited settings; do not imply HF support beyond [limitations](./roadmap.md) Example: `GITEA_TEMPLATE_OWNER=alice`, `GITEA_TEMPLATE_REPO=template`, `GITEA_TOPIC_PREFIX=hf-`, `GITEA_FORK_STRATEGY=reference`. |

Only `huggingface` is accepted as a source provider. GitHub, GitLab, and
Gitea-as-source instructions from upstream do not apply here. Configure repository
types and collection slugs in source settings; there are no corresponding
`HF_REPO_TYPES` or `HF_COLLECTIONS` variables in the loader.

## Mirror content and history protection

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `MIRROR_METADATA` | boolean string | `true` | Enabled unless `false`; controls topic metadata handling Example: `MIRROR_METADATA=true`. |
| `MIRROR_ISSUES` | boolean string | `true` | Enabled unless `false`; archive HF discussions and copy them as issues Example: `MIRROR_ISSUES=true`. |
| `MIRROR_PULL_REQUESTS` | boolean string | `true` | Enabled unless `false`; archive HF PR conversations and copy them as issues Example: `MIRROR_PULL_REQUESTS=true`. |
| `MIRROR_WIKI`, `MIRROR_RELEASES`, `MIRROR_LABELS`, `MIRROR_MILESTONES` | boolean string | `false` | Retained inherited inputs; not separate HF export implementations Example: `MIRROR_WIKI=true`, `MIRROR_RELEASES=true`, `MIRROR_LABELS=true`, `MIRROR_MILESTONES=true`. |
| `RELEASE_LIMIT`, `RELEASE_ASSET_LIMIT` | integer string | `unset` | Retained release settings; HF is not release-capable in the provider registry Example: `RELEASE_LIMIT=10`, `RELEASE_ASSET_LIMIT=0`. |
| `MIRROR_ISSUE_CONCURRENCY`, `MIRROR_PULL_REQUEST_CONCURRENCY` | integer string | `unset` | Retained metadata concurrency preferences; Git concurrency uses `PUSH_CONCURRENCY` Example: `MIRROR_ISSUE_CONCURRENCY=3`, `MIRROR_PULL_REQUEST_CONCURRENCY=5`. |

Fresh UI-created configurations enable LFS, metadata, discussions, and PR backup.
The metadata step still obtains and writes a repository JSON archive even when
individual copy options are disabled. Read the transfer's selected-content status
and manifest rather than assuming every inherited switch describes a distinct export.

The UI stores these history settings in `giteaConfig`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `backupStrategy` | string | `on-force-push` | `on-force-push`; also `disabled`, `always`, `block-on-force-push` Example: `backupStrategy=on-force-push`. |
| `backupRetentionCount` | integer | `5` | `5` bundles per source identity Example: `backupRetentionCount=5`. |
| `backupRetentionDays` | integer | `30` | `30`; `0` disables age expiration; newest bundle is retained Example: `backupRetentionDays=30`. |
| `backupDirectory` | string | `data/repo-backups (normal data path)` | Normally `data/repo-backups`; custom paths need persistent mounts Example: `backupDirectory=data/repo-backups`. |
| `blockSyncOnBackupFailure` | boolean | `true` | `true`; stop if the safety snapshot fails Example: `blockSyncOnBackupFailure=true`. |
| `hfReposOrg` | string | `unset` | Optional default organization for all HF types and likes Example: `hfReposOrg=hf-backups`. |

These history settings have no dedicated environment inputs in the loader.
Use the UI, including repository/organization mirror overrides where available.
See [usage](./usage.md) for placement precedence and
[backup and restore](./backup-restore.md) for snapshot contents.

## Scheduling and activity cleanup

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `SCHEDULE_ENABLED` | boolean string | `false` | `true` enables scheduling Example: `SCHEDULE_ENABLED=true`. |
| `SCHEDULE_INTERVAL` | string | `unset` | Duration (`8h`, `3600` seconds) or supported five-field cron expression Example: `SCHEDULE_INTERVAL=8h`. |
| `DELAY` | string | `unset` | Legacy fallback interval; either interval variable enables scheduling even if `SCHEDULE_ENABLED=false` Example: `DELAY=8h`. |
| `SCHEDULE_TIMEZONE` | string | `unset` | IANA timezone, e.g. `UTC` or `America/Edmonton` Example: `SCHEDULE_TIMEZONE=America/Edmonton`. |
| `SCHEDULE_CONCURRENT` | boolean string | `false` | Schedule concurrency preference Example: `SCHEDULE_CONCURRENT=true`. |
| `SCHEDULE_BATCH_SIZE` | integer string | `unset` | Repositories per batch Example: `SCHEDULE_BATCH_SIZE=5`. |
| `SCHEDULE_PAUSE_BETWEEN_BATCHES` | integer string | `unset` | Milliseconds Example: `SCHEDULE_PAUSE_BETWEEN_BATCHES=5000`. |
| `SCHEDULE_RETRY_ATTEMPTS` | integer string | `unset` | Retry count Example: `SCHEDULE_RETRY_ATTEMPTS=3`. |
| `SCHEDULE_RETRY_DELAY`, `SCHEDULE_TIMEOUT` | integer string | `unset` | Milliseconds Example: `SCHEDULE_RETRY_DELAY=60000`, `SCHEDULE_TIMEOUT=3600000`. |
| `SCHEDULE_AUTO_RETRY`, `SCHEDULE_CLEANUP_BEFORE_MIRROR` | boolean string | `false` | Boolean automation preferences Example: `SCHEDULE_AUTO_RETRY=true`, `SCHEDULE_CLEANUP_BEFORE_MIRROR=true`. |
| `SCHEDULE_NOTIFY_ON_FAILURE`, `SCHEDULE_NOTIFY_ON_SUCCESS` | boolean string | `false` | Schedule notification preferences Example: `SCHEDULE_NOTIFY_ON_FAILURE=true`, `SCHEDULE_NOTIFY_ON_SUCCESS=true`. |
| `SCHEDULE_LOG_LEVEL` | string | `unset` | `error`, `warn`, `info`, or `debug` Example: `SCHEDULE_LOG_LEVEL=info`. |
| `SCHEDULE_ONLY_MIRROR_UPDATED` | boolean string | `false` | Prefer changed repositories Example: `SCHEDULE_ONLY_MIRROR_UPDATED=true`. |
| `SCHEDULE_UPDATE_INTERVAL` | integer string | `unset` | Milliseconds Example: `SCHEDULE_UPDATE_INTERVAL=86400000`. |
| `SCHEDULE_SKIP_RECENTLY_MIRRORED`, `SCHEDULE_RECENT_THRESHOLD` | boolean string, integer string | `false`, `unset` | Skip recent work; threshold in milliseconds Example: `SCHEDULE_SKIP_RECENTLY_MIRRORED=true`, `SCHEDULE_RECENT_THRESHOLD=3600000`. |
| `AUTO_IMPORT_REPOS` | boolean string | `true` | Enabled unless `false` Example: `AUTO_IMPORT_REPOS=true`. |
| `AUTO_MIRROR_REPOS` | boolean string | `false` | Enabled only for `true` Example: `AUTO_MIRROR_REPOS=true`. |
| `CLEANUP_ENABLED` | boolean string | `false` | Environment loader enables activity cleanup only for `true` Example: `CLEANUP_ENABLED=true`. |
| `CLEANUP_RETENTION_DAYS` | integer string | `unset` | Integer days at the environment boundary; stored as seconds Example: `CLEANUP_RETENTION_DAYS=7`. |

Scheduling is opt-in. The fresh UI default interval is daily at 22:00 in the
configured timezone, with scheduling disabled. Clock-mode UI settings are saved
as an expression and timezone. Environment initialization and schema fallbacks
have different defaults, so inspect the actual saved configuration and next run.
Activity cleanup is distinct from destination reconciliation and content backups.

Authentication variables are documented in [authentication](./authentication.md).
Notification configuration is stored through the UI/API; see
[notifications](./notifications.md). For exact environment mapping, consult
[env-config-loader.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/env-config-loader.ts) and
[config-defaults.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/lib/utils/config-defaults.ts).

## Examples

The repository's complete fresh-install environment example is included below.
Replace the auth placeholder with a stable random value before use. Configure
credentials in the UI or in the environment according to the precedence above.

```dotenv title=".env.example"
--8<-- ".env.example"
```

For an environment-managed eight-hour schedule, forward these variables through
Compose as described in [Deployment](deployment.md#pass-optional-environment-variables):

```dotenv title=".env scheduling settings"
SCHEDULE_ENABLED=true
SCHEDULE_INTERVAL=8h
SCHEDULE_TIMEZONE=America/Edmonton
```

An interval variable enables scheduling even when `SCHEDULE_ENABLED` is false.
For disabled scheduling, remove both interval inputs and set the enabled flag
false. Review the stored next run after a restart.
