/**
 * Exercises MET-001–MET-004 and MET-006 through the real lossless repository and disposable
 * catalog. It proves book defaults, explicit edition overrides, inheritance restoration, profile
 * coverage, and source-preserving exports survive canonical record writes.
 */
import { describe, expect, it } from 'vitest';

import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { MetadataProjectService } from '../../src/application/metadata/metadata-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T09:00:00.000Z');
  }
}
class SequenceIds implements IdGenerator {
  private next = 0;
  public generate(): string {
    this.next += 1;
    return `40000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
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
  const metadata = new MetadataProjectService(repository, catalog, layout, clock, ids);
  await catalog.initialize([]);
  const book = await books.create({
    title: 'Metadata Test',
    primaryLanguage: 'en',
    status: 'active'
  });
  const edition = await editions.create({
    bookId: book.book.id,
    type: 'ebook',
    status: 'active'
  });
  return { vault, catalog, metadata, book, edition };
}

describe('metadata project service', () => {
  it('creates book defaults and edition overrides with exact provenance', async () => {
    const { catalog, metadata, book, edition } = await harness();
    await metadata.saveBookValues(book.book.id, {
      title: 'Metadata Test',
      subtitle: 'Inherited subtitle',
      language: 'en',
      publisher: 'Fictional Press',
      copyright: '© 2026 Fictional Press',
      contributors: [{ name: 'A. Writer', role: 'Author' }],
      'long-description-markdown': '**Long** description.'
    });
    await metadata.saveEditionOverrides(edition.edition.id, {
      subtitle: 'Ebook subtitle',
      'edition-statement': 'First ebook edition'
    });
    const resolved = metadata.resolve(book.book.id, edition.edition.id);
    expect(resolved.effective.fields.subtitle).toMatchObject({
      value: 'Ebook subtitle',
      source: 'edition'
    });
    expect(resolved.effective.fields.publisher.source).toBe('book');
    expect(resolved.coverage.complete).toBe(true);
    expect(catalog.snapshot().metadataSets).toHaveLength(2);
  });

  it('clears one override without erasing its book value and exports plain text', async () => {
    const { metadata, book, edition } = await harness();
    await metadata.saveBookValues(book.book.id, {
      subtitle: 'Inherited subtitle',
      'long-description-markdown': '# Heading\nA **bold** description.'
    });
    await metadata.saveEditionOverrides(edition.edition.id, { subtitle: 'Override' });
    await metadata.clearEditionOverride(edition.edition.id, 'subtitle');
    expect(
      metadata.resolve(book.book.id, edition.edition.id).effective.fields.subtitle
    ).toMatchObject({
      value: 'Inherited subtitle',
      source: 'book'
    });
    expect(
      metadata.exportDescription(book.book.id, edition.edition.id, 'long-description-markdown')
    ).toBe('Heading\nA bold description.');
  });
});
