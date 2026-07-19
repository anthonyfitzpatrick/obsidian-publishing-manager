import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Models Obsidian uninstall separation in a disposable fictional vault: plugin installation files
 * are removed while canonical Markdown and referenced user assets remain byte-identical. The test
 * never points at a real vault and validates its temporary root before cleanup.
 */
const root = await mkdtemp(path.join(tmpdir(), 'publishing-manager-lifecycle-'));
const pluginDirectory = path.join(root, '.obsidian', 'plugins', 'publishing-manager');
const projectDirectory = path.join(root, 'Publishing Manager', 'Books');
const assetDirectory = path.join(root, 'Production Assets');
const project = path.join(projectDirectory, 'fictional-book.md');
const asset = path.join(assetDirectory, 'fictional-cover.txt');

try {
  await mkdir(pluginDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(path.join(pluginDirectory, 'main.js'), 'fictional plugin installation\n');
  await writeFile(
    project,
    '---\npm-id: pm-book-fictional-0001\npm-type: book\n---\n# Fictional book\n'
  );
  await writeFile(asset, 'fictional referenced asset bytes\n');
  const before = await fingerprints([project, asset]);

  await rm(pluginDirectory, { recursive: true });

  const after = await fingerprints([project, asset]);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Canonical project or referenced asset changed during uninstall simulation.');
  process.stdout.write(
    'Disable/uninstall preservation check passed: canonical Markdown and referenced assets remained byte-identical.\n'
  );
} finally {
  const prefix = path.join(tmpdir(), 'publishing-manager-lifecycle-');
  if (!root.startsWith(prefix))
    throw new Error(`Refusing to clean unexpected lifecycle test root ${JSON.stringify(root)}.`);
  await rm(root, { recursive: true, force: true });
}

async function fingerprints(files) {
  return Promise.all(
    files.map(async (file) => ({
      file: path.basename(file),
      sha256: createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    }))
  );
}
