/**
 * Supplies the read-only WFL-010 and WFL-013 projections shared by list, board, mobile, and
 * dashboard-facing workflow surfaces. These functions never persist presentation state: they
 * derive blockers, workload, overdue work, and stalled work from the current canonical tasks so
 * a manual Markdown edit or resumed journal is reflected on the next catalog reconciliation.
 */

import { assessTaskBlockers, type WorkflowTask } from '../../domain/workflows/workflow';

/** One owner's open workload with time totals suitable for text, cards, or later charts. */
export interface OwnerWorkload {
  readonly owner: string;
  readonly openTasks: number;
  readonly blockedTasks: number;
  readonly overdueTasks: number;
  readonly estimateMinutes: number;
}

/** Complete query result retains exact task identities for drill-through rather than only counts. */
export interface WorkflowAttentionQuery {
  readonly owners: readonly OwnerWorkload[];
  readonly overdue: readonly WorkflowTask[];
  readonly stalled: readonly WorkflowTask[];
}

/**
 * Computes workload against a caller-supplied time so tests and UI refreshes are deterministic.
 * A task is stalled only when it is active, unfinished, and has not been updated for the chosen
 * number of whole days. Unassigned work is intentionally grouped instead of disappearing.
 */
export function queryWorkflowAttention(
  tasks: readonly WorkflowTask[],
  now: Date,
  stalledAfterDays = 14
): WorkflowAttentionQuery {
  const today = now.toISOString().slice(0, 10);
  const stalledCutoff = now.getTime() - stalledAfterDays * 24 * 60 * 60 * 1_000;
  const open = tasks.filter(({ status }) => status !== 'done' && status !== 'cancelled');
  const overdue = open
    .filter(({ deadline }) => deadline !== undefined && deadline < today)
    .sort(compareAttentionTasks);
  const stalled = open
    .filter(
      ({ status, updatedAt }) => status === 'active' && Date.parse(updatedAt) <= stalledCutoff
    )
    .sort(compareAttentionTasks);
  const owners = new Map<string, WorkflowTask[]>();
  for (const task of open) {
    const owner = task.owner?.trim() || 'Unassigned';
    owners.set(owner, [...(owners.get(owner) ?? []), task]);
  }
  return {
    owners: [...owners.entries()]
      .map(([owner, owned]) => ({
        owner,
        openTasks: owned.length,
        blockedTasks: owned.filter((task) => assessTaskBlockers(task, tasks).blocked).length,
        overdueTasks: owned.filter(({ deadline }) => deadline !== undefined && deadline < today)
          .length,
        estimateMinutes: owned.reduce((total, task) => total + (task.estimateMinutes ?? 0), 0)
      }))
      .sort((left, right) => left.owner.localeCompare(right.owner)),
    overdue,
    stalled
  };
}

/** Stable priority/deadline/title ordering keeps equivalent list and board outputs predictable. */
export function compareAttentionTasks(left: WorkflowTask, right: WorkflowTask): number {
  const priority = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return (
    priority[left.priority] - priority[right.priority] ||
    (left.deadline ?? '9999-12-31').localeCompare(right.deadline ?? '9999-12-31') ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}
