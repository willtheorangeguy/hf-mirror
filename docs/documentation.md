# Documentation

This site uses Material for MkDocs with configuration and design assets inherited
from [willtheorangeguy/mkdocs](https://github.com/willtheorangeguy/mkdocs). This
repository owns its content, navigation, and site identity. The shared repository
owns themes, extensions, plugins, dependency versions, and build logic.

## Preview locally

Install Python 3.12, Git, and the shared documentation requirements. Clone the
MkDocs repository alongside HF Mirror, then run its preview helper from the
HF Mirror checkout:

=== "Windows"

    ```powershell
    git clone https://github.com/willtheorangeguy/mkdocs ../mkdocs
    python -m pip install -r ../mkdocs/shared/requirements-docs.txt
    ../mkdocs/scripts/docs-serve.ps1
    ```

=== "macOS / Linux"

    ```bash
    git clone https://github.com/willtheorangeguy/mkdocs ../mkdocs
    python3 -m pip install -r ../mkdocs/shared/requirements-docs.txt
    ../mkdocs/scripts/docs-serve.sh
    ```

Skip the clone command when the sibling checkout already exists. The helper
fetches `.mkdocs-shared`, stages shared CSS, scripts, icons, and theme overrides,
then serves on port 8000. Open the local URL printed by MkDocs.

## Validate

The helper stages the same assets as CI. Use build mode for a strict check:

=== "Windows"

    ```powershell
    ../mkdocs/scripts/docs-serve.ps1 -Build
    npx --yes markdownlint-cli2 --config .mkdocs-shared/shared/lint/.markdownlint.jsonc "docs/**/*.md"
    ```

=== "macOS / Linux"

    ```bash
    ../mkdocs/scripts/docs-serve.sh --build
    npx --yes markdownlint-cli2 --config .mkdocs-shared/shared/lint/.markdownlint.jsonc 'docs/**/*.md'
    ```

After staging, `mkdocs build --strict` runs the same build directly. A successful
build prints `Documentation built in ... seconds` and exits 0. Resolve warnings
before committing. Generated `site/`, shared configuration, and staged design
assets are ignored by Git. Only content and deliberate overrides belong in commits.

## Write and organize pages

Read [the writing standard](https://github.com/willtheorangeguy/mkdocs/blob/HEAD/docs.instructions.md)
before editing. The same standard is shipped as `docs/docs.instructions.md` and
excluded from the built site. Use one sentence-case H1 matching the navigation
label, language-tagged fences, verified examples, and relative links between
documentation pages.

Add each public page to `nav` in `mkdocs.yml`. Link source and workflow files
with absolute GitHub URLs because they are not part of the built documentation
tree. Keep the root README's structure intact when adjusting renamed page links.
Preserve the [gitea-mirror attribution](attribution.md).

`license.md` and `attribution.md` include the root `LICENSE` and `NOTICE` by
reference. Do not copy those authoritative texts into separate documents.
Org-wide contribution, conduct, and security policies are external nav links.

## Build configuration

`mkdocs.yml` inherits `.mkdocs-shared/shared/mkdocs.base.yml`. Never declare
local `plugins` or `markdown_extensions` lists: MkDocs replaces those lists and
would discard the shared behavior. Change common build requirements in the
shared repository instead of copying dependency pins here.

The deploy and lint callers are documented in [CI/CD](ci-cd.md). Builds use
the verified account Pages host, `williamvdg.me`, and repository path `hf-mirror/`.
Pages already uses workflow-based publishing. Merging this branch into `main`
allows the deploy caller to publish the site.
