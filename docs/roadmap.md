# HF Mirror — Roadmap and Limitations

This page records boundaries visible in the current implementation. It is not
a promise of future work or a release schedule. Proposals belong in the project's
[issues](https://github.com/willtheorangeguy/hf-mirror/issues) and
[discussions](https://github.com/willtheorangeguy/hf-mirror/discussions).

## Provider scope

The source registry accepts only Hugging Face. Destinations are Gitea and Forgejo;
Forgejo is marked beta because it has less field validation. Upstream
gitea-mirror features for other source or destination providers are not implicitly
available here. New providers require explicit adapters, identity handling,
credentials, and tests.

Evidence: [source kinds](../src/lib/source-providers/kinds.ts),
[destination kinds](../src/lib/destination-kinds.ts).

## Archive fidelity

The HF adapter discovers models, datasets, Spaces, and supported collection items.
It does not recreate the Hub's inference services, deployed Space runtime, access
gates, collection UI, or every external resource linked from a card. Only
repository content and selected API metadata are archived.

PR conversations are copied as issues, not native forge PRs. Authors and source
timestamps are represented in text rather than impersonating original accounts.
Inherited wiki, release, label, and milestone settings are not separate HF export
pipelines; the registry marks no HF release capability. See
[metadata implementation](../src/lib/hf-metadata.ts).

Large-file completeness depends on source permissions and Git LFS-compatible
delivery of the referenced payloads. Destination verification checks advertised
download availability/size; it does not download every object again to hash it.
Local payloads are hashed. Inspect selected-content status and test real restores.

## Operation and recovery

The repository supplies a single-process application, SQLite persistence,
per-clone locks, and a process-wide concurrency limit. It does not ship a
distributed queue, shared scheduler coordination, or a multi-replica deployment.

History protection provides snapshots and approvals. Recovery of a historical
snapshot is an operator procedure rather than an automatic restore UI, and
LFS payloads remain in persistent clones. Metadata snapshots do not share the
safety bundle's retention policy. Budget and back up those paths explicitly.
See [backup and restore](./backup-restore.md).

## Validation boundaries

The default container E2E harness uses a local HF fixture and Gitea. Live HF
validation is opt-in and depends on the external service. Forgejo and uncommon
proxy/IdP/certificate combinations need validation in the actual deployment.
See [testing](./testing.md).

The application API is unversioned and has route-specific response shapes.
There is no generated OpenAPI artifact. Integrations should follow
[API](./api.md), handle explicit failures, and verify behavior when upgrading.
