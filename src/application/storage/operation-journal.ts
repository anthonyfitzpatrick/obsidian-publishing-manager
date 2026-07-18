/**
 * Coordinates multi-record work through a durable, step-level journal. The journal makes partial
 * progress visible and resumable instead of pretending several vault writes are one transaction.
 * A step must itself be idempotent because an app crash can occur after the write succeeds but
 * before its completion checkpoint is persisted.
 */

import { NeverCancelledToken, type CancellationToken } from '../../domain/foundation/cancellation';

/** Durable lifecycle of a multi-record operation. */
export type OperationJournalState = 'completed' | 'pending' | 'recovery-required' | 'running';

/** Durable status for one independently resumable operation step. */
export interface OperationJournalStepState {
  readonly id: string;
  readonly description: string;
  readonly status: 'applied' | 'pending';
  readonly beforeRevision?: string;
  readonly afterRevision?: string;
}

/** Canonical journal snapshot stored after every meaningful transition. */
export interface OperationJournal {
  readonly id: string;
  readonly operation: string;
  readonly state: OperationJournalState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recoveryGuidance?: string | undefined;
  readonly steps: readonly OperationJournalStepState[];
}

/** Persistence contract; production stores journals in the vault through Obsidian APIs. */
export interface OperationJournalStore {
  /** Loads the last durable checkpoint or reports that an operation has not started. */
  load(id: string): Promise<OperationJournal | undefined>;
  /** Persists a complete replacement snapshot after one meaningful transition. */
  save(journal: OperationJournal): Promise<void>;
}

/** Runtime step paired with its durable identity and human-readable recovery description. */
export interface JournaledOperationStep {
  readonly id: string;
  readonly description: string;
  /** Applies one idempotent unit of work and returns optional source revision evidence. */
  apply(): Promise<{
    readonly beforeRevision?: string;
    readonly afterRevision?: string;
  }>;
}

/** Result distinguishes a newly completed operation from an already-completed resume request. */
export interface JournalRunResult {
  readonly journal: OperationJournal;
  readonly resumed: boolean;
}

/** Runs, checkpoints, resumes, and exposes recovery state for multi-record operations. */
export class JournaledOperationRunner {
  /** Binds the runner to the durable journal store shared by the operation. */
  public constructor(private readonly store: OperationJournalStore) {}

  /**
   * Executes pending steps in declared order. Existing applied steps are never repeated, while a
   * failed step leaves explicit recovery guidance and can be retried with the same journal ID.
   */
  public async run(
    id: string,
    operation: string,
    steps: readonly JournaledOperationStep[],
    now: () => string,
    cancellation: CancellationToken = new NeverCancelledToken()
  ): Promise<JournalRunResult> {
    const existing = await this.store.load(id);
    const resumed = existing !== undefined;
    let journal = existing ?? createJournal(id, operation, steps, now());
    assertCompatibleJournal(journal, operation, steps);

    if (journal.state === 'completed') {
      return { journal, resumed: true };
    }

    journal = {
      ...journal,
      state: 'running',
      updatedAt: now(),
      recoveryGuidance: undefined
    };
    await this.store.save(journal);

    try {
      for (const runtimeStep of steps) {
        cancellation.throwIfCancellationRequested();
        const durableStep = journal.steps.find(({ id: stepId }) => stepId === runtimeStep.id);
        if (durableStep?.status === 'applied') {
          continue;
        }

        const revisions = await runtimeStep.apply();
        journal = {
          ...journal,
          updatedAt: now(),
          steps: journal.steps.map((step) =>
            step.id === runtimeStep.id ? { ...step, ...revisions, status: 'applied' } : step
          )
        };
        await this.store.save(journal);
      }
    } catch (error) {
      journal = {
        ...journal,
        state: 'recovery-required',
        updatedAt: now(),
        recoveryGuidance:
          'Resolve the reported problem, preserve the journal, and retry the same operation ID to resume pending steps.'
      };
      await this.store.save(journal);
      throw error;
    }

    journal = {
      ...journal,
      state: 'completed',
      updatedAt: now(),
      recoveryGuidance: undefined
    };
    await this.store.save(journal);
    return { journal, resumed };
  }
}

/** Creates the first durable snapshot before any user record is touched. */
function createJournal(
  id: string,
  operation: string,
  steps: readonly JournaledOperationStep[],
  timestamp: string
): OperationJournal {
  return {
    id,
    operation,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: steps.map(({ id: stepId, description }) => ({
      id: stepId,
      description,
      status: 'pending'
    }))
  };
}

/** Prevents an operation ID from being reused for a different or reordered transaction. */
function assertCompatibleJournal(
  journal: OperationJournal,
  operation: string,
  steps: readonly JournaledOperationStep[]
): void {
  const durableIds = journal.steps.map(({ id }) => id);
  const runtimeIds = steps.map(({ id }) => id);
  if (
    journal.operation !== operation ||
    JSON.stringify(durableIds) !== JSON.stringify(runtimeIds)
  ) {
    throw new Error(`Operation journal ${journal.id} does not match the requested operation.`);
  }
}
