/** Exercises bundled profiles and one fully linked manual target through canonical storage. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { DistributionProjectService } from '../../src/application/distribution/distribution-project-service';
import { EditionProjectService } from '../../src/application/editions/edition-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';
class FixedClock implements Clock {
  now() {
    return new Date('2026-07-19T12:00:00Z');
  }
}
class Ids implements IdGenerator {
  private n = 0;
  generate() {
    return `70000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}
describe('distribution project service', () => {
  it('installs twelve versioned profiles once and creates manual readiness evidence', async () => {
    const repository = new VaultManagedRecordRepository(
      new MemoryVaultTextPort(),
      new JsonTestFrontmatterCodec()
    );
    const clock = new FixedClock();
    const ids = new Ids();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
    const service = new DistributionProjectService(repository, catalog, layout, clock, ids);
    await catalog.initialize([]);
    const book = await books.create({
      title: 'Distribution Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const edition = await editions.create({
      bookId: book.book.id,
      type: 'ebook',
      status: 'active'
    });
    expect(await service.installBundledProfiles()).toHaveLength(12);
    expect(await service.installBundledProfiles()).toHaveLength(0);
    const profile = service.profiles()[0];
    if (!profile) throw new Error('Profile missing');
    const target = await service.saveTarget({
      editionId: edition.edition.id,
      profileId: profile.id,
      territory: 'gb',
      publicationLocation: 'fictional-storefront',
      intent: true,
      metadataReady: true,
      assetsReady: true,
      pricingReady: true,
      reviewState: 'not-submitted',
      publicationState: 'not-planned',
      checklist: [{ label: 'Manual portal review', done: true }]
    });
    expect(service.readiness(target).ready).toBe(true);
    expect(catalog.snapshot().platformTargets).toHaveLength(1);
  });
});
