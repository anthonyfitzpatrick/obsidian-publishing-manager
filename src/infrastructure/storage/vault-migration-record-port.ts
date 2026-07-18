/**
 * Connects the generic migration runner to the canonical vault repository. Stable IDs are resolved
 * through a catalog/path port because filenames are never identities. Every save re-loads the note
 * and compares the preflight revision before delegating to the repository's atomic migration path.
 */

import type {
  MigratableRecord,
  MigrationRecordPort
} from '../../application/storage/migration-runner';
import type { LoadedManagedRecord } from '../../application/storage/record-storage-ports';
import type { VaultPath } from '../../domain/storage/vault-path';
import { VaultManagedRecordRepository } from './vault-managed-record-repository';

/** Resolves a stable record identity through the disposable catalog/index. */
export interface RecordPathResolver {
  /** Resolves one unique stable ID or raises duplicate/missing diagnostics. */
  resolvePath(recordId: string): Promise<VaultPath>;
}

/** Production migration port using the conflict-aware canonical repository. */
export class VaultMigrationRecordPort implements MigrationRecordPort {
  /** Binds migrations to canonical repository, index resolution, and deterministic time. */
  public constructor(
    private readonly repository: VaultManagedRecordRepository,
    private readonly paths: RecordPathResolver,
    private readonly now: () => string
  ) {}

  /** Loads the current canonical snapshot for preflight or idempotent resume. */
  public async load(id: string): Promise<MigratableRecord> {
    return toMigratable(await this.repository.loadForMigration(await this.paths.resolvePath(id)));
  }

  /** Advances exactly one preflighted record and rejects external edits through its revision. */
  public async save(
    record: MigratableRecord,
    nextVersion: number,
    nextFields: Readonly<Record<string, unknown>>
  ): Promise<MigratableRecord> {
    const loaded = await this.repository.loadForMigration(await this.paths.resolvePath(record.id));
    if (loaded.sourceRevision !== record.sourceRevision) {
      throw new Error(`${record.id} changed after migration preflight; rerun preflight.`);
    }
    return toMigratable(await this.repository.migrate(loaded, nextVersion, nextFields, this.now()));
  }
}

/** Narrows the richer loaded note to the migration runner's platform-free projection. */
function toMigratable(loaded: LoadedManagedRecord): MigratableRecord {
  return {
    id: loaded.envelope.pmId,
    type: loaded.envelope.pmType,
    schemaVersion: loaded.envelope.pmSchema,
    fields: loaded.fields,
    sourceRevision: loaded.sourceRevision
  };
}
