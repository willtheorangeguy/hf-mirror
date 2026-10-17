# CI/CD

GitHub Actions checks the application and documentation on pull requests.
Published releases build the container images. Changes merged into the default
branch publish this documentation site through the shared MkDocs workflow.

## Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `astro-build-test.yml` | Push, pull request, manual | Regression coverage, migrations, production build |
| `e2e-tests.yml` | Push, pull request, manual | Production container and browser tests |
| `publish-container.yml` | Published GitHub release | Multi-architecture GHCR image and deployment assets |
| `docs.yml` | Documentation-related pushes to `main`/`master`, manual | Strict MkDocs build and Pages deployment |
| `docs-lint.yml` | Documentation-related pull requests, manual | Shared Markdown style, strict build, external links |

## Application checks

The regression workflow uses Bun 1.3.14 and installs Git LFS. To run its checks:

```bash
bun install --frozen-lockfile
bun test --timeout 30000 --coverage
bun run db:check
bun run test:migrations
bun run build
```

The container workflow builds `hf-mirror:e2e`, installs Playwright Chromium, and
executes the production-container harness with `--skip-build`. It uploads results,
logs, and a browser screenshot for 14 days. Manual runs can opt into live HF
validation. See [Testing](testing.md) for local requirements and artifacts.

## Documentation checks and deployment

The caller workflows use
[willtheorangeguy/mkdocs](https://github.com/willtheorangeguy/mkdocs). They inherit
the shared theme, plugins, pinned dependencies, asset staging, and validation.
Project workflows contain no separate build implementation.

Documentation pull requests run Markdown lint, `mkdocs build --strict`, and
external link checks. The deploy workflow grants `contents: read`, `pages: write`,
and `id-token: write`, then publishes the built static site to GitHub Pages.
The `pages` concurrency group keeps deployments from cancelling one another.

The site URL is [HF Mirror documentation](https://williamvdg.me/hf-mirror/).
It hosts documentation, not the Bun server application. No application root
site needs to be copied into its Pages artifact.

The workflows track the shared repository's `main` branch. Shared theme or
toolchain changes apply on the next documentation build. Diagnose build changes
in that repository before introducing local plugin or extension lists that would
replace the inherited configuration. Local checks are in
[Documentation](documentation.md).

## Release process

Publishing a GitHub release checks out that release tag and builds Linux amd64
and arm64 images at `ghcr.io/willtheorangeguy/hf-mirror:TAG`. Stable releases also
update `latest`; prereleases do not. Once the build succeeds, the workflow
attaches a version-pinned Compose file, `env.example`, and README.

After a first publication, the GHCR package must be public for anonymous pulls.
Review [Deployment](deployment.md) for permissions, assets, and upgrade steps.
