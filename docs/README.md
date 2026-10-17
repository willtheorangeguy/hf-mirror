# HF Mirror — Documentation

HF Mirror backs up Hugging Face repositories to Gitea or Forgejo. Start with the
quickstart, then use the task guides and references below. This codebase is based
on [gitea-mirror by RayLabsHQ](https://github.com/RayLabsHQ/gitea-mirror); these
pages describe this repository's Hugging Face implementation.

```text
docs/
|-- README.md
|-- quickstart.md
|-- installation.md
|-- usage.md
|-- configuration.md
|-- authentication.md
|-- notifications.md
|-- deployment.md
|-- backup-restore.md
|-- troubleshooting.md
|-- faq.md
|-- architecture.md
|-- api.md
|-- commands.md
|-- development.md
|-- testing.md
`-- roadmap.md
```

| Page | What it covers |
| --- | --- |
| [Quickstart](./quickstart.md) | Deploy and complete a first verified mirror |
| [Installation](./installation.md) | Prerequisites, release files, source and local container builds |
| [Usage](./usage.md) | Discovery, destinations, overrides, schedules, progress, and cancellation |
| [Configuration](./configuration.md) | Runtime variables, defaults, stored settings, and precedence |
| [Authentication](./authentication.md) | Accounts, API keys, OIDC/SAML, and proxy headers |
| [Notifications](./notifications.md) | ntfy, Apprise, Gotify, and signed webhooks |
| [Deployment](./deployment.md) | Compose, proxies, certificates, upgrades, and publishing |
| [Backup and restore](./backup-restore.md) | Persistent state, safety snapshots, and recovery procedures |
| [Troubleshooting](./troubleshooting.md) | Symptoms, concrete errors, and recovery steps |
| [FAQ](./faq.md) | Scope, completeness, privacy, storage, and upstream differences |
| [Architecture](./architecture.md) | Layers, transfer flow, schema, and project layout |
| [API](./api.md) | Authentication, examples, and application route inventory |
| [Commands](./commands.md) | Bun scripts, database operations, and destructive commands |
| [Development](./development.md) | Setup, conventions, migrations, CI, and contributions |
| [Testing](./testing.md) | Unit, migration, transfer, and container E2E validation |
| [Roadmap and limitations](./roadmap.md) | Implemented boundaries and areas needing validation |

Project terms and upstream credit remain in [LICENSE](../LICENSE),
[NOTICE](../NOTICE), and the [project README](../README.md).
