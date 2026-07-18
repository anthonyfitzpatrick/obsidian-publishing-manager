/** Exercises WFL-001–WFL-009 through canonical Markdown and the disposable catalog. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { WorkflowProjectService } from '../../src/application/workflows/workflow-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { cloneStages, DEFAULT_WORKFLOW_TEMPLATE } from '../../src/domain/workflows/workflow';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-18T16:00:00.000Z');
  }
}
class SequenceIds implements IdGenerator {
  private next = 0;
  public generate(): string {
    this.next += 1;
    return `30000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
  }
}

async function harness() {
  const vault = new MemoryVaultTextPort();
  const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
  const clock = new FixedClock();
  const ids = new SequenceIds();
  const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
  const catalog = new BookCatalog(repository, clock);
  const books = new BookProjectService(repository, catalog, layout, clock, ids);
  const workflows = new WorkflowProjectService(repository, catalog, layout, clock, ids);
  await catalog.initialize([]);
  const book = await books.create({
    title: 'Workflow Test',
    primaryLanguage: 'en',
    status: 'active'
  });
  const workflow = await workflows.instantiateDefault(book.book.id);
  return { vault, repository, catalog, books, workflows, book, workflow };
}

describe('workflow project service', () => {
  it('instantiates one independent default workflow per book and rejects active duplicates', async () => {
    const { workflows, workflow, book, catalog } = await harness();
    expect(workflow.path).toContain('Publishing Manager/Workflows/');
    expect(workflow.workflow.stages.items).toHaveLength(16);
    expect(workflow.workflow.templateBaseline).not.toBe(DEFAULT_WORKFLOW_TEMPLATE.stages);
    expect(catalog.snapshot().workflows).toHaveLength(1);
    await expect(workflows.instantiateDefault(book.book.id)).rejects.toMatchObject({
      code: 'duplicate-workflow'
    });
  });

  it('adds, branches, renames, reorders, skips, and archives stages without changing category', async () => {
    const { workflows, workflow } = await harness();
    const added = await workflows.addStage(workflow.path, {
      category: 'custom',
      label: 'Sensitivity Review',
      afterStageId: 'stage-development-edit',
      branchFromStageId: 'stage-draft',
      completionMode: 'both'
    });
    const custom = added.workflow.stages.items.find(({ label }) => label === 'Sensitivity Review')!;
    expect(custom.branchFromStageId).toBe('stage-draft');
    const edited = await workflows.editStage(workflow.path, custom.id, {
      label: 'Specialist Review',
      order: 2,
      status: 'skipped',
      completionMode: 'both',
      manualApproved: false,
      dependsOnStageIds: ['stage-planning'],
      notes: 'Preserve reporting as custom.',
      attachments: []
    });
    const result = edited.workflow.stages.items.find(({ id }) => id === custom.id)!;
    expect(result.category).toBe('custom');
    expect(result.label).toBe('Specialist Review');
    expect(result.status).toBe('skipped');
    expect(result.order).toBe(2);
  });

  it('tracks complete task data and rejects a dependency cycle with its exact path', async () => {
    const { workflows, workflow } = await harness();
    const first = await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: 'stage-planning',
      title: 'Approve plan',
      priority: 'high',
      deadline: '2026-08-01',
      estimateMinutes: 90,
      actualMinutes: 15,
      owner: 'Editor',
      notes: 'Fictional task.',
      attachments: ['Production/brief.md'],
      checklist: [{ text: 'Read brief' }],
      manualBlockers: ['Awaiting estimate'],
      linkedMetadata: { field: 'summary' }
    });
    const second = await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: 'stage-draft',
      title: 'Draft package',
      dependsOn: [first.task.id]
    });
    expect(first.task.checklist.items[0]?.text).toBe('Read brief');
    expect(workflows.assessTask(first.task.id).explanations).toContain(
      'Manual blocker: Awaiting estimate'
    );
    await expect(
      workflows.editTask(first.path, {
        workflowId: workflow.workflow.id,
        stageId: 'stage-planning',
        title: first.task.title,
        status: 'not-started',
        priority: 'high',
        required: true,
        attachments: [],
        checklist: first.task.checklist,
        dependsOn: [second.task.id],
        manualBlockers: [],
        linkedMetadata: {}
      })
    ).rejects.toMatchObject({
      code: 'dependency-cycle',
      cycle: [first.task.id, second.task.id, first.task.id]
    });
  });

  it('derives stage completion and previews template updates without mutating local edits', async () => {
    const { workflows, workflow, catalog } = await harness();
    const task = await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: 'stage-planning',
      title: 'Required planning task'
    });
    expect(workflows.assessStage(workflow.workflow.id, 'stage-planning').complete).toBe(false);
    await expect(workflows.completeStage(workflow.path, 'stage-planning')).rejects.toMatchObject({
      code: 'stage-invalid'
    });
    await workflows.editTask(task.path, {
      workflowId: workflow.workflow.id,
      stageId: 'stage-planning',
      title: task.task.title,
      status: 'done',
      priority: 'normal',
      required: true,
      attachments: [],
      checklist: task.task.checklist,
      dependsOn: [],
      manualBlockers: [],
      linkedMetadata: {}
    });
    expect(workflows.assessStage(workflow.workflow.id, 'stage-planning').complete).toBe(true);
    const completed = await workflows.completeStage(workflow.path, 'stage-planning');
    expect(completed.workflow.stages.items[0]?.status).toBe('complete');
    const planning = workflow.workflow.stages.items[0]!;
    await workflows.editStage(workflow.path, planning.id, {
      label: 'My Planning',
      order: 1,
      status: 'active',
      completionMode: 'required-tasks',
      manualApproved: false,
      dependsOnStageIds: [],
      attachments: []
    });
    const incoming = {
      items: cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages).items.map((stage, index) =>
        index === 0 ? { ...stage, label: 'Template Planning v2' } : stage
      )
    };
    const preview = workflows.previewTemplateUpdate(workflow.workflow.id, incoming);
    expect(preview.proposedStages.items[0]?.label).toBe('My Planning');
    expect(preview.conflicts).toHaveLength(1);
    expect(
      (catalog.recordById(workflow.workflow.id)?.fields.stages as { items: { label: string }[] })
        .items[0]?.label
    ).toBe('My Planning');
  });
});
