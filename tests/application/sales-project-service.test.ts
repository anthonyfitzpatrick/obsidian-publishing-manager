/** Exercises direct entry, attribution, duplicate/overlap handling, corrections, and aggregates. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { DistributionProjectService } from '../../src/application/distribution/distribution-project-service';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { IsbnProjectService } from '../../src/application/isbn/isbn-project-service';
import { SalesProjectService } from '../../src/application/sales/sales-project-service';
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
    return `a0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}
describe('sales project service', () => {
  it('keeps one attributed immutable ledger and currency-safe corrected aggregates', async () => {
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
    const isbnService = new IsbnProjectService(repository, catalog, layout, clock, ids);
    const distribution = new DistributionProjectService(repository, catalog, layout, clock, ids);
    const sales = new SalesProjectService(repository, catalog, layout, clock, ids);
    const book = await books.create({
      title: 'Sales Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const edition = await editions.create({
      bookId: book.book.id,
      type: 'ebook',
      status: 'active'
    });
    const [isbn] = await isbnService.applyImport('9780306406157');
    if (!isbn) throw new Error('ISBN missing');
    await isbnService.applyTransaction(
      isbnService.previewTransaction({
        recordId: isbn.id,
        action: 'assign',
        editionId: edition.edition.id
      })
    );
    await distribution.installBundledProfiles();
    const profile = distribution.profiles()[0];
    if (!profile) throw new Error('Profile missing');
    const target = await distribution.saveTarget({
      editionId: edition.edition.id,
      profileId: profile.id,
      territory: 'GB',
      publicationLocation: 'fictional-store',
      intent: true,
      metadataReady: true,
      assetsReady: true,
      pricingReady: true,
      reviewState: 'approved',
      publicationState: 'published',
      checklist: []
    });
    const [source] = await sales.installSourcePresets();
    if (!source) throw new Error('Source missing');
    const input = {
      sourceId: source.id,
      isbn: '978-0-306-40615-7',
      platformTargetId: target.id,
      country: 'gb',
      kind: 'period-summary' as const,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      units: 10,
      returns: 1,
      currency: 'gbp',
      money: { proceeds: '12.50' }
    };
    const line = await sales.record(input);
    await expect(sales.record(input)).rejects.toThrow('Exact duplicate');
    const overlap = {
      ...input,
      startDate: '2026-07-15',
      endDate: '2026-08-15',
      units: 3,
      returns: 0
    };
    expect(sales.preview(overlap).overlappingIds).toEqual([line.id]);
    await expect(sales.record(overlap)).rejects.toThrow('explicit acceptance');
    await sales.record(overlap, true);
    await sales.correct({
      lineId: line.id,
      kind: 'return',
      reason: 'Fictional return.',
      ownerLabel: 'Sales owner',
      adjustment: { returns: 1, proceeds: '-1.25' }
    });
    expect(sales.aggregates(book.book.id)).toEqual([
      expect.objectContaining({
        currency: 'GBP',
        units: 13,
        returns: 2,
        netUnits: 11,
        proceeds: '23.75'
      })
    ]);
    const page = sales.queryPage({ bookId: book.book.id }, 0, 1);
    expect(page.total).toBe(2);
    expect(page.lines).toHaveLength(1);
    const analyticsPage = sales.analytics({ bookId: book.book.id }, { offset: 0, limit: 1 });
    expect(analyticsPage.lineCount).toBe(2);
    expect(analyticsPage.lines).toHaveLength(1);
    const [aggregatePage] = sales.aggregates({ bookId: book.book.id }, { offset: 0, limit: 1 });
    expect(aggregatePage?.lineCount).toBe(2);
    expect(aggregatePage?.lines).toHaveLength(1);
    expect(sales.corrections(line.id)).toHaveLength(1);
  });
});
