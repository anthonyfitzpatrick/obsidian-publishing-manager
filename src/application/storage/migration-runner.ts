/**
 * Implements ordered, idempotent, resumable schema migrations. Preflight separates planning from
 * mutation and reports future versions, missing migration links, collisions, and estimated space
 * before a journaled write begins. Migration functions are pure transformations that must preserve
 * unknown fields; the repository port performs optimistic persistence.
 */

import type { ManagedRecordType } from '../../domain/records/record-types';
import { JournaledOperationRunner, type JournaledOperationStep } from './operation-journal';

/** Record projection required to plan and apply schema upgrades. */
export interface MigratableRecord {
  readonly id: string;
  readonly type: ManagedRecordType;
  readonly schemaVersion: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly sourceRevision: string;
}

/** One adjacent version transformation; gaps are forbidden so recovery remains understandable. */
export interface MigrationDefinition {
  readonly id: string;
  readonly type: ManagedRecordType;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
}

/** Repository boundary keeps migration logic independent of Obsidian and testable. */
export interface MigrationRecordPort {
  /** Loads the latest record, including legacy schema versions, by stable identity. */
  load(id: string): Promise<MigratableRecord>;
  /** Persists a complete transformed field bag with optimistic conflict protection. */
  save(
    record: MigratableRecord,
    nextVersion: number,
    nextFields: Readonly<Record<string, unknown>>
  ): Promise<MigratableRecord>;
}

/** Planned migration action contains the complete ordered path for one record. */
export interface PlannedRecordMigration {
  readonly recordId: string;
  readonly type: ManagedRecordType;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly definitions: readonly MigrationDefinition[];
}

/** Preflight result either authorizes an immutable plan or provides recovery-oriented diagnostics. */
export type MigrationPreflightResult =
  | {
      readonly ready: true;
      readonly actions: readonly PlannedRecordMigration[];
    }
  | { readonly ready: false; readonly diagnostics: readonly string[] };

/** Ordered migration registry and journal-backed executor. */
export class MigrationRunner {
  /** Binds an immutable migration registry to record and journal persistence ports. */
  public constructor(
    private readonly definitions: readonly MigrationDefinition[],
    private readonly records: MigrationRecordPort,
    private readonly journals: JournaledOperationRunner
  ) {}

  /**
   * Builds a complete plan without mutation. Collisions and estimated free-space checks are
   * supplied by the calling adapter because browser/mobile Obsidian exposes no universal disk API.
   */
  public preflight(
    records: readonly MigratableRecord[],
    targetVersion: number,
    options: {
      readonly collisionPaths?: readonly string[];
      readonly availableBytes?: number;
      readonly estimatedRequiredBytes?: number;
    } = {}
  ): MigrationPreflightResult {
    const diagnostics: string[] = [];
    if ((options.collisionPaths?.length ?? 0) > 0) {
      diagnostics.push(`Migration target collisions: ${options.collisionPaths?.join(', ')}`);
    }
    if (
      options.availableBytes !== undefined &&
      options.estimatedRequiredBytes !== undefined &&
      options.availableBytes < options.estimatedRequiredBytes
    ) {
      diagnostics.push('Migration preflight reports insufficient available storage.');
    }

    const actions: PlannedRecordMigration[] = [];
    for (const record of records) {
      if (record.schemaVersion > targetVersion) {
        diagnostics.push(
          `${record.id} uses future schema ${record.schemaVersion}; supported target is ${targetVersion}.`
        );
        continue;
      }
      if (record.schemaVersion === targetVersion) {
        continue;
      }

      const path: MigrationDefinition[] = [];
      let version = record.schemaVersion;
      while (version < targetVersion) {
        const definition = this.definitions.find(
          ({ type, fromVersion }) => type === record.type && fromVersion === version
        );
        if (definition === undefined || definition.toVersion !== version + 1) {
          diagnostics.push(
            `No contiguous ${record.type} migration exists from schema ${version} to ${version + 1}.`
          );
          break;
        }
        path.push(definition);
        version = definition.toVersion;
      }
      if (version === targetVersion) {
        actions.push({
          recordId: record.id,
          type: record.type,
          fromVersion: record.schemaVersion,
          toVersion: targetVersion,
          definitions: path
        });
      }
    }

    return diagnostics.length > 0 ? { ready: false, diagnostics } : { ready: true, actions };
  }

  /** Executes the immutable preflight plan through a durable step journal. */
  public async run(
    journalId: string,
    plan: Extract<MigrationPreflightResult, { readonly ready: true }>,
    now: () => string
  ): Promise<void> {
    const steps: JournaledOperationStep[] = plan.actions.map((action) => ({
      id: `migrate-${action.recordId}`,
      description: `Migrate ${action.type} ${action.recordId} from ${action.fromVersion} to ${action.toVersion}.`,
      apply: async () => this.applyAction(action)
    }));
    await this.journals.run(journalId, 'schema-migration', steps, now);
  }

  /** Re-loads before applying so retries are idempotent and external changes are respected. */
  private async applyAction(action: PlannedRecordMigration): Promise<{
    readonly beforeRevision?: string;
    readonly afterRevision?: string;
  }> {
    let record = await this.records.load(action.recordId);
    const beforeRevision = record.sourceRevision;
    if (record.schemaVersion === action.toVersion) {
      return { beforeRevision, afterRevision: beforeRevision };
    }
    if (record.schemaVersion !== action.fromVersion) {
      throw new Error(
        `${record.id} changed schema after preflight; rerun preflight before migration.`
      );
    }

    let fields = record.fields;
    let version = record.schemaVersion;
    for (const definition of action.definitions) {
      if (definition.fromVersion !== version) {
        throw new Error(`Migration plan for ${record.id} is not contiguous at schema ${version}.`);
      }
      fields = applyMigrationPatch(fields, definition.migrate(fields));
      version = definition.toVersion;
    }
    record = await this.records.save(record, version, fields);
    return { beforeRevision, afterRevision: record.sourceRevision };
  }
}

/**
 * Applies a migration result as a patch so transformations can explicitly retire a legacy field
 * with `undefined` while every unmentioned unknown extension remains preserved.
 */
function applyMigrationPatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}
