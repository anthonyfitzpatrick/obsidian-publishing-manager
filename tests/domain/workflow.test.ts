/** Proves WFL-001, WFL-002, and WFL-006–WFL-009 as deterministic domain behavior. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_TEMPLATE,
  assessStageCompletion,
  assessTaskBlockers,
  cloneStages,
  findTaskDependencyCycle,
  previewTemplateMerge,
  validateWorkflowProject,
  type WorkflowStage,
  type WorkflowTask
} from '../../src/domain/workflows/workflow';

function task(
  id: string,
  dependsOn: readonly string[] = [],
  status: WorkflowTask['status'] = 'not-started'
): WorkflowTask {
  return {
    id,
    bookId: 'pm-book-workflow-0001',
    workflowId: 'pm-workflow-test-0001',
    stageId: 'stage-planning',
    title: id,
    status,
    priority: 'normal',
    required: true,
    attachments: [],
    checklist: { items: [] },
    dependsOn,
    manualBlockers: [],
    linkedMetadata: {},
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z'
  };
}

describe('workflow domain', () => {
  it('ships all sixteen ordered default stages and returns independent clones', () => {
    expect(DEFAULT_WORKFLOW_TEMPLATE.stages.items.map(({ category }) => category)).toEqual([
      'planning',
      'draft',
      'development-edit',
      'copy-edit',
      'proofreading',
      'formatting',
      'metadata-complete',
      'cover-ready',
      'isbn-assigned',
      'files-generated',
      'retail-upload',
      'retail-review',
      'preorder',
      'published',
      'post-launch',
      'archived'
    ]);
    const clone = cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages);
    expect(clone).toEqual(DEFAULT_WORKFLOW_TEMPLATE.stages);
    expect(clone).not.toBe(DEFAULT_WORKFLOW_TEMPLATE.stages);
    expect(clone.items[0]).not.toBe(DEFAULT_WORKFLOW_TEMPLATE.stages.items[0]);
  });

  it('reports malformed externally edited stage data instead of throwing during validation', () => {
    const fields = {
      'book-id': 'pm-book-workflow-0001',
      name: 'Publishing workflow',
      status: 'active',
      'template-id': 'publishing-manager-default',
      'template-version': 1,
      'template-baseline': cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages),
      stages: {
        items: [
          {
            ...DEFAULT_WORKFLOW_TEMPLATE.stages.items[0],
            dependsOnStageIds: 'not-a-list',
            attachments: ['../outside-the-vault']
          }
        ]
      }
    };

    expect(() => validateWorkflowProject(fields)).not.toThrow();
    expect(
      validateWorkflowProject(fields)
        .map(({ message }) => message)
        .join(' ')
    ).toContain('malformed approval, dependency, or attachment data');
  });

  it('detects and reports the exact closed dependency cycle', () => {
    const cycle = findTaskDependencyCycle([
      task('pm-task-a0000001', ['pm-task-c0000001']),
      task('pm-task-b0000001', ['pm-task-a0000001']),
      task('pm-task-c0000001', ['pm-task-b0000001'])
    ]);
    expect(cycle).toEqual([
      'pm-task-a0000001',
      'pm-task-c0000001',
      'pm-task-b0000001',
      'pm-task-a0000001'
    ]);
  });

  it('explains every unmet task dependency and manual blocker', () => {
    const target = {
      ...task('pm-task-target01', ['pm-task-a0000001', 'pm-task-missing1']),
      manualBlockers: ['Awaiting author response']
    };
    const assessment = assessTaskBlockers(target, [target, task('pm-task-a0000001')]);
    expect(assessment.blocked).toBe(true);
    expect(assessment.explanations).toHaveLength(3);
    expect(assessment.explanations.join(' ')).toContain('Awaiting author response');
    expect(assessment.explanations.join(' ')).toContain('missing');
  });

  it('supports required-task, approval, and combined stage completion', () => {
    const base = DEFAULT_WORKFLOW_TEMPLATE.stages.items[0];
    const required = task('pm-task-required1', [], 'done');
    expect(assessStageCompletion(base, [required]).complete).toBe(true);
    const manual: WorkflowStage = {
      ...base,
      completionMode: 'manual-approval',
      manualApproved: false
    };
    expect(assessStageCompletion(manual, [required]).complete).toBe(false);
    expect(
      assessStageCompletion({ ...manual, completionMode: 'both', manualApproved: true }, [
        task('pm-task-required1')
      ]).complete
    ).toBe(false);
  });

  it('three-way previews preserve local edits and report incoming conflicts', () => {
    const baseline = cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages);
    const current = {
      items: baseline.items.map((stage, index) =>
        index === 0 ? { ...stage, label: 'My Planning' } : stage
      )
    };
    const incoming = {
      items: baseline.items.map((stage, index) =>
        index === 0 ? { ...stage, label: 'Template Planning v2' } : stage
      )
    };
    const preview = previewTemplateMerge(current, baseline, incoming);
    expect(preview.proposedStages.items[0]?.label).toBe('My Planning');
    expect(preview.conflicts[0]).toContain('Preserve local edits');
  });
});
