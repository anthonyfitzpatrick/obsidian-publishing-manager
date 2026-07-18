/**
 * Exercises the complete BOOK-001–BOOK-007 application lifecycle against the real repository and
 * deterministic in-memory vault. The cases prove stable reload identity, lossless edits, explicit
 * series ordering, non-destructive archival, recent activity, and next-publishing-step summaries.
 */

import { describe, expect, it } from 'vitest';

import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class MutableClock implements Clock {
  public constructor(public instant = '2026-07-18T10:00:00.000Z') {}
  public now(): Date {
    return new Date(this.instant);
  }
}

class SequenceIds implements IdGenerator {
  private next = 1;
  public generate(): string {
    const value = String(this.next).padStart(8, '0');
    this.next += 1;
    return `00000000-0000-4000-8000-${value}`;
  }
}

function createHarness() {
  const vault = new MemoryVaultTextPort();
  const codec = new JsonTestFrontmatterCodec();
  const repository = new VaultManagedRecordRepository(vault, codec);
  const clock = new MutableClock();
  const catalog = new BookCatalog(repository, clock);
  const service = new BookProjectService(
    repository,
    catalog,
    new ManagedFolderLayout({ root: 'Publishing Manager' }),
    clock,
    new SequenceIds()
  );
  return { vault, codec, repository, clock, catalog, service };
}

describe('book project service', () => {
  it('creates collision-safe books and reopens the same stable identity after catalog reload', async () => {
    const { catalog, service } = createHarness();
    await catalog.initialize([]);

    const first = await service.create({
      title: 'The Fictional Meridian',
      primaryLanguage: 'en',
      status: 'planned'
    });
    const second = await service.create({
      title: 'The Fictional Meridian',
      primaryLanguage: 'sv',
      status: 'active'
    });
    await catalog.initialize([first.path, second.path]);
    const reopened = await service.reopen(first.path);

    expect(first.path).toBe('Publishing Manager/Books/the-fictional-meridian.md');
    expect(second.path).toBe('Publishing Manager/Books/the-fictional-meridian-2.md');
    expect(reopened.book.id).toBe(first.book.id);
    expect(catalog.snapshot().books).toHaveLength(2);
  });

  it('edits validated fields while preserving unknown frontmatter and unrelated body text', async () => {
    const { vault, codec, catalog, service } = createHarness();
    await catalog.initialize([]);
    const created = await service.create({
      title: 'Quiet Orbit',
      primaryLanguage: 'en',
      status: 'planned'
    });
    const current = codec.parse(vault.files.get(created.path) ?? '');
    vault.replaceExternally(
      created.path,
      codec.serialize({
        frontmatter: { ...current.frontmatter, 'user-extension': { retained: true } },
        body: '# Private publishing notes\nKeep this paragraph.\n'
      })
    );

    const edited = await service.edit(created.path, {
      title: 'Quiet Orbit Revised',
      status: 'active',
      summary: 'A revised fictional summary.'
    });
    const persisted = codec.parse(vault.files.get(created.path) ?? '');

    expect(edited.book.title).toBe('Quiet Orbit Revised');
    expect(persisted.frontmatter['user-extension']).toEqual({ retained: true });
    expect(persisted.body).toBe('# Private publishing notes\nKeep this paragraph.\n');
  });

  it('creates resolvable series membership and orders books by unique explicit position', async () => {
    const { catalog, service } = createHarness();
    await catalog.initialize([]);
    const seriesId = await service.createSeries('Rosewind Test Series');
    const first = await service.create({
      title: 'Second Book',
      primaryLanguage: 'en',
      status: 'active'
    });
    const second = await service.create({
      title: 'First Book',
      primaryLanguage: 'en',
      status: 'active'
    });
    await service.assignSeries(first.path, seriesId, 2);
    await service.assignSeries(second.path, seriesId, 1);

    expect(catalog.orderedBooks(seriesId).map(({ fields }) => fields.title)).toEqual([
      'First Book',
      'Second Book'
    ]);
    await expect(service.assignSeries(first.path, seriesId, 1)).rejects.toMatchObject({
      code: 'series-position-occupied'
    });
  });

  it('archives and restores without deletion while updating activity and next milestone', async () => {
    const { vault, catalog, service, clock } = createHarness();
    await catalog.initialize([]);
    const created = await service.create({
      title: 'Archive Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    clock.instant = '2026-07-18T11:00:00.000Z';
    const archived = await service.archive(created.path);
    expect(archived.book.archivedAt).toBe(clock.instant);
    expect(vault.files.has(created.path)).toBe(true);
    expect(catalog.snapshot().nextMilestone.code).toBe('create-first-book');

    clock.instant = '2026-07-18T12:00:00.000Z';
    const restored = await service.restore(created.path);
    expect(restored.book.archivedAt).toBeUndefined();
    expect(catalog.snapshot().nextMilestone.code).toBe('add-first-edition');
    expect(
      catalog
        .snapshot()
        .recentActivity.map(({ action }) => action)
        .slice(0, 3)
    ).toEqual(['restored', 'archived', 'created']);
  });

  it('rejects invalid edits before writing any vault change', async () => {
    const { vault, catalog, service } = createHarness();
    await catalog.initialize([]);
    const created = await service.create({
      title: 'Valid Title',
      primaryLanguage: 'en',
      status: 'active'
    });
    const before = vault.files.get(created.path);

    await expect(service.edit(created.path, { title: '  invalid  ' })).rejects.toMatchObject({
      code: 'book-invalid'
    });
    expect(vault.files.get(created.path)).toBe(before);
  });
});
