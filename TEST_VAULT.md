# Disposable developer test vault

The test-vault workflow creates a fresh Obsidian vault containing only the production Publishing Manager plugin assets and fictional guidance notes. It never reads, scans, links, or copies a personal vault.

## Create a vault

```bash
npm ci
npm run test:vault
```

The command runs the production build, creates a uniquely named directory under the operating system's temporary directory, installs `main.js`, `manifest.json`, and `styles.css` under `.obsidian/plugins/publishing-manager/`, and adds `publishing-manager` to `.obsidian/community-plugins.json`. Open the printed path using **Open folder as vault** in Obsidian.

Each run creates a new vault. Existing directories are never overwritten or reset. The generated vault contains an ignore-all `.gitignore` and a sentinel file identifying it as disposable.

## Optional explicit output

To use a specific new directory outside this repository:

```bash
npm run build
node scripts/create-test-vault.mjs /absolute/path/to/new-test-vault
```

The target must not already exist and must not be inside the repository. Use a dedicated empty location containing no personal material.

## Test cycle

1. Create a new vault for the scenario.
2. Open it in the required supported Obsidian desktop or mobile environment.
3. Confirm Publishing Manager is enabled; reload or toggle it after rebuilding.
4. Use only fictional fixture content and record the app/plugin versions, platform, scenario, and result.
5. Close Obsidian and discard the temporary vault when the evidence is recorded.

Do not commit generated vaults, plugin build output, Obsidian workspace state, screenshots containing private data, logs with personal paths, or device backups. A test-vault failure must be reproduced with fictional content before it enters an issue or pull request.

## Automated guard

`npm run check:test-vault` exercises the generator with synthetic plugin assets, verifies the installed layout and ignore guard, and proves that repository-contained output is rejected. The complete `npm run check` and Gitea CI workflows include this guard.
