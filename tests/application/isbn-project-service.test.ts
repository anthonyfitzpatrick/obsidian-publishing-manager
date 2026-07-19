/**
 * Exercises ISBN-001–ISBN-006 through the real lossless repository. The suite proves row-level
 * import evidence, duplicate protection, preview-before-write lifecycle changes, scoped assignment,
 * release rules, publication immutability, and correction history in canonical Markdown records.
 */
import { describe, expect, it } from 'vitest';

import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import { IsbnProjectService } from '../../src/application/isbn/isbn-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class MutableClock implements Clock {
  public constructor(public instant = '2026-07-19T09:00:00.000Z') {}
  public now(): Date {
    return new Date(this.instant);
  }
}

class SequenceIds implements IdGenerator {
  private next = 0;
  public generate(): string {
    this.next += 1;
    return `50000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
  }
}

async function harness() {
  const vault = new MemoryVaultTextPort();
  const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
  const clock = new MutableClock();
  const ids = new SequenceIds();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
  const isbns = new IsbnProjectService(repository, catalog, layout, clock, ids);
  await catalog.initialize([]);
  const book = await books.create({
    title: 'Identifier Test',
    primaryLanguage: 'en',
    status: 'active'
  });
  const edition = await editions.create({
    bookId: book.book.id,
    type: 'paperback',
    status: 'active'
  });
  const format = await editions.createFormat({
    editionId: edition.edition.id,
    category: 'print',
    kind: 'print-interior-pdf',
    label: 'Paperback interior'
  });
  return { vault, catalog, clock, isbns, edition, format };
}

describe('ISBN project service', () => {
  it('previews imports per row and creates only valid unique ISBN records', async () => {
    const { catalog, isbns } = await harness();
    const source = '0-306-40615-2\n9780306406157\n9780306406158\n978-1-4028-9462-6';
    const preview = isbns.previewImport(source);
    expect(preview.rows.map(({ status }) => status)).toEqual([
      'ready',
      'duplicate-file',
      'invalid',
      'ready'
    ]);
    expect(preview.ready).toBe(2);
    await isbns.applyImport(source, { publisher: 'Fictional Press' });
    expect(catalog.snapshot().isbns).toHaveLength(2);
    expect(isbns.previewImport('9780306406157').rows[0]?.status).toBe('duplicate-pool');
  });

  it('reserves, assigns, releases, and republishes only through reviewed transactions', async () => {
    const { catalog, isbns, edition, format } = await harness();
    const [record] = await isbns.applyImport('9780306406157');
    if (record === undefined) throw new Error('Test ISBN was not created.');
    const reserve = isbns.previewTransaction({
      recordId: record.id,
      action: 'reserve',
      editionId: edition.edition.id,
      formatId: format.format.id
    });
    expect(reserve.after.status).toBe('reserved');
    await isbns.applyTransaction(reserve);
    const assign = isbns.previewTransaction({
      recordId: record.id,
      action: 'assign',
      editionId: edition.edition.id
    });
    expect(assign.after['format-id']).toBeUndefined();
    await isbns.applyTransaction(assign);
    const release = isbns.previewTransaction({ recordId: record.id, action: 'release' });
    expect(release.after).not.toHaveProperty('edition-id');
    await isbns.applyTransaction(release);
    expect(catalog.snapshot().diagnostics).toEqual([]);
    expect(isbns.records()[0]?.fields.status).toBe('available');
  });

  it('prevents assignment conflicts and never releases a published identifier', async () => {
    const { isbns, edition, format } = await harness();
    const records = await isbns.applyImport('9780306406157\n9781402894626');
    const first = records[0];
    const second = records[1];
    if (first === undefined || second === undefined)
      throw new Error('Test ISBNs were not created.');
    await isbns.applyTransaction(
      isbns.previewTransaction({
        recordId: first.id,
        action: 'assign',
        editionId: edition.edition.id,
        formatId: format.format.id
      })
    );
    expect(() =>
      isbns.previewTransaction({
        recordId: second.id,
        action: 'reserve',
        editionId: edition.edition.id,
        formatId: format.format.id
      })
    ).toThrow('already occupies');
    await isbns.applyTransaction(
      isbns.previewTransaction({ recordId: first.id, action: 'publish' })
    );
    expect(() => isbns.previewTransaction({ recordId: first.id, action: 'release' })).toThrow(
      'Only a reserved or unpublished assigned ISBN can be released'
    );
  });

  it('retires a published correction and preserves its former assignment evidence', async () => {
    const { isbns, edition } = await harness();
    const [record] = await isbns.applyImport('9780306406157');
    if (record === undefined) throw new Error('Test ISBN was not created.');
    await isbns.applyTransaction(
      isbns.previewTransaction({
        recordId: record.id,
        action: 'assign',
        editionId: edition.edition.id
      })
    );
    await isbns.applyTransaction(
      isbns.previewTransaction({ recordId: record.id, action: 'publish' })
    );
    const correction = isbns.previewTransaction({
      recordId: record.id,
      action: 'correct',
      reason: 'Distributor reported the identifier was attached to the wrong edition.'
    });
    await isbns.applyTransaction(correction);
    const corrected = isbns.records()[0];
    expect(corrected?.fields.status).toBe('retired');
    expect(corrected?.fields).not.toHaveProperty('edition-id');
    expect(corrected?.fields.corrections).toEqual({
      entries: [
        expect.objectContaining({ editionId: edition.edition.id, previousStatus: 'published' })
      ]
    });
  });
});
