/**
 * Protects DAT-008 planning and resume behavior. The migration uses a fake repository because the
 * runner is intentionally platform-independent; repository integration is separately proven. The
 * scenarios cover ordered upgrades, unknown-field preservation, idempotency, future-version
 * guidance, missing migration links, collisions, and free-space preflight.
 */

import { describe, expect, it } from 'vitest';

import {
  MigrationRunner,
  type MigratableRecord,
  type MigrationRecordPort
} from '../../src/application/storage/migration-runner';
import {
  JournaledOperationRunner,
  type OperationJournal,
  type OperationJournalStore
} from '../../src/application/storage/operation-journal';

class MemoryMigrationRecordPort implements MigrationRecordPort {
  public readonly records = new Map<string, MigratableRecord>();
  public saveCount = 0;

  public async load(id: string): Promise<MigratableRecord> {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new Error(`Missing migration fixture ${id}.`);
    }
    return structuredClone(record);
  }

  public async save(
    record: MigratableRecord,
    nextVersion: number,
    nextFields: Readonly<Record<string, unknown>>
  ): Promise<MigratableRecord> {
    this.saveCount += 1;
    const next: MigratableRecord = {
      ...record,
      schemaVersion: nextVersion,
      fields: structuredClone(nextFields),
      sourceRevision: `revision-${this.saveCount}`
    };
    this.records.set(record.id, next);
    return structuredClone(next);
  }
}

class MemoryJournalStore implements OperationJournalStore {
  private readonly journals = new Map<string, OperationJournal>();

  public async load(id: string): Promise<OperationJournal | undefined> {
    const journal = this.journals.get(id);
    return journal === undefined ? undefined : structuredClone(journal);
  }

  public async save(journal: OperationJournal): Promise<void> {
    this.journals.set(journal.id, structuredClone(journal));
  }
}

describe('MigrationRunner', () => {
  it('preflights and applies a contiguous migration exactly once while preserving unknown fields', async () => {
    const records = new MemoryMigrationRecordPort();
    const legacy = fixtureRecord(0);
    records.records.set(legacy.id, legacy);
    const runner = createRunner(records);
    const plan = runner.preflight([legacy], 1);
    expect(plan.ready).toBe(true);
    if (!plan.ready) {
      throw new Error('Expected migration fixture to be ready.');
    }

    await runner.run('migration-00000001', plan, () => '2026-07-18T12:00:00.000Z');
    await runner.run('migration-00000001', plan, () => '2026-07-18T12:00:01.000Z');

    expect(records.saveCount).toBe(1);
    expect(await records.load(legacy.id)).toMatchObject({
      schemaVersion: 1,
      fields: {
        title: 'Legacy Fictional Title',
        status: 'active',
        'unknown-safe-key': 'preserve me'
      }
    });
    expect((await records.load(legacy.id)).fields).not.toHaveProperty('working-title');
  });

  it('blocks future schemas, missing links, target collisions, and insufficient space before writes', () => {
    const records = new MemoryMigrationRecordPort();
    const runner = new MigrationRunner(
      [],
      records,
      new JournaledOperationRunner(new MemoryJournalStore())
    );
    const result = runner.preflight(
      [fixtureRecord(0), fixtureRecord(99, 'pm-book-future0001')],
      1,
      {
        collisionPaths: ['Publishing Manager/Books/conflict.md'],
        availableBytes: 10,
        estimatedRequiredBytes: 100
      }
    );

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.diagnostics.join(' ')).toContain('target collisions');
      expect(result.diagnostics.join(' ')).toContain('insufficient available storage');
      expect(result.diagnostics.join(' ')).toContain('No contiguous book migration');
      expect(result.diagnostics.join(' ')).toContain('future schema 99');
    }
  });
});

/** Creates the only supported legacy-to-v1 transformation for these deterministic fixtures. */
function createRunner(records: MemoryMigrationRecordPort): MigrationRunner {
  return new MigrationRunner(
    [
      {
        id: 'book-0-to-1',
        type: 'book',
        fromVersion: 0,
        toVersion: 1,
        migrate: (fields) => ({
          ...fields,
          title: fields['working-title'],
          'working-title': undefined,
          status: 'active',
          'primary-language': 'en'
        })
      }
    ],
    records,
    new JournaledOperationRunner(new MemoryJournalStore())
  );
}

/** Produces fictional legacy/future records without personal publishing data. */
function fixtureRecord(schemaVersion: number, id = 'pm-book-legacy0001'): MigratableRecord {
  return {
    id,
    type: 'book',
    schemaVersion,
    fields: {
      'working-title': 'Legacy Fictional Title',
      'unknown-safe-key': 'preserve me'
    },
    sourceRevision: `legacy-${schemaVersion}`
  };
}
