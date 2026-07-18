/** Exercises AST-001–AST-008 through the real record repository and deterministic host doubles. */
import { describe, expect, it } from 'vitest';
import { AssetReferenceService } from '../../src/application/assets/asset-reference-service';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import type {
  ContentFingerprintPort,
  VaultAssetEvidence,
  VaultAssetPort
} from '../../src/application/storage/record-storage-ports';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import {
  ManualCancellationToken,
  NeverCancelledToken
} from '../../src/domain/foundation/cancellation';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import type { VaultPath } from '../../src/domain/storage/vault-path';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-18T12:00:00.000Z');
  }
}
class SequenceIds implements IdGenerator {
  private value = 0;
  public generate(): string {
    this.value += 1;
    return `00000000-0000-4000-8000-${String(this.value).padStart(12, '0')}`;
  }
}
class MemoryAssets implements VaultAssetPort {
  public readonly files = new Map<
    VaultPath,
    { evidence: VaultAssetEvidence; content: ArrayBuffer }
  >();
  public binaryReads = 0;
  public async inspect(path: VaultPath): Promise<VaultAssetEvidence> {
    return this.files.get(path)?.evidence ?? { exists: false };
  }
  public async readBinary(path: VaultPath): Promise<ArrayBuffer> {
    this.binaryReads += 1;
    const file = this.files.get(path);
    if (file === undefined) throw new Error('missing');
    return file.content;
  }
  public add(path: string, modifiedTime = '2026-07-18T10:00:00.000Z', size = 4): void {
    this.files.set(normalizeVaultPath(path), {
      evidence: { exists: true, modifiedTime, size },
      content: new Uint8Array([1, 2, 3, 4]).buffer
    });
  }
}
class FixedFingerprint implements ContentFingerprintPort {
  public async sha256(): Promise<string> {
    return 'sha256:test-content';
  }
}

async function harness() {
  const text = new MemoryVaultTextPort();
  const repository = new VaultManagedRecordRepository(text, new JsonTestFrontmatterCodec());
  const clock = new FixedClock();
  const ids = new SequenceIds();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const files = new MemoryAssets();
  const assets = new AssetReferenceService(
    repository,
    catalog,
    layout,
    files,
    new FixedFingerprint(),
    clock,
    ids
  );
  await catalog.initialize([]);
  const book = await books.create({ title: 'Asset Test', primaryLanguage: 'en', status: 'active' });
  return { text, repository, catalog, files, assets, book };
}

describe('asset reference service', () => {
  it('links an existing file without copying or reading content and records all baseline evidence', async () => {
    const { assets, catalog, files, book } = await harness();
    files.add('Production/Asset Test/book.epub');
    const linked = await assets.link({
      bookId: book.book.id,
      path: 'Production/Asset Test/book.epub',
      role: 'epub',
      sourceFingerprint: 'source:v1',
      notes: 'Release candidate.'
    });
    expect(linked.path).toBe('Production/Asset Test/book.epub');
    expect(linked.size).toBe(4);
    expect(files.binaryReads).toBe(0);
    expect(catalog.snapshot().assets).toHaveLength(1);
    expect((await assets.inspect(catalog.snapshot().assets[0]!)).assessment.state).toBe('current');
  });

  it('uses opt-in cancellable fingerprinting and caches the accepted SHA-256 baseline', async () => {
    const { assets, catalog, files, book } = await harness();
    files.add('Production/cover.psd');
    await assets.link({ bookId: book.book.id, path: 'Production/cover.psd', role: 'cover-psd' });
    const record = catalog.snapshot().assets[0]!;
    const cancelled = new ManualCancellationToken();
    cancelled.cancel();
    await expect(assets.captureFingerprint(record.path, cancelled)).rejects.toThrow('cancelled');
    expect(files.binaryReads).toBe(0);
    const saved = await assets.captureFingerprint(record.path, new NeverCancelledToken());
    expect(saved.fingerprint).toBe('sha256:test-content');
    expect(files.binaryReads).toBe(1);
  });

  it('updates exact moved references, diagnoses deletion, and previews folder repairs without mutation', async () => {
    const { assets, catalog, files, book } = await harness();
    files.add('Old/press-kit.pdf');
    await assets.link({ bookId: book.book.id, path: 'Old/press-kit.pdf', role: 'press-kit' });
    const recordPath = catalog.snapshot().assets[0]!.path;
    files.add('New/press-kit.pdf');
    expect(await assets.handleRename('Old/press-kit.pdf', 'New/press-kit.pdf')).toBe(1);
    expect(catalog.snapshot().assets[0]!.fields.path).toBe('New/press-kit.pdf');
    files.files.delete(normalizeVaultPath('New/press-kit.pdf'));
    expect((await assets.inspect(catalog.snapshot().assets[0]!)).assessment.state).toBe('missing');
    files.add('Repaired/press-kit.pdf');
    const preview = await assets.previewPathRepair(book.book.id, 'New', 'Repaired');
    expect(preview[0]).toMatchObject({
      recordPath,
      status: 'ready',
      proposedPath: 'Repaired/press-kit.pdf'
    });
    expect(catalog.snapshot().assets[0]!.fields.path).toBe('New/press-kit.pdf');
  });
});
