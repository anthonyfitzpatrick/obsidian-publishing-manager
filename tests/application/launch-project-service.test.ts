/** Exercises preview/apply, generated dependencies, and completed/pinned reflow protection. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { LaunchProjectService } from '../../src/application/launch/launch-project-service';
import { WorkflowProjectService } from '../../src/application/workflows/workflow-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import type { WorkflowTask } from '../../src/domain/workflows/workflow';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now() {
    return new Date('2026-07-19T12:00:00.000Z');
  }
}
class Ids implements IdGenerator {
  private n = 0;
  public generate() {
    return `b0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('launch project service', () => {
  it('creates a reviewed plan and preserves manually pinned and completed dates', async () => {
    const repository = new VaultManagedRecordRepository(
      new MemoryVaultTextPort(),
      new JsonTestFrontmatterCodec()
    );
    const clock = new FixedClock();
    const ids = new Ids();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    await catalog.initialize([]);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const workflows = new WorkflowProjectService(repository, catalog, layout, clock, ids);
    const launches = new LaunchProjectService(repository, catalog, workflows, layout, clock, ids);
    const book = await books.create({
      title: 'Launch Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const workflow = await workflows.instantiateDefault(book.book.id);

    const first = launches.preview({
      bookId: book.book.id,
      publicationDate: '2026-10-01',
      mode: 'all-unpinned'
    });
    expect(first.rows.map(({ action }) => action)).toEqual([
      'create',
      'create',
      'create',
      'create',
      'create'
    ]);
    await launches.apply(first);
    expect(launches.launchesForBook(book.book.id)).toHaveLength(1);
    const tasks = workflows.tasksForWorkflow(workflow.workflow.id);
    expect(tasks).toHaveLength(5);
    const pinned = taskByCode(tasks, 'L-60');
    const complete = taskByCode(tasks, 'L-30');
    await launches.setPinned(pinned.id, true);
    await workflows.editTask(catalog.recordById(complete.id)!.path, edit(complete, 'done'));

    const reflow = launches.preview({
      bookId: book.book.id,
      publicationDate: '2026-11-01',
      mode: 'all-unpinned'
    });
    expect(reflow.rows.find(({ code }) => code === 'L-60')?.action).toBe('preserve-pinned');
    expect(reflow.rows.find(({ code }) => code === 'L-30')?.action).toBe('preserve-complete');
    expect(reflow.rows.find(({ code }) => code === 'LAUNCH')?.action).toBe('update');
    await launches.apply(reflow);
    expect(
      workflows.tasksForWorkflow(workflow.workflow.id).find(({ id }) => id === pinned.id)?.deadline
    ).toBe(pinned.deadline);

    const past = taskByCode(workflows.tasksForWorkflow(workflow.workflow.id), 'L-90');
    await workflows.editTask(catalog.recordById(past.id)!.path, edit(past, 'active', '2026-07-01'));
    const futureOnly = launches.preview({
      bookId: book.book.id,
      publicationDate: '2026-12-01',
      mode: 'future-incomplete'
    });
    expect(futureOnly.rows.find(({ code }) => code === 'L-90')?.action).toBe('preserve-past');
    const beforeAnchorOnly = workflows
      .tasksForWorkflow(workflow.workflow.id)
      .map(({ id, deadline }) => [id, deadline]);
    const anchorOnly = launches.preview({
      bookId: book.book.id,
      publicationDate: '2027-01-01',
      mode: 'anchor-only'
    });
    expect(anchorOnly.rows.every(({ action }) => action === 'anchor-only')).toBe(true);
    await launches.apply(anchorOnly);
    expect(
      workflows.tasksForWorkflow(workflow.workflow.id).map(({ id, deadline }) => [id, deadline])
    ).toEqual(beforeAnchorOnly);
  });
});

function taskByCode(tasks: readonly WorkflowTask[], code: string): WorkflowTask {
  const task = tasks.find((item) => item.linkedMetadata['launch-milestone-code'] === code);
  if (task === undefined) throw new Error(`Missing ${code}.`);
  return task;
}
function edit(task: WorkflowTask, status: WorkflowTask['status'], deadline = task.deadline) {
  return {
    workflowId: task.workflowId,
    stageId: task.stageId,
    title: task.title,
    status,
    priority: task.priority,
    required: task.required,
    ...(deadline === undefined ? {} : { deadline }),
    ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    attachments: task.attachments,
    checklist: task.checklist,
    dependsOn: task.dependsOn,
    manualBlockers: task.manualBlockers,
    linkedMetadata: task.linkedMetadata
  };
}
