/** Proves revision validity, true LRU promotion, byte-bounded eviction, and disposable clearing. */
import { describe, expect, it } from 'vitest';
import { BoundedHydratedRecordRepository } from '../../src/application/storage/bounded-hydrated-record-repository';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../src/domain/records/record-envelope';
import { normalizeVaultPath, type VaultPath } from '../../src/domain/storage/vault-path';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class CountingVault extends MemoryVaultTextPort {
  public readCount = 0;
  public override async read(path: VaultPath): Promise<string> {
    this.readCount += 1;
    return super.read(path);
  }
}

describe('bounded hydrated record repository', () => {
  it('uses matching revisions, promotes hits, and evicts the least-recently-used hydration', async () => {
    const vault = new CountingVault();
    const canonical = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
    const revisions = new Map<VaultPath, string>();
    // Each fictional entry is roughly 1 KiB; this ceiling intentionally retains two, not three.
    const cache = new BoundedHydratedRecordRepository(
      canonical,
      (path) => revisions.get(path),
      2_300
    );
    const paths = [
      'Publishing Manager/Sales/Sources/a.md',
      'Publishing Manager/Sales/Sources/b.md',
      'Publishing Manager/Sales/Sources/c.md'
    ].map(normalizeVaultPath);
    const created = [];
    for (const [index, path] of paths.entries()) {
      const record = await cache.create(path, {
        envelope: {
          pmId: `pm-sales-source-${String(index).padStart(8, '0')}`,
          pmType: 'sales-source',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: '2026-07-19T12:00:00.000Z',
          updatedAt: '2026-07-19T12:00:00.000Z'
        },
        fields: { label: `Source ${index}`, kind: `kind-${index}` },
        body: `# Source ${index}\n\n${'Readable cache evidence. '.repeat(4)}`
      });
      revisions.set(path, record.sourceRevision);
      created.push(record);
      if (index === 1) await cache.load(paths[0]!); // Promote A, making B the oldest entry.
    }

    expect(cache.snapshot()).toEqual(
      expect.objectContaining({ entries: 2, hits: 1, misses: 0, evictions: 1 })
    );
    const readsBeforeEvictedLoad = vault.readCount;
    await cache.load(paths[1]!);
    expect(vault.readCount).toBe(readsBeforeEvictedLoad + 1);

    // A changed catalog fingerprint must prevent a stale cache hit even before explicit clearing.
    revisions.set(paths[2]!, 'external-source-revision');
    const missesBeforeRevisionChange = cache.snapshot().misses;
    await cache.load(paths[2]!);
    expect(cache.snapshot().misses).toBe(missesBeforeRevisionChange + 1);

    cache.clear();
    expect(cache.snapshot()).toEqual(expect.objectContaining({ entries: 0, estimatedBytes: 0 }));
    expect(created).toHaveLength(3);
  });
});
