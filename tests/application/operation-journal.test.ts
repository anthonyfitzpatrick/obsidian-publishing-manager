/**
 * Protects DAT-007 recovery semantics. The test intentionally fails midway, verifies that the
 * durable journal names the recovery state, and resumes without reapplying the checkpointed first
 * step. This is the key guarantee that makes partial multi-record work explainable to users.
 */

import { describe, expect, it } from 'vitest';

import {
  JournaledOperationRunner,
  type OperationJournal,
  type OperationJournalStore
} from '../../src/application/storage/operation-journal';

class MemoryJournalStore implements OperationJournalStore {
  public journal: OperationJournal | undefined;

  public async load(id: string): Promise<OperationJournal | undefined> {
    return this.journal?.id === id ? structuredClone(this.journal) : undefined;
  }

  public async save(journal: OperationJournal): Promise<void> {
    this.journal = structuredClone(journal);
  }
}

describe('JournaledOperationRunner', () => {
  it('checkpoints applied steps and resumes pending work after recovery', async () => {
    const store = new MemoryJournalStore();
    const runner = new JournaledOperationRunner(store);
    const applications: string[] = [];
    let shouldFail = true;
    let tick = 0;
    const now = (): string => `2026-07-18T12:00:0${tick++}.000Z`;
    const steps = [
      {
        id: 'write-first-record',
        description: 'Write the first fictional record.',
        apply: async () => {
          applications.push('first');
          return { afterRevision: 'revision-first' };
        }
      },
      {
        id: 'write-second-record',
        description: 'Write the second fictional record.',
        apply: async () => {
          applications.push('second');
          if (shouldFail) {
            throw new Error('Fictional write interruption.');
          }
          return { afterRevision: 'revision-second' };
        }
      }
    ];

    await expect(runner.run('journal-00000001', 'fixture-operation', steps, now)).rejects.toThrow(
      'Fictional write interruption.'
    );
    expect(store.journal?.state).toBe('recovery-required');
    expect(store.journal?.recoveryGuidance).toContain('retry the same operation ID');
    expect(store.journal?.steps.map(({ status }) => status)).toEqual(['applied', 'pending']);

    shouldFail = false;
    const result = await runner.run('journal-00000001', 'fixture-operation', steps, now);

    expect(result.resumed).toBe(true);
    expect(result.journal.state).toBe('completed');
    expect(applications).toEqual(['first', 'second', 'second']);
  });
});
