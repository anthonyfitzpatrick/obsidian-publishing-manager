import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const REQUIRED_PLUGIN_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isInsideRepository(targetPath, repositoryRoot) {
  const difference = relative(repositoryRoot, targetPath);
  return (
    difference === '' ||
    (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
  );
}

async function validateArtifacts(artifactRoot) {
  for (const asset of REQUIRED_PLUGIN_ASSETS) {
    if (!(await pathExists(join(artifactRoot, asset)))) {
      throw new Error(`Required production asset is missing: ${asset}. Run npm run build first.`);
    }
  }

  const manifest = JSON.parse(await readFile(join(artifactRoot, 'manifest.json'), 'utf8'));
  if (manifest.id !== 'publishing-manager') {
    throw new Error('manifest.json must describe the publishing-manager plugin.');
  }
  return manifest;
}

async function populateVault(vaultPath, artifactRoot, manifest) {
  const obsidianPath = join(vaultPath, '.obsidian');
  const pluginPath = join(obsidianPath, 'plugins', 'publishing-manager');
  const fixturePath = join(vaultPath, 'Fictional Fixtures');
  await Promise.all([
    mkdir(pluginPath, { recursive: true }),
    mkdir(fixturePath, { recursive: true })
  ]);

  await Promise.all(
    REQUIRED_PLUGIN_ASSETS.map((asset) =>
      copyFile(join(artifactRoot, asset), join(pluginPath, asset))
    )
  );

  await Promise.all([
    writeFile(join(obsidianPath, 'community-plugins.json'), '["publishing-manager"]\n'),
    writeFile(join(obsidianPath, 'app.json'), '{}\n'),
    writeFile(join(vaultPath, '.gitignore'), '*\n!.gitignore\n'),
    writeFile(
      join(vaultPath, '.publishing-manager-test-vault.json'),
      `${JSON.stringify(
        {
          type: 'publishing-manager-disposable-test-vault',
          schema: 1,
          pluginId: manifest.id,
          pluginVersion: manifest.version,
          minimumObsidianVersion: manifest.minAppVersion
        },
        null,
        2
      )}\n`
    ),
    writeFile(
      join(vaultPath, 'README - TEST VAULT.md'),
      '# Publishing Manager disposable test vault\n\nThis vault contains fictional test material only. Do not add personal manuscripts, publishing metadata, credentials, or private vault content. Discard the vault after recording redacted test evidence.\n'
    ),
    writeFile(
      join(fixturePath, 'Start Here.md'),
      '# Fictional fixture workspace\n\nUse this folder only for deterministic Publishing Manager test scenarios. The production record schemas will be introduced separately by DAT-001 and DAT-002.\n'
    )
  ]);
}

export async function createDisposableTestVault({
  artifactRoot = process.cwd(),
  outputPath,
  repositoryRoot = process.cwd()
} = {}) {
  const resolvedArtifactRoot = resolve(artifactRoot);
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const manifest = await validateArtifacts(resolvedArtifactRoot);
  let vaultPath;
  let created = false;

  if (outputPath === undefined) {
    vaultPath = await mkdtemp(join(tmpdir(), 'publishing-manager-test-vault-'));
    created = true;
  } else {
    vaultPath = resolve(outputPath);
    if (isInsideRepository(vaultPath, resolvedRepositoryRoot)) {
      throw new Error('Test-vault output must not be inside the repository.');
    }
    if (await pathExists(vaultPath)) {
      throw new Error('Test-vault output already exists; choose a new empty path.');
    }
    await mkdir(vaultPath, { recursive: false });
    created = true;
  }

  try {
    await populateVault(vaultPath, resolvedArtifactRoot, manifest);
    return vaultPath;
  } catch (error) {
    if (created) await rm(vaultPath, { recursive: true, force: true });
    throw error;
  }
}
