/** Exercises canonical input collection and persistent audited overrides without a real vault. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { ReadinessProjectService } from '../../src/application/readiness/readiness-project-service';
import type { AssetReferenceService } from '../../src/application/assets/asset-reference-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now() {
    return new Date('2026-07-19T12:00:00.000Z');
  }
}
class Ids implements IdGenerator {
  private n = 0;
  public generate() {
    return `90000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('readiness project service', () => {
  it('evaluates canonical missing evidence and persists a qualified override', async () => {
    const repository = new VaultManagedRecordRepository(
      new MemoryVaultTextPort(),
      new JsonTestFrontmatterCodec()
    );
    const clock = new FixedClock();
    const ids = new Ids();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    await catalog.initialize([]);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
    const book = await books.create({
      title: 'Readiness Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const edition = await editions.create({
      bookId: book.book.id,
      type: 'paperback',
      status: 'active',
      trimWidth: '5.5',
      trimHeight: '8.5',
      trimUnit: 'in',
      pageCount: 300
    });
    // No asset records exist, so the narrow service is never called in this fixture.
    const assets = {
      inspect: async () => {
        throw new Error('Unexpected inspection');
      }
    } as unknown as AssetReferenceService;
    const service = new ReadinessProjectService(repository, catalog, layout, assets, clock, ids);
    const initial = await service.evaluateBook(book.book.id, edition.edition.id);
    expect(initial.state).toBe('not-ready');
    await service.createOverride({
      ruleCode: 'CORE.COVER',
      scope: initial.scope,
      reason: 'Fictional proof exception.',
      ownerLabel: 'Release owner'
    });
    const next = await service.evaluateBook(book.book.id, edition.edition.id);
    expect(catalog.recordsOfType('readiness-override')).toHaveLength(1);
    expect(next.results.find(({ code }) => code === 'CORE.COVER')?.override).toMatchObject({
      qualified: true
    });
    expect(next.results.find(({ code }) => code === 'CORE.COVER')?.state).toBe('fail');
  });
});
