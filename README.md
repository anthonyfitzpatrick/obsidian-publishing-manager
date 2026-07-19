# Publishing Manager

Publishing Manager is an offline, local-first publishing operations plugin for Obsidian. It is designed to manage everything between **draft complete** and **book available worldwide**.

The product specification and project backlog in the Publishing Manager Obsidian documentation folder are the source of truth for implementation.

## Current state

Milestones M0 through M8 are complete. M9 Hardening is current at 13/24. Security, privacy/lifecycle, and machine-checked accessibility contracts are active; mobile verification is next.

## Licence boundary

Publishing Manager's original software and documentation are MIT-licensed. Third-party classification vocabularies are not included and are not relicensed as MIT content. Manual identifiers and links to official sources remain available. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the exact boundary.

The authoritative milestone and section reviews live in the Publishing Manager Obsidian documentation space.

## Development

Requirements: Node.js 24 and npm.

```bash
npm install
npm run check
npm run build
```

Use `npm run dev` for a watch build. Copy or link `main.js`, `manifest.json`, and `styles.css` into a test vault at `.obsidian/plugins/publishing-manager/`.

### Disposable test vault

Run `npm run test:vault` to build the plugin and create a new disposable, fictional vault in the operating system's temporary directory. The command prints the vault path; open that folder as an Obsidian vault. It never reads or copies personal vault content and refuses to create its output inside this repository. See [TEST_VAULT.md](TEST_VAULT.md).

## Supported platforms

Publishing Manager supports public stable Obsidian releases from 1.8.0 onward on macOS, Windows, Linux, iOS, and Android. Development and CI use Node.js 24 as the reproducible build baseline. See [SUPPORT.md](SUPPORT.md) for the compatibility and release-test policy.

## Engineering constraints

- No network access, telemetry, analytics, accounts, subscriptions, or cloud service.
- No Node filesystem or Electron APIs in production source.
- No external executables or manuscript uploads.
- Mobile-compatible and independent of other plugins.
- User-owned Markdown records written only through supported Obsidian APIs.

## Contributing

Start with a Gitea issue and reference the permanent backlog ID. See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commits, pull requests, testing, and review requirements. Release preparation follows [RELEASING.md](RELEASING.md), and notable changes belong in [CHANGELOG.md](CHANGELOG.md).

## Scripts

- `npm run dev` — watch development bundle
- `npm run build` — validate and create production `main.js`
- `npm run check` — formatting, lint, types, policy gates, normal tests, and blocked-network tests
- `npm run test` — deterministic unit tests
- `npm run test:offline` — the complete test suite with browser network primitives blocked
- `npm run test:fixtures` — deterministic small, target-scale, malformed, and upgrade fixture checks
- `npm run test:vault` — production build plus a new disposable Obsidian test vault
- `npm run test:coverage` — tests with coverage
- `npm run check:forbidden` — production-source policy scan
- `npm run check:offline-bundle` — production-bundle initialization under blocked-network monitoring
- `npm run check:package` — exact release-asset, production-dependency, prohibited-import, and checksum audit
- `npm run check:privacy` — data placement, settings authority, redaction, and unload policy audit
- `npm run check:accessibility` — keyboard semantics, focus/error contracts, reflow, motion, colour, and touch-target audit
- `npm run check:lifecycle-preservation` — disposable-vault uninstall preservation proof
- `npm run check:conventions` — required contributor, issue, pull-request, commit, and release conventions
- `npm run check:test-vault` — disposable test-vault safety and installation workflow
- `npm run check:support` — manifest, version map, platform, and toolchain policy alignment

## License

MIT. See [LICENSE](LICENSE).
