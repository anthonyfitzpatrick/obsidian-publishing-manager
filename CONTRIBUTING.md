# Contributing to Publishing Manager

Publishing Manager is offline, local-first, mobile-compatible software that manages user-owned publishing data. Changes must preserve those guarantees. The project backlog and specifications in the Publishing Manager Obsidian documentation space are the source of truth.

## Before coding

1. Open or select a Gitea issue using the appropriate template.
2. Reference a permanent backlog ID such as `FND-009` or explain why the work is newly discovered so the backlog can be updated.
3. Record the user outcome, boundaries, non-goals, acceptance criteria, mobile/accessibility impact, data or migration impact, privacy/security impact, and test approach.
4. Add an ADR before changing a durable architectural boundary or data ownership decision.

Do not include manuscripts, real publishing metadata, credentials, private logs, personal vault paths, or copied user content in an issue, fixture, screenshot, commit, or pull request.

## Branches and scope

Use a short-lived branch named `<kind>/<backlog-id>-<slug>`, for example `feature/FND-009-repository-conventions` or `fix/BOOK-004-rename-event`. Accepted kinds are `feature`, `fix`, `docs`, `test`, `refactor`, `build`, and `release`.

Keep changes independently reviewable. Separate unrelated cleanup, dependency updates, schema changes, and product behavior. Never rewrite or discard another contributor's uncommitted work.

## Code and documentation commentary

All handwritten code must be accompanied by verbose, human-readable commentary. A future maintainer must be able to understand purpose, architectural role, reasoning, invariants, inputs/outputs, side effects, failure modes, cancellation, compatibility assumptions, and non-obvious edge cases without reconstructing them from syntax or issue history.

Each source file begins with module commentary. Exported/public contracts receive documentation comments. Non-obvious algorithms, branches, normalization, conflict handling, migrations, safety checks, and tests include adjacent explanatory commentary. Comments explain intent and decisions rather than narrating syntax.

Generated bundles/declarations, lockfiles, vendored code, and machine formats that cannot contain comments are exempt from hand annotation; document their generator, purpose, regeneration path, and constraints in the nearest handwritten source or companion Markdown file. Commentary is maintained with the code. Missing, superficial, misleading, or stale commentary blocks merge.

Documentation supplies the same human context: audience and outcome, rationale, operation, relationships, assumptions, boundaries, failure/recovery behavior, and examples or edge cases where useful. The authoritative detailed standard is `STYLE_GUIDE.md` in the Publishing Manager Obsidian documentation space.

## Commit messages

Use `<BACKLOG-ID> <imperative summary>` for planned work:

```text
FND-009 add repository conventions
BOOK-004 preserve identity after vault rename
```

Use `OPS <imperative summary>` only for repository maintenance with no product backlog outcome. Keep the first line at 72 characters or fewer, omit a trailing period, and explain motivation, risk, migration implications, and verification in the body when the title is not enough. Each commit must build or clearly identify why it is an intentionally dependent step.

## Required verification

Run before opening or updating a pull request:

```bash
npm ci
npm run check
npm run build
```

Add tests in proportion to risk. Fixtures must be fictional, deterministic, network-free, and independent of personal vault content. Record manual desktop/mobile evidence when behavior cannot be proven automatically.

For manual Obsidian testing, use `npm run test:vault` and follow [TEST_VAULT.md](TEST_VAULT.md). Never point development tooling at a personal vault or copy personal content into a generated vault.

## Pull requests

Use the repository pull-request template. Link the issue and backlog ID; describe the outcome and boundaries; list automated and manual evidence; disclose schema, migration, compatibility, accessibility, performance, privacy, and security effects; and include screenshots only when they contain no private vault data.

A pull request is merge-ready when CI is green, requested changes are resolved, documentation and changelog entries are current, the diff contains no unrelated changes, and acceptance criteria have named evidence. Work in progress must use Gitea's `WIP:` title prefix.

## Review standard

Reviewers check correctness, domain clarity, commentary quality, module boundaries, offline operation, mobile behavior, accessibility, deterministic behavior, performance, migration safety, preservation of unknown metadata, error recovery, and test quality. Blocking feedback states the violated invariant, missing commentary, or acceptance criterion and the evidence needed to resolve it.

## Releases

Release work follows [RELEASING.md](RELEASING.md). Do not create a release tag until version files agree, CI and the release matrix pass, release assets are generated from a clean production build, and the changelog and rollback guidance are complete.
