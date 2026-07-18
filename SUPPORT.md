# Support policy

Publishing Manager supports public stable Obsidian releases from **1.8.0** onward on macOS, Windows, Linux, iOS, and Android. The same plugin package is used on desktop and mobile (`isDesktopOnly: false`). Obsidian preview/insider builds and forks receive best-effort diagnosis but are not release-blocking targets.

Production code runs only against Obsidian and browser-compatible APIs. Node.js, Electron, network access, external executables, and platform-specific filesystem APIs are not part of the plugin runtime contract.

Development and CI use Node.js **24** with npm and the committed lockfile. Newer Node versions may work, but Node 24 is the reproducible baseline.

Every stable release must verify the minimum declared Obsidian version and the current public stable release, cover desktop and mobile critical journeys, and record the tested app/plugin versions and devices. Raising the minimum requires a documented compatibility reason and synchronized changes to `support-policy.json`, `manifest.json`, and `versions.json`.
