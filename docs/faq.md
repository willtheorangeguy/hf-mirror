# FAQ

???+ question "How is this related to gitea-mirror?"

    HF Mirror is based on [gitea-mirror by RayLabsHQ](https://github.com/RayLabsHQ/gitea-mirror).
    It retains application foundations and adapts the source and transfer workflow
    for Hugging Face. Credit is preserved in [NOTICE](./attribution.md), and the existing
    [GNU AGPL version 3 license](./license.md) is retained. Upstream provider lists,
    deployment files, and ports are not the HF Mirror configuration reference.

??? question "What can it mirror?"

    Hugging Face models, datasets, and Spaces to Gitea, or Forgejo as a beta
    destination. It discovers account/organization repositories, likes, and supported
    collection items. GitHub and GitLab source providers and destinations are not
    registered in this codebase. See [limitations](./roadmap.md).

??? question "Does it back up weights and Xet-backed files?"

    With LFS enabled, the engine uses Git LFS to fetch historical large-file payloads,
    including files exposed through HF's LFS-compatible delivery, verifies local
    SHA-256 hashes, uploads them, and checks destination download availability.
    It is not an independent Xet storage/block-format mirror. With LFS disabled,
    large files are explicitly excluded even if Git pointers transfer successfully.

??? question "Why is the first backup slow or larger than the current model?"

    The transfer includes history and large files reachable from selected refs,
    not just the current working tree. Data is stored locally and on the destination;
    snapshot protection can add more storage. Rate limits, hashing, network throughput,
    and forge indexing also affect time. Start with one small repository and the
    default transfer concurrency of two. Monitor progress before increasing concurrency.

??? question "Are private and gated repositories safe to back up?"

    The source token must already have permission. Gated/private sources require a
    private destination in the transfer logic, even when public visibility is otherwise
    selected. Check access controls and backups on your forge and HF Mirror host;
    metadata archives and clones contain repository content too. The tool does not
    grant access to a gate or change the content's terms.

??? question "Are HF pull requests recreated as pull requests?"

    No. Selected HF PR conversations become destination issues with an `[HF PR]`
    title and original attribution. Their Git refs are retained separately under
    `refs/hf-mirror/pr/*`. Metadata JSON preserves source discussion information.
    This provides an archive, not an equivalent hosted HF review workflow.

??? question "Is a downloaded archive enough to restore a model?"

    No. The archive route downloads metadata and a transfer manifest as JSON.
    Safety bundles contain Git history but rely on large files in persistent clones.
    Preserve the entire application data set and the forge's storage; see
    [backup and restore](./backup-restore.md).

??? question "Can I edit the mirrored destination?"

    Treat it as a managed backup. Subsequent syncs force refs to match the source
    and can remove branches or replace tags. Keep independent work in another
    repository. Use snapshot or approval protection to retain prior destination
    history before destructive changes.

??? question "Why do likes and API keys use `starred` and `gm_` names?"

    These are inherited internal/API names from gitea-mirror. HF likes are presented
    through the starred-repository settings, and HF Mirror API keys start with
    `gm_`. They remain distinct from HF source tokens and forge destination tokens.

??? question "Why did a saved UI setting change after restart?"

    When connection credentials are supplied in the environment, startup initialization
    updates the first account's settings. Some booleans receive explicit defaults
    when unset. Manage environment preferences consistently or store connection
    credentials in the UI. Also ensure that `.env` variables are actually forwarded
    by Compose. See [configuration](./configuration.md).

??? question "Can I add another local account?"

    Email/password signup closes after the first account exists. Intentionally set
    `AUTH_ALLOW_SIGNUP=true` to reopen it, or use registered SSO/proxy provisioning
    as configured. Protect the instance while creating the first account.
    See [authentication](./authentication.md).

??? question "Does a healthy container mean all backups are complete?"

    No. Health checks database connectivity and recovery state. Check each repository's
    component statuses and manifests, review failures, and perform restore tests.
    A completed Git-only backup still excludes large files by choice.
