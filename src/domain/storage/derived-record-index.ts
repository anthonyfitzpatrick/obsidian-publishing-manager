/**
 * Implements the disposable DAT-010 catalog index. It stores only discovery and query metadata,
 * never authoritative record contents. Schema and source fingerprints make staleness explicit;
 * the entire index can be discarded and rebuilt from vault records without data loss.
 */

import type { ManagedRecordType } from '../records/record-types';
import type { VaultPath } from './vault-path';

/** Minimal indexed projection retained for discovery, duplicate detection, and invalidation. */
export interface DerivedRecordIndexEntry {
  readonly id: string;
  readonly type: ManagedRecordType;
  readonly path: VaultPath;
  readonly schemaVersion: number;
  readonly schemaFingerprint: string;
  readonly sourceFingerprint: string;
}

/** Duplicate identity evidence forces diagnostics instead of silently selecting one path. */
export interface DuplicateIndexIdentity {
  readonly id: string;
  readonly paths: readonly VaultPath[];
}

/** In-memory index whose contents are always replaceable from canonical vault records. */
export class DerivedRecordIndex {
  private readonly entriesByPath = new Map<VaultPath, DerivedRecordIndexEntry>();

  /** Replaces the complete projection after a cold scan or explicit rebuild. */
  public rebuild(entries: readonly DerivedRecordIndexEntry[]): void {
    this.entriesByPath.clear();
    for (const entry of entries) {
      this.entriesByPath.set(entry.path, entry);
    }
  }

  /** Applies one incremental create/modify/rename projection. */
  public upsert(entry: DerivedRecordIndexEntry): void {
    this.entriesByPath.set(entry.path, entry);
  }

  /** Invalidates a deleted or renamed source path without touching canonical data. */
  public remove(path: VaultPath): void {
    this.entriesByPath.delete(path);
  }

  /** Returns deterministic path-sorted results for a record type. */
  public findByType(type: ManagedRecordType): readonly DerivedRecordIndexEntry[] {
    return [...this.entriesByPath.values()]
      .filter((entry) => entry.type === type)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Reports every duplicated stable identity so callers can route users to diagnostics. */
  public findDuplicateIdentities(): readonly DuplicateIndexIdentity[] {
    const pathsById = new Map<string, VaultPath[]>();
    for (const entry of this.entriesByPath.values()) {
      const paths = pathsById.get(entry.id) ?? [];
      paths.push(entry.path);
      pathsById.set(entry.id, paths);
    }

    return [...pathsById.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([id, paths]) => ({ id, paths: [...paths].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Identifies projections that must be rehydrated after schema or source changes. */
  public isStale(
    path: VaultPath,
    expectedSchemaFingerprint: string,
    expectedSourceFingerprint: string
  ): boolean {
    const entry = this.entriesByPath.get(path);
    return (
      entry === undefined ||
      entry.schemaFingerprint !== expectedSchemaFingerprint ||
      entry.sourceFingerprint !== expectedSourceFingerprint
    );
  }
}
