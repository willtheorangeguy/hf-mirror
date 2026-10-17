# Testing

Bun is the unit and API route test runner. Production-container E2E tests use
Docker Compose and Playwright. Use fixtures and disposable destinations for
transfer tests; they intentionally exercise overwrites and cancellation.

## Unit and route tests

```sh
bun test --timeout 30000
bun run test:hf
bun run test:shared
bun run test:coverage
```

[bunfig.toml](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/bunfig.toml) limits discovery to `src/`, preloads
[setup.bun.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/src/tests/setup.bun.ts), and sets a default five-second timeout.
CI overrides that timeout to 30 seconds and requests coverage. Targeted script
lists are useful starting points, but do not replace full regression checks.

The preload mocks database access and shortens timers. Some tests use real
SQLite, Git, or module mocks and run themselves in isolated child processes to
avoid Bun's process-wide mock leakage. Outer suites may report skipped inner
tests while the child executes them. Preserve that isolation when adding tests.

Place `*.test.ts` or `*.test.tsx` under `src/`. Add meaningful unit coverage for
new domain logic and route tests for handler behavior, particularly ownership,
auth guards, credentials, and mirror state transitions. Prefer testing outcomes
over reproducing the implementation in assertions.

## Migrations

```sh
bun run db:check
bun run test:migrations
```

Migration validation exercises a fresh database and upgrade paths against the
ordered migration journal. Run it when changing schema, migration repair, auth
tables, or database startup. CLI password recovery tests run both the source
script and the bundled form used by Docker.

## Real Git and large-file transfers

The push-engine tests create local disposable repositories and exercise fetch,
push, pruning, locks, batching, history protection, and HF refs. HF-specific
tests cover large-file transfer and verification alongside provider, identity,
metadata, and migration cases. Install Git and Git LFS, including `git lfs install`,
before running these suites. Mocked provider tests do not require production tokens.

## Container E2E

Prerequisites: Bun dependencies installed, Docker/Compose available with a
running engine, and Playwright Chromium installed:

```sh
bun install --frozen-lockfile
bun x playwright install --with-deps chromium
bun run test:e2e
```

The harness builds or uses `hf-mirror:e2e`, deploys the production application,
a local HF fixture, and Gitea. It exercises model/dataset/Space backups, Git/LFS
content, metadata, privacy, history rewrites and approval, retries, cancellation,
and browser behavior. Inspect [run.ts](https://github.com/willtheorangeguy/hf-mirror/blob/HEAD/tests/container-e2e/run.ts) for the
exact retained scenarios.

| Option / variable | Purpose |
| --- | --- |
| `--skip-build` | Reuse a prebuilt `hf-mirror:e2e` image |
| `--keep` / `bun run test:e2e:keep` | Leave containers available for diagnosis |
| `E2E_LIVE_HF=true` | Add the opt-in live public HF check; depends on external availability |
| `E2E_PROJECT` | Custom Compose project; must start `hf-e2e-` and use lowercase letters, digits, hyphens |
| `E2E_APP_PORT` | Default host app port 4328 |
| `E2E_GITEA_PORT` | Default host forge port 4333 |
| `E2E_SOURCE_PORT` | Default host fixture port 4591 |

Logs, results, and browser screenshots are written under
`tests/e2e/test-results/container/` and uploaded by CI for 14 days. These generated
artifacts are ignored by Git. Use the recorded Compose project name and the
test Compose file to inspect or remove kept containers and volumes; never run
cleanup against a production project.

## Build and manual validation

`bun run build` checks production bundling. After a deployment change, validate
health JSON, login, static assets, event streams, and a small mirror using the
actual proxy path and certificates. For backup changes, perform a restore in an
isolated location and verify both Git history and large-file payloads. Unit
tests and a healthy HTTP endpoint cannot establish recoverability of stored data.

See [development](./development.md) for CI parity and
[troubleshooting](./troubleshooting.md) for runtime diagnosis.
