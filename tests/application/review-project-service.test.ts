/** Exercises book/edition scope, chronology, filters, permission evidence, and follow-up editing. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { ReviewProjectService } from '../../src/application/reviews/review-project-service';
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
    return `d0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('review project service', () => {
  it('stores chronological scoped evidence and updates follow-up without losing identity', async () => {
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
    const reviews = new ReviewProjectService(repository, catalog, layout, clock, ids);
    const book = await books.create({
      title: 'Review Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const edition = await editions.create({
      bookId: book.book.id,
      type: 'ebook',
      status: 'active'
    });
    const older = await reviews.create({
      bookId: book.book.id,
      source: 'Fictional Blog',
      date: '2026-07-01',
      rating: '3.5',
      permissionStatus: 'restricted',
      permissionNotes: 'Reference only.',
      followUpStatus: 'none'
    });
    await reviews.create({
      bookId: book.book.id,
      editionId: edition.edition.id,
      source: 'Fictional Journal',
      sourceLink: 'https://example.invalid/review',
      date: '2026-07-18',
      rating: '4.5',
      quote: 'Brief fictional evidence.',
      permissionStatus: 'obtained',
      permissionNotes: 'Fictional permission.',
      followUpDate: '2026-07-25',
      followUpStatus: 'open'
    });

    expect(reviews.reviewsForBook(book.book.id).map(({ fields }) => fields.source)).toEqual([
      'Fictional Journal',
      'Fictional Blog'
    ]);
    expect(
      reviews.reviewsForBook(book.book.id, { minimumRating: 4, permissionStatus: 'obtained' })
    ).toHaveLength(1);
    const updated = await reviews.update(older.id, {
      bookId: book.book.id,
      source: 'Fictional Blog',
      date: '2026-07-01',
      rating: '3.5',
      permissionStatus: 'restricted',
      permissionNotes: 'Reference only.',
      followUpDate: '2026-07-20',
      followUpStatus: 'done'
    });
    expect(updated.id).toBe(older.id);
    expect(updated.fields['follow-up-status']).toBe('done');
  });
});
