/** Exercises EXP planning, privacy, relationships, every table, collision safety, and exact writes. */
import { describe, expect, it } from 'vitest';
import { AssetReferenceService } from '../../src/application/assets/asset-reference-service';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { CalendarProjectService } from '../../src/application/calendar/calendar-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { PublishingExportService } from '../../src/application/exports/publishing-export-service';
import { ReadinessProjectService } from '../../src/application/readiness/readiness-project-service';
import { SalesProjectService } from '../../src/application/sales/sales-project-service';
import { WorkflowProjectService } from '../../src/application/workflows/workflow-project-service';
import type {
  ContentFingerprintPort,
  VaultAssetPort
} from '../../src/application/storage/record-storage-ports';
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
    return `e0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

const files: VaultAssetPort = {
  async inspect() {
    return { exists: true, modifiedTime: '2026-07-18T12:00:00.000Z', size: 4096 };
  },
  async readBinary() {
    throw new Error('Export tests must never read binary content.');
  }
};

const fingerprints: ContentFingerprintPort = {
  async sha256() {
    throw new Error('Export tests must never fingerprint binary content.');
  }
};

async function project() {
  const vault = new MemoryVaultTextPort();
  const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
  const clock = new FixedClock();
  const ids = new Ids();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  await catalog.initialize([]);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const book = await books.create({
    title: 'Fictional Export',
    primaryLanguage: 'en',
    status: 'active',
    summary: 'A fictional test project.'
  });
  const assets = new AssetReferenceService(
    repository,
    catalog,
    layout,
    files,
    fingerprints,
    clock,
    ids
  );
  await assets.link({
    bookId: book.book.id,
    path: 'Production/Fictional Cover.png',
    role: 'media-image',
    notes: 'Private production note.'
  });
  const workflows = new WorkflowProjectService(repository, catalog, layout, clock, ids);
  const workflow = await workflows.instantiateDefault(book.book.id);
  await workflows.createTask({
    workflowId: workflow.workflow.id,
    stageId: workflow.workflow.stages.items[0]!.id,
    title: 'Final proof',
    deadline: '2026-08-31',
    notes: 'Private task instruction.'
  });
  const readiness = new ReadinessProjectService(repository, catalog, layout, assets, clock, ids);
  const sales = new SalesProjectService(repository, catalog, layout, clock, ids);
  const calendar = new CalendarProjectService(catalog, workflows, vault, layout, clock);
  const exports = new PublishingExportService(
    catalog,
    repository,
    readiness,
    sales,
    calendar,
    vault,
    layout,
    clock
  );
  return { vault, books, book, exports };
}

describe('publishing export service', () => {
  it('previews and writes exact Markdown, JSON, ICS, and every CSV table without binary reads', async () => {
    const { vault, book, exports } = await project();
    const markdown = await exports.preview({
      bookId: book.book.id,
      format: 'markdown',
      includeSensitive: false
    });
    expect(markdown.content).toContain('# Publishing dossier — Fictional Export');
    expect(markdown.content).toContain('## Readiness');
    expect(markdown.linkedBinaryAssets).toEqual(['Production/Fictional Cover.png']);
    expect(markdown.warnings.join(' ')).toContain('no binary bytes');

    const json = await exports.preview({
      bookId: book.book.id,
      format: 'json',
      includeSensitive: false
    });
    expect(json.content).toContain('publishing-manager-project-export');
    expect(json.content).not.toContain('Private production note');
    expect(json.content).not.toContain('Private task instruction');
    expect(json.sensitiveFields.some((path) => path.endsWith('.notes'))).toBe(true);
    expect(json.overwriteBehavior).toBe('never');
    const path = await exports.apply(json);
    expect(await vault.read(path)).toBe(json.content);

    const included = await exports.preview({
      bookId: book.book.id,
      format: 'json',
      includeSensitive: true
    });
    expect(included.content).toContain('Private task instruction');
    expect(included.warnings.join(' ')).toContain('included by explicit choice');

    const ics = await exports.preview({
      bookId: book.book.id,
      format: 'ics',
      includeSensitive: false
    });
    expect(ics.content).toContain('DTSTART;VALUE=DATE:20260831');
    expect(ics.content).toContain(`X-PM-SCOPE:book:${book.book.id}`);

    for (const csvDataset of exports.csvDatasets) {
      const csv = await exports.preview({
        bookId: book.book.id,
        format: 'csv',
        csvDataset,
        includeSensitive: false
      });
      expect(csv.content).toContain('generator-version,export-schema-version,generated-at');
      expect(csv.target).toContain(csvDataset);
    }
  });

  it('selects collision-safe names and rejects target races or stale canonical data', async () => {
    const { vault, books, book, exports } = await project();
    const first = await exports.preview({
      bookId: book.book.id,
      format: 'json',
      includeSensitive: false
    });
    await exports.apply(first);
    const second = await exports.preview({
      bookId: book.book.id,
      format: 'json',
      includeSensitive: false
    });
    expect(second.collisionDetected).toBe(true);
    expect(second.target).not.toBe(first.target);
    await vault.create(second.target, 'another writer');
    await expect(exports.apply(second)).rejects.toThrow('never overwrite');
    expect(await vault.read(second.target)).toBe('another writer');

    const stale = await exports.preview({
      bookId: book.book.id,
      format: 'markdown',
      includeSensitive: false
    });
    await books.edit(book.path, { summary: 'Changed after preview.' });
    await expect(exports.apply(stale)).rejects.toThrow('changed after preview');
    expect(vault.files.has(stale.target)).toBe(false);
  });
});
