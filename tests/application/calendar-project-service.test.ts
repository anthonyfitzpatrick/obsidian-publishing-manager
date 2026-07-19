/** Exercises local projections, dependency impact previews, guarded moves, and ICS creation. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { CalendarProjectService } from '../../src/application/calendar/calendar-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { WorkflowProjectService } from '../../src/application/workflows/workflow-project-service';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
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
    return `c0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('calendar project service', () => {
  it('previews dependency conflicts, guards pinned dates, and writes a local ICS file', async () => {
    const vault = new MemoryVaultTextPort();
    const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
    const clock = new FixedClock();
    const ids = new Ids();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    await catalog.initialize([]);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const workflows = new WorkflowProjectService(repository, catalog, layout, clock, ids);
    const calendar = new CalendarProjectService(catalog, workflows, vault, layout, clock);
    const book = await books.create({
      title: 'Calendar Test',
      primaryLanguage: 'en',
      status: 'active'
    });
    const workflow = await workflows.instantiateDefault(book.book.id);
    const stage = workflow.workflow.stages.items[0]!;
    const prerequisite = await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: stage.id,
      title: 'Prerequisite',
      deadline: '2026-08-01'
    });
    await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: stage.id,
      title: 'Dependent',
      deadline: '2026-08-10',
      dependsOn: [prerequisite.task.id]
    });
    await workflows.createTask({
      workflowId: workflow.workflow.id,
      stageId: stage.id,
      title: 'Pinned',
      deadline: '2026-08-05',
      linkedMetadata: { 'launch-date-pinned': 'true' }
    });

    const events = calendar.events(new Set([book.book.id]));
    expect(events.map(({ title }) => title)).toEqual(['Prerequisite', 'Pinned', 'Dependent']);
    const move = calendar.previewMove(
      events.find(({ title }) => title === 'Prerequisite')!.id,
      '2026-08-12'
    );
    expect(move.impacts).toHaveLength(1);
    expect(move.impacts[0]?.title).toBe('Dependent');
    expect(move.impacts[0]?.conflict).toBe(true);
    await expect(calendar.applyMove(move)).rejects.toThrow('explicit acceptance');
    await calendar.applyMove(move, true);
    expect(
      workflows.tasksForWorkflow(workflow.workflow.id).find(({ id }) => id === prerequisite.task.id)
        ?.deadline
    ).toBe('2026-08-12');
    const pinned = calendar.previewMove(
      calendar.events().find(({ title }) => title === 'Pinned')!.id,
      '2026-08-20'
    );
    expect(pinned.blockedReason).toContain('pinned');
    await expect(calendar.applyMove(pinned)).rejects.toThrow('pinned');

    const path = await calendar.exportIcs(calendar.events());
    expect(path).toBe('Publishing Manager/Exports/Publishing-Calendar-2026-07-19.ics');
    const source = vault.files.get(path);
    expect(source).toContain('BEGIN:VCALENDAR\r\n');
    expect(source).toContain('DTSTAMP:20260719T120000Z');
    expect(source).toContain('DTSTART;VALUE=DATE:20260812');
    expect(source).toContain('DTEND;VALUE=DATE:20260813');
    expect(source).not.toContain('http');
  });
});
