# Publishing Manager

Publishing Manager is an offline, local-first publishing operations plugin for Obsidian. It is designed to manage everything between **draft complete** and **book available worldwide**.

The product specification and project backlog in the Publishing Manager Obsidian documentation folder are the source of truth for implementation.

## Current state

Milestone M0 foundation work is in progress. The plugin currently provides the build, test, architecture, and platform-safety foundation for later product features.

## Development

Requirements: Node.js 24 and npm.

```bash
npm install
npm run check
npm run build
```

Use `npm run dev` for a watch build. Copy or link `main.js`, `manifest.json`, and `styles.css` into a test vault at `.obsidian/plugins/publishing-manager/`.

## Supported platforms

Publishing Manager supports public stable Obsidian releases from 1.8.0 onward on macOS, Windows, Linux, iOS, and Android. Development and CI use Node.js 24 as the reproducible build baseline. See [SUPPORT.md](SUPPORT.md) for the compatibility and release-test policy.

## Engineering constraints

- No network access, telemetry, analytics, accounts, subscriptions, or cloud service.
- No Node filesystem or Electron APIs in production source.
- No external executables or manuscript uploads.
- Mobile-compatible and independent of other plugins.
- User-owned Markdown records written only through supported Obsidian APIs.

## Scripts

- `npm run dev` — watch development bundle
- `npm run build` — validate and create production `main.js`
- `npm run check` — formatting, lint, types, forbidden APIs, and tests
- `npm run test` — deterministic unit tests
- `npm run test:fixtures` — deterministic small, target-scale, malformed, and upgrade fixture checks
- `npm run test:coverage` — tests with coverage
- `npm run check:forbidden` — production-source policy scan
- `npm run check:support` — manifest, version map, platform, and toolchain policy alignment

## License

MIT. See [LICENSE](LICENSE).
