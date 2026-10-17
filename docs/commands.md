# HF Mirror — Commands

Run Bun scripts from the repository root. Read [installation](./installation.md)
first; the native SQLite driver requires Bun. These names are taken from
[package.json](../package.json), not from upstream gitea-mirror docs.

## Setup and server

| Command | Effect |
| --- | --- |
| `bun run setup` | Install dependencies and initialize the database |
| `bun run dev` | Start Astro development server on port 5321 |
| `bun run build` | Build server and client output in `dist/` |
| `bun run preview` | Preview the Astro build |
| `bun run start` | Run the production wrapper with host, port, and base-path support |
| `bun run astro --help` | Astro CLI options |
| `bun run startup-env-config` | Load environment configuration into the first user's stored settings |
| `bun run startup-recovery` | Recover interrupted jobs, with a default 30-second timeout |
| `bun run startup-recovery-force` | Recovery even if a recent attempt was recorded |

The source recovery script also accepts `--timeout=60000` (milliseconds, minimum
1000) and `--force`. Run recovery with the service stopped when using it to
reset orphaned in-flight records. The container entrypoint runs it before
serving requests.

## Database commands

| Command | Effect |
| --- | --- |
| `bun run manage-db init` / `bun run init-db` | Create database and apply migrations |
| `bun run manage-db check` / `bun run check-db` | Inspect database existence and tables |
| `bun run manage-db auto` | Initialize if missing; otherwise check |
| `bun run manage-db fix` / `bun run fix-db` | Move a legacy root DB and remove conflicting/old development DBs |
| `bun run reset-password --email=USER --new-password=VALUE` | Reset one account and clear its sessions |
| `bun run db:generate` | Generate SQL migration and metadata from schema changes |
| `bun run db:migrate` | Apply Drizzle migrations |
| `bun run db:push` | Push schema changes directly; use deliberately in development |
| `bun run db:pull` | Introspect schema from the configured database |
| `bun run db:check` | Check migration metadata consistency |
| `bun run db:studio` | Open Drizzle Studio; keep access local/private |

Back up before migration or repair. The app migrates at runtime; normal
container startup does not require manually running `db:push`. The operational
script and Drizzle CLI have their own entry points; confirm the selected
database path before running maintenance against a custom `DATABASE_URL`.

In a production container, use:

```sh
docker compose exec hf-mirror bun run manage-db check
docker compose exec hf-mirror bun run manage-db reset-password --email=admin@example.com --new-password='replace-this-password'
```

The Dockerfile rewrites `manage-db` to its bundled `dist/scripts/manage-db.js`
because source modules are not shipped. Other operational scripts can be run
explicitly as `bun dist/scripts/startup-env-config.js` or
`bun dist/scripts/startup-recovery.js`. Keep secrets out of shared command logs.

## Destructive development helpers

| Command | What is lost |
| --- | --- |
| `bun run cleanup-db` | Root/default `hf-mirror.db` and `data/hf-mirror.db` files |
| `bun run dev:clean` | Default database, then reinitializes and starts dev |
| `bun run start:fresh` | Default database, then reinitializes and starts production |
| `bun run manage-db cleanup` | Operational script's database and legacy development/root files |
| `bun run reset-users` / `bun run manage-db reset-users` | User accounts and related application records |

These are not ordinary upgrade or password recovery procedures. The cleanup
scripts do not constitute a complete reset of every clone, archive, custom path,
or remote repository. Review the script and preserve state first.

## Validation

| Command | Scope |
| --- | --- |
| `bun test` | Bun tests under `src/`, with configured preload |
| `bun run test:watch` | Watch unit/route tests |
| `bun run test:coverage` | Bun coverage report |
| `bun run test:hf` | Targeted HF provider, metadata, identity, migration, and transfer tests |
| `bun run test:shared` | Selected auth, sources, configuration, schedule, and route regressions |
| `bun run test:migrations` | Fresh and upgrade migration validation |
| `bun run test:e2e` / `bun run test:e2e:ci` | Production container E2E harness |
| `bun run test:e2e:keep` | Keep E2E containers for diagnosis |

For CI parity use `bun test --timeout 30000 --coverage`; details, E2E flags, and
isolation behavior are in [testing](./testing.md). There is no configured lint
or format script. Follow existing conventions rather than assuming one exists.
