/**
 * Proves BOOK-004 and BOOK-008 catalog behavior against authoritative record text. Tests cover
 * incremental external modification, rename/delete reconciliation, malformed/future schemas,
 * duplicate stable identities, unresolved series links, and deterministic repair guidance.
 */

import { describe, expect, it } from 'vitest';

import { BookCatalog } from '../../src/application/catalog/book-catalog';
import type { Clock } from '../../src/domain/foundation/clock';
import { serializeEnvelope } from '../../src/domain/records/record-envelope';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

const clock: Clock = { now: () => new Date('2026-07-18T10:00:00.000Z') };

function bookSource(
  codec: JsonTestFrontmatterCodec,
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
  schema = 1
): string {
  return codec.serialize({
    frontmatter: {
      title: 'Catalog Test Book',
      status: 'active',
      'primary-language': 'en',
      ...overrides,
      ...serializeEnvelope({
        pmId: id,
        pmType: 'book',
        pmSchema: schema,
        createdAt: '2026-07-18T09:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z'
      })
    },
    body: ''
  });
}

describe('book catalog', () => {
  it('incrementally reconciles external modify, rename, and delete events', async () => {
    const vault = new MemoryVaultTextPort();
    const codec = new JsonTestFrontmatterCodec();
    const repository = new VaultManagedRecordRepository(vault, codec);
    const catalog = new BookCatalog(repository, clock);
    const oldPath = normalizeVaultPath('Publishing Manager/Books/catalog-test.md');
    const newPath = normalizeVaultPath('Publishing Manager/Books/renamed-by-user.md');
    vault.files.set(oldPath, bookSource(codec, 'pm-book-catalog-0001'));
    await catalog.initialize([oldPath]);

    vault.files.set(
      oldPath,
      bookSource(codec, 'pm-book-catalog-0001', { title: 'Externally Revised' })
    );
    await catalog.reconcile(oldPath, 'modified');
    vault.files.set(newPath, vault.files.get(oldPath) ?? '');
    vault.files.delete(oldPath);
    await catalog.rename(oldPath, newPath);
    vault.files.delete(newPath);
    catalog.remove(newPath);

    expect(catalog.snapshot().books).toHaveLength(0);
    expect(catalog.snapshot().recentActivity.map(({ action }) => action)).toEqual([
      'deleted',
      'renamed',
      'modified'
    ]);
  });

  it('surfaces malformed, future, duplicate, and unresolved records with actionable codes', async () => {
    const vault = new MemoryVaultTextPort();
    const codec = new JsonTestFrontmatterCodec();
    const repository = new VaultManagedRecordRepository(vault, codec);
    const catalog = new BookCatalog(repository, clock);
    const malformed = normalizeVaultPath('Publishing Manager/Books/malformed.md');
    const future = normalizeVaultPath('Publishing Manager/Books/future.md');
    const duplicateA = normalizeVaultPath('Publishing Manager/Books/duplicate-a.md');
    const duplicateB = normalizeVaultPath('Publishing Manager/Books/duplicate-b.md');
    const unresolved = normalizeVaultPath('Publishing Manager/Books/unresolved.md');
    vault.files.set(malformed, 'not frontmatter');
    vault.files.set(future, bookSource(codec, 'pm-book-future-0001', {}, 99));
    vault.files.set(duplicateA, bookSource(codec, 'pm-book-duplicate-0001'));
    vault.files.set(duplicateB, bookSource(codec, 'pm-book-duplicate-0001'));
    vault.files.set(
      unresolved,
      bookSource(codec, 'pm-book-unresolved-0001', {
        'series-id': 'pm-series-missing-0001',
        'series-position': 1
      })
    );

    await catalog.initialize([malformed, future, duplicateA, duplicateB, unresolved]);
    const snapshot = catalog.snapshot();
    const codes = new Set(snapshot.diagnostics.map(({ code }) => code));

    expect(codes).toEqual(
      new Set([
        'catalog.malformed-frontmatter',
        'catalog.unsupported-future-schema',
        'catalog.duplicate-id',
        'catalog.unresolved-link'
      ])
    );
    expect(snapshot.diagnostics.every(({ suggestedAction }) => suggestedAction.length > 20)).toBe(
      true
    );
    expect(snapshot.nextMilestone.code).toBe('repair-catalog');
  });
});
