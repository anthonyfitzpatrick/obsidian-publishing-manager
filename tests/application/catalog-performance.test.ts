/**
 * Protects cooperative catalog hydration. The fixture uses tiny records so the test asserts the
 * lifecycle contract—not wall-clock speed, which belongs to the reference benchmark harness.
 */
import { describe, expect, it } from 'vitest';

import { BookCatalog } from '../../src/application/catalog/book-catalog';
import type { Clock } from '../../src/domain/foundation/clock';
import { serializeEnvelope } from '../../src/domain/records/record-envelope';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

const clock: Clock = { now: () => new Date('2026-07-19T12:00:00.000Z') };

describe('catalog performance boundaries', () => {
  it('returns a usable partial projection, reports progress, then reaches ready after yielding', async () => {
    const vault = new MemoryVaultTextPort();
    const codec = new JsonTestFrontmatterCodec();
    const repository = new VaultManagedRecordRepository(vault, codec);
    const catalog = new BookCatalog(repository, clock);
    const paths = Array.from({ length: 12 }, (_, index) =>
      normalizeVaultPath(`Publishing Manager/Books/perf-${String(index).padStart(2, '0')}.md`)
    );
    for (const [index, path] of paths.entries())
      vault.files.set(
        path,
        codec.serialize({
          frontmatter: {
            title: `Performance book ${index}`,
            status: 'active',
            'primary-language': 'en',
            ...serializeEnvelope({
              pmId: `pm-book-performance-${String(index).padStart(4, '0')}`,
              pmType: 'book',
              pmSchema: 1,
              createdAt: '2026-07-19T12:00:00.000Z',
              updatedAt: '2026-07-19T12:00:00.000Z'
            })
          },
          body: ''
        })
      );

    let yields = 0;
    await catalog.initialize(paths, {
      initialBatchSize: 2,
      batchSize: 3,
      yieldToHost: async () => {
        yields += 1;
      }
    });

    const partial = catalog.snapshot();
    expect(partial.availability).toMatchObject({ state: 'rebuilding', completed: 2, total: 12 });
    expect(partial.books).toHaveLength(2);
    await catalog.whenIdle();
    expect(catalog.snapshot().availability).toEqual({ state: 'ready' });
    expect(catalog.snapshot().books).toHaveLength(12);
    expect(yields).toBe(4);
  });
});
