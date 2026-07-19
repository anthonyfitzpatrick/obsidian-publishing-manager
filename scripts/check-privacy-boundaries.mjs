import { readFile } from 'node:fs/promises';
import process from 'node:process';

/**
 * Prevents privacy architecture drift: the composition root is the sole Obsidian plugin-data
 * adapter, settings-only Forget cannot acquire canonical storage authority, unload has no mutation
 * hook, diagnostics remain redacted by default, and the machine-readable inventory stays present.
 */
const violations = [];
const main = await readFile('src/main.ts', 'utf8');
const settings = await readFile('src/application/settings/publishing-settings-service.ts', 'utf8');
const diagnostics = await readFile('src/application/diagnostics/diagnostics-service.ts', 'utf8');
const inventory = await readFile('src/domain/privacy/data-handling-inventory.ts', 'utf8');

for (const [marker, expected] of [
  ['this.loadData()', 1],
  ['this.saveData(value)', 1]
]) {
  const count = main.split(marker).length - 1;
  if (count !== expected)
    violations.push(`src/main.ts: expected exactly ${expected} ${marker} plugin-data adapter`);
}
if (/\bonunload\s*\(/u.test(main))
  violations.push('src/main.ts: unload must not introduce a mutation hook');

for (const prohibited of [
  'VaultManagedRecordRepository',
  'VaultTextPort',
  'VaultAssetPort',
  'BookCatalog',
  '.delete(',
  '.trash('
])
  if (settings.includes(prohibited))
    violations.push(
      `src/application/settings/publishing-settings-service.ts: settings/Forget gained ${prohibited} authority`
    );

for (const marker of [
  'previewExport(redacted = true)',
  'Free-form diagnostic messages and guidance',
  'Local Diagnostics for private details'
])
  if (!diagnostics.includes(marker))
    violations.push(`src/application/diagnostics/diagnostics-service.ts: missing ${marker}`);

for (const marker of [
  'CANONICAL_VAULT_RECORD_TYPES = MANAGED_RECORD_TYPES',
  'LOCAL_PLUGIN_DATA_BLOCKS',
  'OPTIONAL_INTEGRATION_FIELD_EXCHANGES',
  "disableMutation: 'none'",
  "uninstallMutation: 'none'"
])
  if (!inventory.includes(marker))
    violations.push(`src/domain/privacy/data-handling-inventory.ts: missing ${marker}`);

if (violations.length > 0) {
  process.stderr.write(`Privacy boundary violations detected:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Privacy boundary check passed.\n');
}
