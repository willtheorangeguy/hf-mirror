# Repository Guidelines

## Project Structure & Module Organization
- `src/` – app code
  - `components/` (React, PascalCase files), `pages/` (Astro/API routes), `lib/` (domain + utilities, kebab-case), `hooks/`, `layouts/`, `styles/`, `tests/`, `types/`, `data/`, `content/`.
- `scripts/` – operational TS scripts (DB init, recovery): e.g., `scripts/manage-db.ts`.
- `drizzle/` – SQL migrations; `data/` – runtime SQLite (`hf-mirror.db`).
- `public/` – static assets; `dist/` – build output.
- Key config: `astro.config.mjs`, `tsconfig.json` (alias `@/* → src/*`), `bunfig.toml` (test preload), `.env(.example)`.

## Build, Test, and Development Commands
- Prereq: Bun `>= 1.2.9` (see `package.json`).
- Setup: `bun run setup` – install deps and init DB.
- Dev: `bun run dev` – start Astro dev server.
- Build: `bun run build` – produce `dist/`.
- Preview/Start: `bun run preview` (static preview) or `bun run start` (SSR entry).
- Database: `bun run db:generate|migrate|push|studio` and `bun run manage-db init|check|fix|reset-users`.
- Tests: `bun test` | `bun run test:watch` | `bun run test:coverage`.
- Docker: see `docker-compose.yml` and variants in repo root.

## Coding Style & Naming Conventions
- Language: TypeScript, Astro, React.
- Indentation: 2 spaces; keep existing semicolon/quote style in touched files.
- Components: PascalCase `.tsx` in `src/components/` (e.g., `MainLayout.tsx`).
- Modules/utils: kebab-case in `src/lib/` (e.g., `hf-transfer.ts`).
- Imports: prefer alias `@/…` (configured in `tsconfig.json`).
- Do not introduce new lint/format configs; follow current patterns.

## Testing Guidelines
- Runner: Bun test (`bun:test`) with preload `src/tests/setup.bun.ts` (see `bunfig.toml`).
- Location/Names: `**/*.test.ts(x)` under `src/**` (examples in `src/lib/**`).
- Scope: add unit tests for new logic and API route tests for handlers.
- Aim for meaningful coverage on DB, auth, and mirroring paths.

## Commit & Pull Request Guidelines
- Commits: short, imperative, scoped when helpful (e.g., `lib: fix token parsing`, `ui: align buttons`).
- PRs must include:
  - Summary, rationale, and testing steps/commands.
  - Linked issues (e.g., `Closes #123`).
  - Screenshots/gifs for UI changes.
  - Notes on DB/migration or .env impacts; describe configuration impacts in the change summary.

## Security & Configuration Tips
- Never commit secrets. Copy `.env.example` → `.env` and fill values; prefer `bun run startup-env-config` to validate.
- SQLite files live in `data/`; avoid committing generated DBs.
- Certificates (if used) reside in `certs/`; manage locally or via Docker secrets.
