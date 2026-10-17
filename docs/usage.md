# Usage

Complete [quickstart](./getting-started.md) before expanding discovery or scheduling.
The dashboard, repositories, organizations, activity, and configuration pages
share your signed-in account's configuration and records.

## Connect sources and a destination

Each Hugging Face connection has a name, base URL, username, token, and enabled
state. Repositories retain their source identity so transfers use the matching
credentials. The oldest source is primary for operations without a selection.
Select a source explicitly when multiple connections share a host.

Configure Gitea or Forgejo with a URL reachable from HF Mirror, account name,
and token. An optional external URL controls browser links when the API address
differs. Forgejo is marked beta. Source hosts lock after import and the
destination locks after mirroring. Use the Configuration page's confirmation
flow for a host change; environment initialization refuses locked host changes.
Rotating a token on the same host does not move repositories.

## Discover or add repositories

- Add by URL or owner/name. Preserve a URL's `datasets/` or `spaces/` prefix.
- Import from connected accounts and organizations. Configure selected repository
  types and included organizations before a large discovery pass.
- Enable liked repositories to discover HF likes. Internal fields and APIs retain
  the name `starred` from gitea-mirror.
- Set collection slugs in source settings. Models, datasets, and Spaces are
  accepted; unsupported collection item types are skipped.
- Public-only connections support manual repository and organization imports.
  Bulk personal discovery skips connections without a token.

Discovery adds database records; mirroring transfers content. Inspect failed
source/organization results and counts before a large batch. Ignoring a record
keeps it out of normal automated work.

## Choose destination ownership

Repository destination overrides take priority. For non-liked organization
repositories, organization overrides are checked next. The optional default HF
organization (`giteaConfig.hfReposOrg`) routes HF repositories, including likes,
to one organization when no more specific override applies.

Otherwise the configured strategy determines ownership:

| Strategy | Placement |
| --- | --- |
| `preserve` | Keep source organization/other-owner groups; personal repositories use the destination account |
| `single-org` | Use the configured organization, falling back to the destination account |
| `flat-user` | Use the destination account |
| `mixed` | Keep organization repositories grouped; route others to the configured organization/account |

Likes have separate dedicated-organization or preserve-owner settings. A recorded
mirror location is reused on later syncs. Changing defaults does not transfer
an existing mirror: use the move action and review destination permissions.
Sync can overwrite and remove branches and tags to match the source. Treat the
destination as a managed backup rather than a place for independent edits.

## Mirror, sync, and inspect results

Select imported records and use **Mirror** for the initial backup; use **Sync**
for an existing mirror. Repository and organization overrides can inherit or
replace global mirror options. Watch the repository row and activity log.

| Status | Meaning |
| --- | --- |
| `imported` | Tracked, awaiting a first mirror |
| `mirroring` / `syncing` | Transfer or selected metadata work is running |
| `mirrored` / `synced` | The selected transfer completed |
| `failed` | A required step failed; inspect the error and retry |
| `pending-approval` | A destructive history change requires review |
| `ignored` | Excluded from normal work, including cancelled transfers |

With LFS enabled, the engine fetches historical files, hashes them locally,
uploads their inventory, and checks destination download availability. It also
verifies branches, tags, and mapped PR refs. Disabling LFS makes a Git-only
backup and reports large files as `excluded`.

Selected discussions and PR conversations are archived as JSON and become
destination issues with original attribution and comment markers. HF PRs are
not recreated as native merge requests. Archive downloads contain JSON metadata
and transfer manifests, not model weights or Git bundles.

## Review rewrites, cancel, and retry

With `block-on-force-push`, inspect pending ref changes before approving a sync.
Approval permits the destructive update and safety snapshot. Dismissal ignores
the repository. Other strategies are in [backup and restore](./backup-restore.md).

Active cancellation aborts a repository's transfer and retains downloaded objects.
**Stop Pending Mirrors** marks queued `imported` and `failed` records ignored;
it does not cancel active work. Retry after fixing access, storage, or destination
problems. Startup recovery detects interrupted jobs; see
[troubleshooting](./troubleshooting.md).

## Automate carefully

Scheduling starts disabled on a fresh installation. The UI supports clock
schedules with a timezone; stored settings also accept durations or cron
expressions. Enable discovery and automatic mirroring separately as appropriate.
Confirm the displayed next run. With environment-provided credentials, review
restart behavior in [configuration](./configuration.md).

Configure [notifications](./notifications.md) and take independent
[backups](./backup-restore.md). CSV exports are inventories, not content backups.
Reconciliation previews missing, moved, and untracked managed destinations
before applying selected repairs.
