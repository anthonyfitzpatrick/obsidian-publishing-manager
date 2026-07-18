# Releasing Publishing Manager

Publishing Manager uses Semantic Versioning. Plugin versions use exactly `x.y.z`; schema compatibility is versioned and documented separately. During `0.x`, breaking product or data-contract changes still require explicit migration and rollback guidance.

## Version synchronization

Before release, update and verify:

- `package.json` version.
- `manifest.json` version and minimum Obsidian version.
- `versions.json` compatibility entry when required.
- `support-policy.json` when compatibility changes.
- `CHANGELOG.md`, known issues, migration notes, and rollback guidance.

The release tag must exactly match `manifest.json` version without a `v` prefix.

## Release checklist

1. Freeze scope and link every included issue/backlog ID.
2. Confirm the source-of-truth feature matrix, roadmap, schemas, ADRs, and release notes agree.
3. From a clean checkout, run `npm ci`, `npm run check`, and `npm run build`.
4. Complete dependency/security review and confirm production code remains offline with no Node, Electron, external executable, telemetry, account, or mandatory-plugin dependency.
5. Run the minimum/current Obsidian desktop and mobile support matrix using fresh, upgraded, malformed, and target-scale fixtures.
6. Record accessibility, performance, migration, disable/uninstall, and data-portability evidence.
7. Verify the production release assets: `main.js`, `manifest.json`, and `styles.css`.
8. Create a release-candidate commit and obtain product, engineering, test, security/privacy, accessibility, and documentation sign-off.
9. Create the exact-version tag and release; attach the verified release assets and publish the matching changelog section.
10. Perform post-release installation and upgrade smoke tests, then record known issues and rollback instructions.

For eventual Obsidian Community Plugins distribution, mirror the public source and exact-version release to GitHub because the Obsidian directory retrieves assets from the matching GitHub release. Internal development releases may remain on Gitea, but they must use the same version and asset rules.

## Release assets

`main.js` must come from the production build and is not committed. `manifest.json` and `styles.css` must match the tagged source. Record checksums before upload and do not attach source maps, test fixtures, vault data, logs, credentials, or development-only configuration.

## Failure and rollback

Stop release on any failing gate, version mismatch, unexplained performance regression, migration uncertainty, unsupported API use, or privacy/security concern. Never silently downgrade vault data. When an older plugin cannot interpret newer records safely, preserve them and provide read-only guidance.
