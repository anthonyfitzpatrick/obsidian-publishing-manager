/**
 * Protects DAT-003, DAT-009, and DAT-010. The scenarios exercise hostile/ambiguous paths,
 * collision-safe human filenames, duplicate stable identities, deterministic query ordering, and
 * explicit cache staleness without touching canonical data.
 */

import { describe, expect, it } from 'vitest';

import {
  DerivedRecordIndex,
  type DerivedRecordIndexEntry
} from '../../src/domain/storage/derived-record-index';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';

describe('vault path normalization', () => {
  it.each([
    '../outside.md',
    '/absolute.md',
    'C:/windows.md',
    'https:example.md',
    'two//parts.md',
    'folder/ spaced.md',
    'back\\slash.md'
  ])('rejects unsafe or ambiguous target %s', (input) => {
    expect(() => normalizeVaultPath(input)).toThrow();
  });

  it('normalizes Unicode but keeps the path vault-relative', () => {
    expect(normalizeVaultPath('Publishing Manager/Cafe\u0301.md')).toBe(
      'Publishing Manager/Café.md'
    );
  });
});

describe('managed folder layout', () => {
  it('uses configured folders and deterministic collision suffixes', () => {
    const layout = new ManagedFolderLayout({
      root: 'Publishing Manager',
      folders: { book: 'Catalog/Books' }
    });
    const existing = new Set([
      'Publishing Manager/Catalog/Books/the-glass-harbour.md',
      'Publishing Manager/Catalog/Books/the-glass-harbour-2.md'
    ]);

    expect(layout.collisionSafePath('book', 'The Glass Harbour', existing)).toBe(
      'Publishing Manager/Catalog/Books/the-glass-harbour-3.md'
    );
  });
});

describe('derived record index', () => {
  it('detects duplicate IDs, sorts queries, and invalidates changed fingerprints', () => {
    const index = new DerivedRecordIndex();
    const entries: DerivedRecordIndexEntry[] = [
      entry('pm-book-duplicate', 'Publishing Manager/Books/z.md', 'src-z'),
      entry('pm-book-duplicate', 'Publishing Manager/Books/a.md', 'src-a'),
      entry('pm-book-unique', 'Publishing Manager/Books/m.md', 'src-m')
    ];
    index.rebuild(entries);

    expect(index.findByType('book').map(({ path }) => path)).toEqual([
      'Publishing Manager/Books/a.md',
      'Publishing Manager/Books/m.md',
      'Publishing Manager/Books/z.md'
    ]);
    expect(index.findDuplicateIdentities()).toEqual([
      {
        id: 'pm-book-duplicate',
        paths: ['Publishing Manager/Books/a.md', 'Publishing Manager/Books/z.md']
      }
    ]);
    expect(
      index.isStale(normalizeVaultPath('Publishing Manager/Books/m.md'), 'schema-v1', 'src-m')
    ).toBe(false);
    expect(
      index.isStale(normalizeVaultPath('Publishing Manager/Books/m.md'), 'schema-v2', 'src-m')
    ).toBe(true);
  });
});

/** Produces a concise book projection so assertions emphasize index behavior. */
function entry(id: string, path: string, sourceFingerprint: string): DerivedRecordIndexEntry {
  return {
    id,
    type: 'book',
    path: normalizeVaultPath(path),
    schemaVersion: 1,
    schemaFingerprint: 'schema-v1',
    sourceFingerprint
  };
}
