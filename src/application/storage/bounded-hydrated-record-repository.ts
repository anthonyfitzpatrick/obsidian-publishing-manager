/**
 * Adds a disposable least-recently-used hydration cache in front of canonical Markdown storage.
 * Cache validity is tied to the catalog's latest source revision, so a vault event invalidates a
 * stale body/field snapshot without granting this decorator any file-watching or write authority.
 */

import type { VaultPath } from '../../domain/storage/vault-path';
import type {
  LoadedManagedRecord,
  ManagedRecordPatch,
  ManagedRecordRepositoryPort,
  NewManagedRecord
} from './record-storage-ports';

interface HydratedCacheEntry {
  readonly record: LoadedManagedRecord;
  readonly estimatedBytes: number;
}

/** Observable cache evidence contains counts only and never note paths, fields, or bodies. */
export interface HydratedRecordCacheSnapshot {
  readonly entries: number;
  readonly estimatedBytes: number;
  readonly maximumBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/**
 * Repository decorator whose Map insertion order is the LRU queue. Reads are served only when the
 * cached source fingerprint still equals the catalog projection. Writes always cross the inner
 * optimistic repository first and replace the cache only after canonical persistence succeeds.
 */
export class BoundedHydratedRecordRepository implements ManagedRecordRepositoryPort {
  private readonly entries = new Map<VaultPath, HydratedCacheEntry>();
  private estimatedBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  public constructor(
    private readonly inner: ManagedRecordRepositoryPort,
    private readonly currentRevision: (path: VaultPath) => string | undefined,
    private readonly maximumBytes: number
  ) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
      throw new Error('Hydrated-record cache limit must be a non-negative safe integer.');
  }

  /** Uses one exact source fingerprint match; absence from the catalog deliberately forces I/O. */
  public async load(path: VaultPath): Promise<LoadedManagedRecord> {
    const entry = this.entries.get(path);
    const revision = this.currentRevision(path);
    if (entry !== undefined && revision !== undefined && entry.record.sourceRevision === revision) {
      this.hits += 1;
      this.touch(path, entry);
      return entry.record;
    }
    this.misses += 1;
    this.forget(path);
    const loaded = await this.inner.load(path);
    this.remember(loaded);
    return loaded;
  }

  /** Creates canonically before retaining the successful hydrated result. */
  public async create(path: VaultPath, record: NewManagedRecord): Promise<LoadedManagedRecord> {
    const created = await this.inner.create(path, record);
    this.remember(created);
    return created;
  }

  /** Saves through the optimistic inner boundary and refreshes the cache with the exact result. */
  public async save(
    loaded: LoadedManagedRecord,
    patch: ManagedRecordPatch,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const saved = await this.inner.save(loaded, patch, updatedAt);
    this.remember(saved);
    return saved;
  }

  /** Archives/restores canonically before replacing the cached source revision. */
  public async setArchivedAt(
    loaded: LoadedManagedRecord,
    archivedAt: string | undefined,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const saved = await this.inner.setArchivedAt(loaded, archivedAt, updatedAt);
    this.remember(saved);
    return saved;
  }

  /** Counts support local diagnostics without disclosing cached publishing content. */
  public snapshot(): HydratedRecordCacheSnapshot {
    return {
      entries: this.entries.size,
      estimatedBytes: this.estimatedBytes,
      maximumBytes: this.maximumBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    };
  }

  /** Explicit disposal is useful on plugin teardown and never touches canonical records. */
  public clear(): void {
    this.entries.clear();
    this.estimatedBytes = 0;
  }

  /** Reinsert one cache hit at the newest end without changing its retained byte estimate. */
  private touch(path: VaultPath, entry: HydratedCacheEntry): void {
    this.entries.delete(path);
    this.entries.set(path, entry);
  }

  /** Replaces one path and evicts oldest entries until the configured byte ceiling is restored. */
  private remember(record: LoadedManagedRecord): void {
    this.forget(record.path);
    const estimatedBytes = estimateHydratedBytes(record);
    if (this.maximumBytes === 0 || estimatedBytes > this.maximumBytes) return;
    this.entries.set(record.path, { record, estimatedBytes });
    this.estimatedBytes += estimatedBytes;
    while (this.estimatedBytes > this.maximumBytes) {
      const oldestPath = this.entries.keys().next().value;
      if (oldestPath === undefined) break;
      this.forget(oldestPath);
      this.evictions += 1;
    }
  }

  /** Removes one entry while keeping retained-size evidence exact. */
  private forget(path: VaultPath): void {
    const entry = this.entries.get(path);
    if (entry === undefined) return;
    this.entries.delete(path);
    this.estimatedBytes -= entry.estimatedBytes;
  }
}

/**
 * Uses a conservative UTF-16 estimate for retained strings plus a small fixed object allowance.
 * The limit is a cache policy rather than a heap profiler; overestimating causes earlier, safer
 * eviction and never changes canonical data.
 */
function estimateHydratedBytes(record: LoadedManagedRecord): number {
  const fields = JSON.stringify(record.fields);
  return (
    512 +
    2 *
      (record.path.length +
        record.body.length +
        record.sourceRevision.length +
        record.envelope.pmId.length +
        record.envelope.pmType.length +
        fields.length)
  );
}
