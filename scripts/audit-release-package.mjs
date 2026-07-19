import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';

/** Audits exactly the three files installed or attached to an Obsidian community-plugin release. */
const releaseAssets = ['main.js', 'manifest.json', 'styles.css'];
const violations = [];
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));

if (Object.keys(packageJson.dependencies ?? {}).length !== 0)
  violations.push('package.json must have no production dependencies');
if (Object.keys(lock.packages?.['']?.dependencies ?? {}).length !== 0)
  violations.push('package-lock.json root must have no production dependencies');
if (manifest.id !== 'publishing-manager') violations.push('manifest id is not publishing-manager');
if (manifest.version !== packageJson.version)
  violations.push('manifest and package versions do not match');

const evidence = [];
for (const asset of releaseAssets) {
  const content = await readFile(asset);
  const details = await stat(asset);
  evidence.push({
    asset,
    bytes: details.size,
    sha256: createHash('sha256').update(content).digest('hex')
  });
}

const bundle = await readFile('main.js', 'utf8');
for (const [label, pattern] of [
  ['source map reference', /sourceMappingURL/u],
  ['local developer path', /\/Users\//u],
  ['Node filesystem import', /require\(["'](?:node:)?fs(?:\/promises)?["']\)/u],
  ['Node network import', /require\(["'](?:node:)?(?:http|https|net|tls|dgram)["']\)/u],
  ['child process import', /require\(["'](?:node:)?child_process["']\)/u],
  ['Electron import', /require\(["']electron["']\)/u]
])
  if (pattern.test(bundle)) violations.push(`main.js contains ${label}`);

if (!/require\(["']obsidian["']\)/u.test(bundle))
  violations.push('main.js does not retain the required external Obsidian host import');

if (violations.length > 0) {
  process.stderr.write(`Release package audit failed:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release package audit passed: 0 production dependencies; ${releaseAssets.length} reviewed release assets.\n${evidence.map(({ asset, bytes, sha256 }) => `${asset}\t${bytes} bytes\tsha256 ${sha256}`).join('\n')}\n`
  );
}
