import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDisposableTestVault } from './test-vault-lib.mjs';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'publishing-manager-test-vault-check-'));

try {
  const workflowGuide = await readFile(join(process.cwd(), 'TEST_VAULT.md'), 'utf8');
  assert.match(workflowGuide, /## Create a vault/u);
  assert.match(workflowGuide, /never reads, scans, links, or copies a personal vault/iu);

  const artifactRoot = join(temporaryRoot, 'artifacts');
  const vaultPath = join(temporaryRoot, 'vault');
  await mkdir(artifactRoot);
  await Promise.all([
    writeFile(join(artifactRoot, 'main.js'), '/* synthetic production bundle */\n'),
    writeFile(
      join(artifactRoot, 'manifest.json'),
      '{"id":"publishing-manager","version":"0.1.0","minAppVersion":"1.8.0"}\n'
    ),
    writeFile(join(artifactRoot, 'styles.css'), '/* synthetic stylesheet */\n')
  ]);

  const createdPath = await createDisposableTestVault({
    artifactRoot,
    outputPath: vaultPath,
    repositoryRoot: process.cwd()
  });

  assert.equal(createdPath, vaultPath);
  assert.deepEqual(
    JSON.parse(await readFile(join(vaultPath, '.obsidian', 'community-plugins.json'), 'utf8')),
    ['publishing-manager']
  );
  assert.equal(await readFile(join(vaultPath, '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  await Promise.all(
    ['main.js', 'manifest.json', 'styles.css'].map((asset) =>
      readFile(join(vaultPath, '.obsidian', 'plugins', 'publishing-manager', asset))
    )
  );
  await readFile(join(vaultPath, '.publishing-manager-test-vault.json'));
  await readFile(join(vaultPath, 'Fictional Fixtures', 'Start Here.md'));

  await assert.rejects(
    createDisposableTestVault({
      artifactRoot,
      outputPath: join(process.cwd(), 'test-vault'),
      repositoryRoot: process.cwd()
    }),
    /must not be inside the repository/u
  );

  process.stdout.write('Disposable test-vault workflow check passed.\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
