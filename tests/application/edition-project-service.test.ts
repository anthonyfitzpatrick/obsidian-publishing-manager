/**
 * Exercises EDN-001–EDN-008 against the real canonical repository and deterministic memory vault.
 * The cases prove stable edition/format records, lossless edits, previewed revision copy warnings,
 * comparison evidence, non-destructive archival, and explicit one-record dependency reassignment.
 */

import { describe, expect, it } from 'vitest';

import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class MutableClock implements Clock {
  public constructor(public instant = '2026-07-18T14:00:00.000Z') {}
  public now(): Date {
    return new Date(this.instant);
  }
}

class SequenceIds implements IdGenerator {
  private next = 1;
  public generate(): string {
    const value = String(this.next).padStart(8, '0');
    this.next += 1;
    return `10000000-0000-4000-8000-${value}`;
  }
}

function createHarness() {
  const vault = new MemoryVaultTextPort();
  const codec = new JsonTestFrontmatterCodec();
  const repository = new VaultManagedRecordRepository(vault, codec);
  const clock = new MutableClock();
  const ids = new SequenceIds();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
  return { vault, codec, repository, clock, catalog, books, editions };
}

async function createBookAndEdition() {
  const harness = createHarness();
  await harness.catalog.initialize([]);
  const book = await harness.books.create({
    title: 'The Fictional Cartographer',
    primaryLanguage: 'en',
    status: 'active'
  });
  const edition = await harness.editions.create({
    bookId: book.book.id,
    type: 'paperback',
    status: 'active',
    publicationDate: '2027-04-15',
    cover: 'Publishing Assets/Covers/cartographer.pdf',
    trimWidth: '5.5',
    trimHeight: '8.5',
    trimUnit: 'in',
    pageCount: 336,
    retailLinks: { storefront: 'https://example.invalid/book' },
    notes: 'Fictional production note.'
  });
  return { ...harness, book, edition };
}

describe('edition project service', () => {
  it('creates canonical edition and format records and advances the next-step projection', async () => {
    const { catalog, editions, edition, book } = await createBookAndEdition();
    expect(edition.path).toContain('Publishing Manager/Editions/');
    expect(edition.edition.bookId).toBe(book.book.id);
    expect(catalog.snapshot().nextMilestone.code).toBe('add-first-format');

    const format = await editions.createFormat({
      editionId: edition.edition.id,
      category: 'print',
      kind: 'print-interior-pdf',
      label: 'Print interior PDF',
      filePath: 'Publishing Assets/Print/cartographer-interior.pdf',
      metadata: { color: 'black-and-white' }
    });

    expect(format.path).toContain('Publishing Manager/Formats/');
    expect(format.format.editionId).toBe(edition.edition.id);
    expect(catalog.snapshot().nextMilestone.code).toBe('manage-editions');
  });

  it('preserves unknown frontmatter and unrelated body prose during complete edition edits', async () => {
    const { vault, codec, editions, edition } = await createBookAndEdition();
    const current = codec.parse(vault.files.get(edition.path) ?? '');
    vault.replaceExternally(
      edition.path,
      codec.serialize({
        frontmatter: { ...current.frontmatter, 'user-extension': { retained: true } },
        body: '# Private edition notes\nKeep this paragraph.\n'
      })
    );

    const saved = await editions.edit(edition.path, {
      status: 'ready',
      publicationDate: '2027-04-16',
      cover: 'Publishing Assets/Covers/cartographer.pdf',
      retailLinks: { storefront: 'https://example.invalid/revised' },
      notes: 'Reviewed.',
      trimWidth: '5.5',
      trimHeight: '8.5',
      trimUnit: 'in',
      pageCount: 340,
      audioMetadata: {}
    });
    const persisted = codec.parse(vault.files.get(edition.path) ?? '');

    expect(saved.edition.status).toBe('ready');
    expect(saved.edition.pageCount).toBe(340);
    expect(persisted.frontmatter['user-extension']).toEqual({ retained: true });
    expect(persisted.body).toBe('# Private edition notes\nKeep this paragraph.\n');
  });

  it('previews selective revision copy and never copies formats or identifier assignments', async () => {
    const { editions, catalog, edition } = await createBookAndEdition();
    await editions.createFormat({
      editionId: edition.edition.id,
      category: 'print',
      kind: 'print-interior-pdf',
      filePath: 'Publishing Assets/Print/source.pdf'
    });
    const preview = await editions.previewRevision(edition.path, {
      publication: false,
      production: true,
      marketing: true,
      notes: false
    });

    expect(preview.nextRevision).toBe(2);
    expect(preview.proposedFields['publication-date']).toBeUndefined();
    expect(preview.proposedFields['page-count']).toBe(336);
    expect(preview.identifierWarning).toContain('ISBN assignments are never copied');
    expect(preview.formatWarning).toContain('not copied automatically');

    const revision = await editions.createRevision(preview);
    expect(revision.edition.id).not.toBe(edition.edition.id);
    expect(revision.edition.revision).toBe(2);
    expect(revision.edition.sourceEditionId).toBe(edition.edition.id);
    expect(catalog.formatsForEdition(revision.edition.id)).toHaveLength(0);
  });

  it('compares production, date, asset, metadata, price, and platform evidence in one table model', async () => {
    const { editions, edition } = await createBookAndEdition();
    const preview = await editions.previewRevision(edition.path, {
      publication: true,
      production: true,
      marketing: false,
      notes: false
    });
    const revision = await editions.createRevision(preview);
    const comparison = editions.compare(edition.edition.id, revision.edition.id);

    expect(new Set(comparison.rows.map(({ group }) => group))).toEqual(
      new Set(['identity', 'dates', 'production', 'assets', 'metadata', 'prices', 'platforms'])
    );
    expect(comparison.rows.find(({ label }) => label === 'Revision')).toMatchObject({
      left: '1',
      right: '2',
      equal: false
    });
  });

  it('archives with dependants retained and reassigns one dependent record explicitly', async () => {
    const { catalog, editions, edition, book } = await createBookAndEdition();
    const format = await editions.createFormat({
      editionId: edition.edition.id,
      category: 'print',
      kind: 'print-interior-pdf'
    });
    const target = await editions.create({
      bookId: book.book.id,
      type: 'hardcover',
      status: 'planned'
    });
    const assessment = editions.assessRemoval(edition.edition.id);
    expect(assessment.canDelete).toBe(false);
    expect(assessment.dependants.map(({ id }) => id)).toContain(format.format.id);

    const archived = await editions.archive(edition.path);
    expect(archived.edition.archivedAt).toBeDefined();
    expect(catalog.formatsForEdition(edition.edition.id)).toHaveLength(1);

    await editions.reassignDependant(format.path, edition.edition.id, target.edition.id);
    expect(catalog.formatsForEdition(edition.edition.id)).toHaveLength(0);
    expect(catalog.formatsForEdition(target.edition.id).map(({ id }) => id)).toEqual([
      format.format.id
    ]);
  });

  it('rejects incompatible format categories before writing a record', async () => {
    const { vault, editions, edition } = await createBookAndEdition();
    const before = vault.files.size;
    await expect(
      editions.createFormat({
        editionId: edition.edition.id,
        category: 'audio',
        kind: 'm4b'
      })
    ).rejects.toMatchObject({ code: 'edition-format-incompatible' });
    expect(vault.files.size).toBe(before);
  });

});
