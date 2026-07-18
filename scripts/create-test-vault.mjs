import process from 'node:process';

import { createDisposableTestVault } from './test-vault-lib.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_.length > 1) {
  process.stderr.write('Usage: node scripts/create-test-vault.mjs [new-output-path]\n');
  process.exit(1);
}

try {
  const vaultPath = await createDisposableTestVault({ outputPath: arguments_[0] });
  process.stdout.write(`Created disposable Publishing Manager test vault:\n${vaultPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not create test vault: ${message}\n`);
  process.exit(1);
}
