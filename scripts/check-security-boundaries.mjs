import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Provides a permanent regression gate for the security boundaries established in SEC-001/002.
 * Semantic and resource tests remain primary; this check prevents high-risk rendering/execution
 * APIs or removal of the shared untrusted-data preflight from entering unnoticed.
 */
const sourceRoot = path.resolve('src');
const violations = [];
const files = await collectTypeScriptFiles(sourceRoot);
for (const file of files) {
  const content = await readFile(file, 'utf8');
  const relative = path.relative(process.cwd(), file);
  for (const [label, pattern] of [
    ['HTML injection API', /\.(?:innerHTML|outerHTML|insertAdjacentHTML|setHTML)\b/u],
    ['dynamic evaluation', /\b(?:eval|Function)\s*\(/u],
    ['credential-bearing URL construction', /href\s*:\s*String\s*\(/u]
  ])
    if (pattern.test(content)) violations.push(`${relative}: ${label}`);
}

const approvedExternalLinkRenderer = path.normalize(
  path.resolve('src/ui/security/confirmed-external-link.ts')
);
for (const file of files) {
  if (path.normalize(file) === approvedExternalLinkRenderer) continue;
  const content = await readFile(file, 'utf8');
  if (/createEl\(\s*['"]a['"]/u.test(content))
    violations.push(
      `${path.relative(process.cwd(), file)}: external anchors must use createConfirmedExternalLink`
    );
}

const approvedRenderer = await readFile(approvedExternalLinkRenderer, 'utf8');
for (const marker of ['safeExternalHttpUrl', 'Complete destination:', "rel: 'noopener noreferrer'"])
  if (!approvedRenderer.includes(marker))
    violations.push(
      'src/ui/security/confirmed-external-link.ts: destination validation/disclosure boundary is incomplete'
    );

const requiredBoundaries = [
  [
    'src/domain/records/schema-validation.ts',
    'inspectUntrustedData',
    'schema validation must inspect resource/prototype shape'
  ],
  [
    'src/infrastructure/storage/obsidian-frontmatter-codec.ts',
    'MAXIMUM_MANAGED_FRONTMATTER_BYTES',
    'frontmatter must have a raw byte limit'
  ],
  [
    'src/infrastructure/storage/obsidian-frontmatter-codec.ts',
    'inspectUntrustedData',
    'parsed YAML must pass the shared shape guard'
  ]
];
for (const [file, marker, label] of requiredBoundaries) {
  const content = await readFile(path.resolve(file), 'utf8');
  if (!content.includes(marker)) violations.push(`${file}: ${label}`);
}

if (violations.length > 0) {
  process.stderr.write(`Security boundary violations detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Security boundary check passed.\n');
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectTypeScriptFiles(target)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) collected.push(target);
  }
  return collected;
}
