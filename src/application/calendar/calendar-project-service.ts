/** CAL-001–CAL-003 local projections, dependency previews, task moves, and vault ICS export. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { VaultTextPort } from '../storage/record-storage-ports';
import type { WorkflowProjectService } from '../workflows/workflow-project-service';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import { shiftDateOnly } from '../../domain/launch/launch-plan';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import { joinVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import type { WorkflowTask } from '../../domain/workflows/workflow';

export type CalendarEventKind = 'launch' | 'preorder' | 'price' | 'publication' | 'task';
export interface CalendarEvent {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly kind: CalendarEventKind;
  readonly bookId: string;
  readonly record: CatalogRecord;
  readonly movable: boolean;
  readonly pinned: boolean;
}
export interface CalendarMovePreview {
  readonly event: CalendarEvent;
  readonly proposedDate: string;
  readonly sourceRevision: string;
  readonly blockedReason?: string;
  readonly impacts: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly deadline?: string;
    readonly conflict: boolean;
    readonly explanation: string;
  }[];
}

export class CalendarProjectService {
  public constructor(
    private readonly catalog: BookCatalog,
    private readonly workflows: WorkflowProjectService,
    private readonly vaultText: VaultTextPort,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock
  ) {}

  /** Builds one disposable sorted calendar without copying date truth into a second store. */
  public events(bookIds?: ReadonlySet<string>): readonly CalendarEvent[] {
    const launches = this.catalog.recordsOfType('launch');
    const launchedBooks = new Set(launches.map((item) => String(item.fields['book-id'])));
    const events = [
      ...this.catalog
        .recordsOfType('task')
        .flatMap((record) =>
          this.event(record, 'deadline', 'task', String(record.fields.title), true)
        ),
      ...launches.flatMap((record) =>
        this.event(record, 'publication-date', 'launch', 'Publication launch', false)
      ),
      ...this.catalog
        .recordsOfType('edition')
        .filter((record) => !launchedBooks.has(String(record.fields['book-id'])))
        .flatMap((record) =>
          this.event(
            record,
            'publication-date',
            'publication',
            `${text(record.fields.type, 'Edition')} publication`,
            false
          )
        ),
      ...this.catalog
        .recordsOfType('edition')
        .flatMap((record) =>
          this.event(
            record,
            'preorder-date',
            'preorder',
            `${text(record.fields.type, 'Edition')} preorder`,
            false
          )
        ),
      ...this.catalog
        .recordsOfType('price')
        .flatMap((record) =>
          this.event(
            record,
            'effective-from',
            'price',
            `${text(record.fields.currency, 'Price')} price effective`,
            false
          )
        )
    ];
    return events
      .filter((event) => bookIds === undefined || bookIds.has(event.bookId))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
      );
  }

  /** Names every transitive dependent and flags deadlines contradicted by the proposed prerequisite. */
  public previewMove(eventId: string, proposedDate: string): CalendarMovePreview {
    shiftDateOnly(proposedDate, 0, false);
    const event = this.events().find(({ id }) => id === eventId);
    if (event === undefined) throw new Error('The selected calendar event no longer exists.');
    if (!event.movable)
      throw new Error('Open the responsible workspace to move this canonical date.');
    const task = this.task(event.record);
    const tasks = this.workflows.tasksForWorkflow(task.workflowId);
    const dependants = transitiveDependants(task.id, tasks);
    return {
      event,
      proposedDate,
      sourceRevision: event.record.sourceRevision,
      ...(event.pinned
        ? { blockedReason: 'This launch task date is pinned. Unpin it before moving.' }
        : {}),
      impacts: dependants.map((item) => ({
        taskId: item.id,
        title: item.title,
        ...(item.deadline === undefined ? {} : { deadline: item.deadline }),
        conflict: item.deadline !== undefined && item.deadline < proposedDate,
        explanation:
          item.deadline === undefined
            ? 'Dependent task has no deadline; review its schedule.'
            : item.deadline < proposedDate
              ? `Dependent deadline ${item.deadline} falls before the moved prerequisite.`
              : `Dependent deadline ${item.deadline} remains after the moved prerequisite.`
      }))
    };
  }

  /** Moves only the reviewed task; dependency conflicts require an explicit acceptance. */
  public async applyMove(preview: CalendarMovePreview, acceptConflicts = false): Promise<void> {
    if (preview.blockedReason !== undefined) throw new Error(preview.blockedReason);
    if (preview.impacts.some(({ conflict }) => conflict) && !acceptConflicts)
      throw new Error('Dependency conflicts require explicit acceptance.');
    const current = this.catalog.recordById(preview.event.record.id);
    if (current?.sourceRevision !== preview.sourceRevision)
      throw new Error('The calendar source changed after preview. Preview the move again.');
    const task = this.task(current);
    await this.workflows.editTask(current.path, taskEdit(task, preview.proposedDate));
  }

  /** Writes a portable RFC 5545 all-day calendar file inside the managed vault root. */
  public async exportIcs(events: readonly CalendarEvent[]): Promise<VaultPath> {
    const folder = joinVaultPath(this.layout.rootPath(), 'Exports');
    await this.vaultText.ensureFolder(folder);
    const stamp = this.clock.now().toISOString().slice(0, 10);
    let suffix = 1;
    let path = joinVaultPath(folder, `Publishing-Calendar-${stamp}.ics`);
    while (await this.vaultText.exists(path)) {
      suffix += 1;
      path = joinVaultPath(folder, `Publishing-Calendar-${stamp}-${suffix}.ics`);
    }
    await this.vaultText.create(path, serializeIcs(events, this.clock.now()));
    return path;
  }

  private event(
    record: CatalogRecord,
    key: string,
    kind: CalendarEventKind,
    title: string,
    movable: boolean
  ): readonly CalendarEvent[] {
    const date = record.fields[key];
    const bookId = owningBookId(record, this.catalog);
    if (typeof date !== 'string' || bookId === undefined) return [];
    try {
      shiftDateOnly(date, 0, false);
    } catch {
      return [];
    }
    const metadata = record.fields['linked-metadata'];
    const pinned = isRecord(metadata) && metadata['launch-date-pinned'] === 'true';
    return [
      { id: `${kind}:${record.id}:${key}`, date, title, kind, bookId, record, movable, pinned }
    ];
  }
  private task(record: CatalogRecord): WorkflowTask {
    if (record.type !== 'task') throw new Error('Only workflow task deadlines move in Calendar.');
    const task = this.workflows
      .tasksForWorkflow(String(record.fields['workflow-id']))
      .find(({ id }) => id === record.id);
    if (task === undefined) throw new Error('The calendar task no longer resolves.');
    return task;
  }
}

export function serializeIcs(events: readonly CalendarEvent[], generatedAt: Date): string {
  const timestamp = generatedAt
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z')
    .replaceAll('-', '')
    .replaceAll(':', '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Publishing Manager//Local Calendar//EN',
    'CALSCALE:GREGORIAN'
  ];
  for (const event of [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  )) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(event.id)}@publishing-manager.local`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${shiftDateOnly(event.date, 1, false).replaceAll('-', '')}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(`${event.kind} · ${event.record.id}`)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

function owningBookId(record: CatalogRecord, catalog: BookCatalog): string | undefined {
  if (typeof record.fields['book-id'] === 'string') return record.fields['book-id'];
  const editionId = record.fields['edition-id'];
  if (typeof editionId !== 'string') return undefined;
  const edition = catalog.recordById(editionId);
  return typeof edition?.fields['book-id'] === 'string' ? edition.fields['book-id'] : undefined;
}
function transitiveDependants(
  taskId: string,
  tasks: readonly WorkflowTask[]
): readonly WorkflowTask[] {
  const found = new Map<string, WorkflowTask>();
  const queue = [taskId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const task of tasks)
      if (task.dependsOn.includes(current) && !found.has(task.id)) {
        found.set(task.id, task);
        queue.push(task.id);
      }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function taskEdit(task: WorkflowTask, deadline: string) {
  return {
    workflowId: task.workflowId,
    stageId: task.stageId,
    ...(task.editionId === undefined ? {} : { editionId: task.editionId }),
    title: task.title,
    status: task.status,
    priority: task.priority,
    required: task.required,
    deadline,
    ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    ...(task.actualMinutes === undefined ? {} : { actualMinutes: task.actualMinutes }),
    ...(task.owner === undefined ? {} : { owner: task.owner }),
    ...(task.notes === undefined ? {} : { notes: task.notes }),
    attachments: task.attachments,
    checklist: task.checklist,
    dependsOn: task.dependsOn,
    manualBlockers: task.manualBlockers,
    linkedMetadata: task.linkedMetadata
  };
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
function escapeIcs(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}
