/**
 * Exercises PRC-001–PRC-006 through the real repository: canonical creation, conflicts, explicit
 * exchange assumptions, append-only revisions, source preservation, and effective-date history.
 */
import { describe, expect, it } from 'vitest';

import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { PriceProjectService } from '../../src/application/pricing/price-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T12:00:00.000Z');
  }
}
class SequenceIds implements IdGenerator {
  private next = 0;
  public generate(): string {
    this.next += 1;
    return `60000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
  }
}

async function harness() {
  const vault = new MemoryVaultTextPort();
  const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
  const clock = new FixedClock();
  const ids = new SequenceIds();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
  const prices = new PriceProjectService(repository, catalog, layout, clock, ids);
  await catalog.initialize([]);
  const book = await books.create({ title: 'Price Test', primaryLanguage: 'en', status: 'active' });
  const edition = await editions.create({ bookId: book.book.id, type: 'ebook', status: 'active' });
  return { vault, catalog, prices, book, edition };
}

function input(editionId: string, amount = '9.99', from = '2026-07-19') {
  return {
    editionId,
    platform: 'Direct',
    territory: 'GB',
    currency: 'GBP',
    amount,
    taxIncluded: true,
    taxRate: '0',
    effectiveFrom: from,
    source: 'Publisher decision'
  } as const;
}

describe('price project service', () => {
  it('creates one canonical decimal snapshot and rejects an ambiguous effective scope', async () => {
    const { catalog, prices, edition } = await harness();
    const preview = prices.previewCreate(input(edition.edition.id));
    expect(preview.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    const created = await prices.apply(preview);
    expect(created.fields.amount).toBe('9.99');
    expect(catalog.snapshot().prices).toHaveLength(1);
    await expect(prices.apply(prices.previewCreate(input(edition.edition.id)))).rejects.toThrow(
      'already exists'
    );
  });

  it('creates append-only revisions with preserved source linkage and chronological history', async () => {
    const { vault, prices, edition } = await harness();
    const first = await prices.apply(prices.previewCreate(input(edition.edition.id)));
    const second = await prices.apply(
      prices.previewRevision(first.id, input(edition.edition.id, '10.99', '2026-08-01'))
    );
    expect(second.fields['supersedes-price-id']).toBe(first.id);
    expect(prices.history(second).map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(vault.files.size).toBeGreaterThanOrEqual(4);
  });

  it('seeds a reviewed target only from explicit dated local rate evidence', async () => {
    const { prices, edition } = await harness();
    const source = await prices.apply(prices.previewCreate(input(edition.edition.id, '10.00')));
    const seeded = prices.previewSeed(source.id, [
      {
        territory: 'SE',
        currency: 'SEK',
        rate: '10.25',
        rateDate: '2026-07-19',
        rateSource: 'Locally entered planning rate',
        ending: '99'
      }
    ]);
    expect(seeded.rows[0]?.fields.amount).toBe('102.99');
    expect(seeded.rows[0]?.fields.assumption).toMatchObject({
      rate: '10.25',
      rateSource: 'Locally entered planning rate'
    });
    const row = seeded.rows[0];
    if (row === undefined) throw new Error('Seed preview did not contain a row.');
    const record = await prices.apply(row);
    expect(record.fields.currency).toBe('SEK');
  });
});
