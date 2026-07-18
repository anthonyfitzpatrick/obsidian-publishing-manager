/**
 * Protects WFL-013 query semantics independently of the DOM. The fixture uses a fixed clock so
 * overdue and stalled labels cannot change with the test runner's real date, and it verifies that
 * unassigned/blocked work remains visible rather than being dropped from owner summaries.
 */
import { describe, expect, it } from 'vitest';

import { queryWorkflowAttention } from '../../src/application/workflows/workflow-queries';
import type { WorkflowTask } from '../../src/domain/workflows/workflow';

function task(id: string, patch: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id,
    bookId: 'pm-book-query-0001',
    workflowId: 'pm-workflow-query-0001',
    stageId: 'stage-planning',
    title: id,
    status: 'active',
    priority: 'normal',
    required: true,
    attachments: [],
    checklist: { items: [] },
    dependsOn: [],
    manualBlockers: [],
    linkedMetadata: {},
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...patch
  };
}

describe('workflow attention queries', () => {
  it('groups owner workload and returns exact overdue and stalled tasks', () => {
    const dependency = task('pm-task-dependency01', { status: 'not-started', owner: 'Editor' });
    const blocked = task('pm-task-blocked0001', {
      owner: 'Editor',
      deadline: '2026-07-01',
      estimateMinutes: 90,
      dependsOn: [dependency.id]
    });
    const unassigned = task('pm-task-unassigned1', {
      status: 'not-started',
      updatedAt: '2026-07-18T10:00:00.000Z'
    });

    const result = queryWorkflowAttention(
      [dependency, blocked, unassigned],
      new Date('2026-07-19T12:00:00.000Z'),
      14
    );

    expect(result.overdue.map(({ id }) => id)).toContain(blocked.id);
    expect(result.stalled.map(({ id }) => id)).toContain(blocked.id);
    expect(result.owners).toContainEqual({
      owner: 'Editor',
      openTasks: 2,
      blockedTasks: 1,
      overdueTasks: 1,
      estimateMinutes: 90
    });
    expect(result.owners.some(({ owner }) => owner === 'Unassigned')).toBe(true);
  });
});
