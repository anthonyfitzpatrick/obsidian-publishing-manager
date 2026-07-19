import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Keeps optional integrations on their deliberately narrow application and browser-event seams.
 * This check is structural evidence: application services cannot acquire Obsidian internals,
 * storage adapters, another plugin package, or a network client through a future import.
 */
const applicationFiles = [
  'src/application/integrations/manuscript-compiler-integration.ts',
  'src/application/integrations/metadata-visuals-provider.ts'
];
const integrationFiles = [
  ...applicationFiles,
  'src/infrastructure/integrations/browser-compiler-capability-transport.ts',
  'src/infrastructure/integrations/browser-metadata-visuals-provider-transport.ts'
];
const forbiddenApplicationImports = [
  ['Obsidian host API', /(?:from\s+|import\s*\()['"]obsidian['"]/u],
  ['infrastructure adapter', /(?:from\s+|import\s*\()['"][^'"]*infrastructure\//u],
  [
    'storage repository',
    /(?:from\s+|import\s*\()['"][^'"]*(?:record-storage|vault-managed-record|repository)[^'"]*['"]/u
  ]
];
const forbiddenIntegrationAccess = [
  ['private plugin registry', /\.plugins\.(?:getPlugin|getPlugins|manifests)\b/u],
  [
    'direct plugin package import',
    /(?:from\s+|import\s*\()['"](?!\.)[^'"]*(?:manuscript-compiler|metadata-visuals)[^'"]*['"]/u
  ]
];

const violations = [];
for (const file of applicationFiles) {
  const content = await readFile(path.resolve(file), 'utf8');
  for (const [label, pattern] of forbiddenApplicationImports)
    if (pattern.test(content)) violations.push(`${file}: ${label}`);
}
for (const file of integrationFiles) {
  const content = await readFile(path.resolve(file), 'utf8');
  for (const [label, pattern] of forbiddenIntegrationAccess)
    if (pattern.test(content)) violations.push(`${file}: ${label}`);
}

const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
const productionDependencies = Object.keys(packageJson.dependencies ?? {});
for (const dependency of productionDependencies) {
  if (
    /(?:manuscript-compiler|metadata-visuals)/u.test(dependency) ||
    /^(?:axios|got|undici|node-fetch)$/u.test(dependency)
  )
    violations.push(`package.json: prohibited production dependency ${dependency}`);
}

if (violations.length > 0) {
  process.stderr.write(`Integration boundary violations detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Integration boundary check passed.\n');
}
