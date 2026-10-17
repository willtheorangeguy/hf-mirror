# HF Mirror — Development

HF Mirror uses TypeScript, Astro, React, Tailwind, Bun, and Drizzle with SQLite.
Repository guidance is in [AGENTS.md](../AGENTS.md). This codebase is based on
[RayLabsHQ's gitea-mirror](https://github.com/RayLabsHQ/gitea-mirror), but its
source provider and backup pipeline are specific to Hugging Face.

## Local setup

Install Bun >= 1.2.9, Git, and Git LFS. CI uses Bun 1.3.14. From a checkout:

```sh
cp .env.example .env
git lfs install
bun run setup
bun run dev
```

On Windows, `Copy-Item .env.example .env` performs the copy step. Set a stable
auth secret and local public URL first. Use development HF/forge credentials and
dedicated destination repositories; the transfer engine can overwrite remote
refs. Never commit `.env`, databases, model files, generated secrets, or private
certificates. Data paths are documented in [configuration](./configuration.md).

`setup` installs packages and initializes the default database. For deterministic
dependency installation in CI, use `bun install --frozen-lockfile`. See
[installation](./installation.md) for local container builds.

## Code organization and conventions

- Put API routes and Astro pages in `src/pages/`, React views in
  `src/components/`, and domain code in `src/lib/`.
- Use PascalCase component filenames and kebab-case utility modules. Prefer
  the `@/` import alias for `src/`.
- Use two-space indentation and preserve the quote/semicolon style of touched files.
- Keep external source access in `source-providers/`, destination behavior in
  the push target layer, and database-aware orchestration outside the Git engine.
- Authenticate handlers before accessing records and scope reads/writes to the
  authenticated user. Never trust a request's `userId` for authorization.
- Reuse outbound URL validation and per-connection credential handling. Source
  tokens and destination tokens must stay associated with their own hosts.

Read [architecture](./architecture.md) before changing identity, scheduling,
transfer ordering, or recovery. Repository identity includes the HF type; a
model and dataset with the same owner/name are distinct.

## Database changes

Edit [schema.ts](../src/lib/db/schema.ts), generate a migration, and review SQL
and journal metadata together:

```sh
bun run db:generate
bun run db:check
bun run test:migrations
```

Test both fresh creation and upgrades. Existing repair logic handles historical
SSO/auth schema transitions; avoid bypassing those paths. Do not rewrite applied
migrations casually. Direct `db:push` is a development tool, not the release
upgrade procedure. Take a backup before experimenting with a real database.

## Validate a change

Run focused tests for the affected path, then the required project checks:

```sh
bun test --timeout 30000
bun run db:check
bun run test:migrations
bun run build
```

For transfer, container, authentication, or proxy changes, also run the relevant
[container E2E tests](./testing.md). The build validates bundling but does not
prove type correctness across every TypeScript file. `bun x astro check` is an
available additional diagnostic; there is no configured lint/format script.

## CI and release behavior

| Workflow | Triggers and checks |
| --- | --- |
| [Build and regression tests](../.github/workflows/astro-build-test.yml) | Push/PR/manual; frozen install, Git LFS, full coverage tests, migration checks, production build |
| [Container E2E](../.github/workflows/e2e-tests.yml) | Push/PR/manual; production image, local HF fixture and forge, browser checks, logs and screenshot artifacts |
| [Publish container](../.github/workflows/publish-container.yml) | Published release; amd64/arm64 GHCR image and pinned deployment assets |

The E2E workflow's live-HF option is manual and off by default. Publishing steps
and package visibility are described in [deployment](./deployment.md).

## Contributions and attribution

Use short imperative commits. PRs should explain the problem, resulting behavior,
rationale, and tests; link related issues and include screenshots for UI changes.
Call out database, migration, environment, and deployment impacts. Follow the
org-wide [Contributing Guide](https://github.com/willtheorangeguy/.github/blob/main/CONTRIBUTING.md)
and [Code of Conduct](https://github.com/willtheorangeguy/.github/blob/main/CODE_OF_CONDUCT.md).

Preserve [NOTICE](../NOTICE) and the existing [AGPLv3 license](../LICENSE).
Update the relevant task guide and reference page when behavior changes.
Public docs live in `docs/`, use lowercase page names except `README.md`, and
cross-link with relative paths. The root README should remain a concise entry point.
