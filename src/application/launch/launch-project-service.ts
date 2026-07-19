/** LCH-001–LCH-006 preview-first launch generation over canonical workflow tasks. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import type { WorkflowProjectService } from '../workflows/workflow-project-service';
import {
  DEFAULT_LAUNCH_TEMPLATE,
  criticalPath,
  shiftDateOnly,
  type LaunchPreviewRow,
  type LaunchReflowMode
} from '../../domain/launch/launch-plan';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { WorkflowTask } from '../../domain/workflows/workflow';

export interface LaunchPlanPreview {
  readonly bookId: string;
  readonly editionId?: string;
  readonly publicationDate: string;
  readonly mode: LaunchReflowMode;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly launchId?: string;
  readonly launchRevision?: string;
  readonly workflowId: string;
  readonly rows: readonly LaunchPreviewRow[];
  readonly criticalPath: readonly string[];
}

export class LaunchProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly workflows: WorkflowProjectService,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  public launchesForBook(bookId: string): readonly CatalogRecord[] {
    return this.catalog.recordsOfType('launch').filter((item) => item.fields['book-id'] === bookId);
  }

  /** Produces a complete non-mutating diff, including protection and conflict reasons. */
  public preview(input: {
    bookId: string;
    editionId?: string;
    publicationDate: string;
    mode: LaunchReflowMode;
  }): LaunchPlanPreview {
    // Validating offset zero also validates leap days and impossible calendar values.
    shiftDateOnly(input.publicationDate, 0, false);
    const book = this.catalog.recordById(input.bookId);
    if (book?.type !== 'book') throw new Error('Choose one valid book for the launch plan.');
    if (input.editionId !== undefined) {
      const edition = this.catalog.recordById(input.editionId);
      if (edition?.type !== 'edition' || edition.fields['book-id'] !== input.bookId)
        throw new Error('The launch edition must belong to the selected book.');
    }
    const workflowRecord = this.workflows
      .workflowsForBook(input.bookId)
      .find(({ archived }) => !archived);
    if (workflowRecord === undefined)
      throw new Error('Create an active workflow before generating launch tasks.');
    const stages = stageList(workflowRecord.fields.stages);
    const tasks = this.workflows.tasksForWorkflow(workflowRecord.id);
    const existingByCode = new Map(
      tasks.flatMap((task) => {
        const code = task.linkedMetadata['launch-milestone-code'];
        return code === undefined ? [] : [[code, task] as const];
      })
    );
    const today = this.clock.now().toISOString().slice(0, 10);
    const rows = DEFAULT_LAUNCH_TEMPLATE.milestones.map((milestone): LaunchPreviewRow => {
      const proposedDate = shiftDateOnly(
        input.publicationDate,
        milestone.offsetDays,
        milestone.workingDays
      );
      const task = existingByCode.get(milestone.code);
      const taskRecord = task === undefined ? undefined : this.catalog.recordById(task.id);
      const pinned = task?.linkedMetadata['launch-date-pinned'] === 'true';
      const complete = task?.status === 'done' || task?.status === 'cancelled';
      const preservePast =
        input.mode === 'future-incomplete' && task?.deadline !== undefined && task.deadline < today;
      const action =
        input.mode === 'anchor-only'
          ? 'anchor-only'
          : task === undefined
            ? 'create'
            : complete
              ? 'preserve-complete'
              : pinned
                ? 'preserve-pinned'
                : preservePast
                  ? 'preserve-past'
                  : 'update';
      const stage = stages.find(({ category }) => category === milestone.stageCategory);
      return {
        code: milestone.code,
        label: milestone.label,
        proposedDate,
        ...(task?.deadline === undefined ? {} : { previousDate: task.deadline }),
        action,
        ...(stage === undefined
          ? { conflict: `Workflow has no ${milestone.stageCategory} stage.` }
          : {}),
        past: proposedDate < today,
        ...(task === undefined ? {} : { taskId: task.id }),
        ...(taskRecord === undefined ? {} : { sourceRevision: taskRecord.sourceRevision })
      };
    });
    const launch = this.launchesForBook(input.bookId).find(({ archived }) => !archived);
    return {
      bookId: input.bookId,
      ...(input.editionId === undefined ? {} : { editionId: input.editionId }),
      publicationDate: input.publicationDate,
      mode: input.mode,
      templateId: DEFAULT_LAUNCH_TEMPLATE.id,
      templateVersion: DEFAULT_LAUNCH_TEMPLATE.version,
      ...(launch === undefined
        ? {}
        : { launchId: launch.id, launchRevision: launch.sourceRevision }),
      workflowId: workflowRecord.id,
      rows,
      criticalPath: criticalPath(DEFAULT_LAUNCH_TEMPLATE)
    };
  }

  /** Applies exactly the reviewed rows; stale task/launch revisions force a fresh preview. */
  public async apply(preview: LaunchPlanPreview): Promise<CatalogRecord> {
    if (preview.rows.some(({ conflict }) => conflict !== undefined))
      throw new Error('Resolve every launch preview conflict before applying.');
    for (const row of preview.rows) {
      if (
        row.taskId !== undefined &&
        this.catalog.recordById(row.taskId)?.sourceRevision !== row.sourceRevision
      )
        throw new Error('A launch task changed after preview. Generate a fresh preview.');
    }
    const workflowRecord = this.catalog.recordById(preview.workflowId);
    if (workflowRecord?.type !== 'workflow')
      throw new Error('The preview workflow no longer exists.');
    const stages = stageList(workflowRecord.fields.stages);
    const taskIds = new Map<string, string>();
    for (const row of preview.rows) if (row.taskId !== undefined) taskIds.set(row.code, row.taskId);
    for (const row of preview.rows) {
      const milestone = DEFAULT_LAUNCH_TEMPLATE.milestones.find(({ code }) => code === row.code)!;
      const stage = stages.find(({ category }) => category === milestone.stageCategory)!;
      if (row.action === 'create') {
        const created = await this.workflows.createTask({
          workflowId: preview.workflowId,
          stageId: stage.id,
          ...(preview.editionId === undefined ? {} : { editionId: preview.editionId }),
          title: milestone.label,
          deadline: row.proposedDate,
          estimateMinutes: milestone.estimateMinutes,
          dependsOn: milestone.dependsOn.flatMap((code) => {
            const id = taskIds.get(code);
            return id === undefined ? [] : [id];
          }),
          linkedMetadata: {
            'launch-milestone-code': row.code,
            'launch-template-id': preview.templateId
          }
        });
        taskIds.set(row.code, created.task.id);
      } else if (row.action === 'update' && row.taskId !== undefined) {
        const task = this.workflows
          .tasksForWorkflow(preview.workflowId)
          .find(({ id }) => id === row.taskId)!;
        await this.workflows.editTask(
          this.catalog.recordById(task.id)!.path,
          taskEdit(task, row.proposedDate)
        );
      }
    }
    const fields = {
      'book-id': preview.bookId,
      ...(preview.editionId === undefined ? {} : { 'edition-id': preview.editionId }),
      'publication-date': preview.publicationDate,
      'template-id': preview.templateId,
      'template-version': preview.templateVersion,
      'reflow-mode': preview.mode,
      milestones: {
        items: preview.rows.map((row) => ({
          code: row.code,
          label: row.label,
          date: row.action.startsWith('preserve')
            ? (row.previousDate ?? row.proposedDate)
            : row.proposedDate,
          action: row.action,
          taskId: taskIds.get(row.code),
          past: row.past
        }))
      },
      'critical-path': [...preview.criticalPath]
    };
    const existing =
      preview.launchId === undefined ? undefined : this.catalog.recordById(preview.launchId);
    if (existing !== undefined) {
      if (existing.sourceRevision !== preview.launchRevision)
        throw new Error('The launch changed after preview. Generate a fresh preview.');
      const saved = await this.repository.save(
        await this.repository.load(existing.path),
        { fields },
        this.clock.now().toISOString()
      );
      this.catalog.accept(saved, 'modified');
      return this.catalog.recordById(saved.envelope.pmId)!;
    }
    const now = this.clock.now().toISOString();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(
        'launch',
        `${String(this.catalog.recordById(preview.bookId)?.fields.title)} launch`,
        this.catalog.knownPaths()
      ),
      {
        envelope: {
          pmId: `pm-launch-${safeId(this.ids.generate())}`,
          pmType: 'launch',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields,
        body: '# Launch plan\n\nGenerated from a reviewed local template preview.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
    return this.catalog.recordById(loaded.envelope.pmId)!;
  }

  /** Pinning is explicit task evidence and does not change completion or dependencies. */
  public async setPinned(taskId: string, pinned: boolean): Promise<void> {
    const record = this.catalog.recordById(taskId);
    const workflowId = record?.type === 'task' ? String(record.fields['workflow-id']) : '';
    const task = this.workflows.tasksForWorkflow(workflowId).find(({ id }) => id === taskId);
    if (record?.type !== 'task' || task === undefined)
      throw new Error('Choose one launch task to pin.');
    await this.workflows.editTask(record.path, taskEdit(task, task.deadline, pinned));
  }
}

function taskEdit(task: WorkflowTask, deadline?: string, pinned?: boolean) {
  const linkedMetadata = { ...task.linkedMetadata };
  if (pinned === true) linkedMetadata['launch-date-pinned'] = 'true';
  if (pinned === false) delete linkedMetadata['launch-date-pinned'];
  return {
    workflowId: task.workflowId,
    stageId: task.stageId,
    ...(task.editionId === undefined ? {} : { editionId: task.editionId }),
    title: task.title,
    status: task.status,
    priority: task.priority,
    required: task.required,
    ...(deadline === undefined ? {} : { deadline }),
    ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    ...(task.actualMinutes === undefined ? {} : { actualMinutes: task.actualMinutes }),
    ...(task.owner === undefined ? {} : { owner: task.owner }),
    ...(task.notes === undefined ? {} : { notes: task.notes }),
    attachments: task.attachments,
    checklist: task.checklist,
    dependsOn: task.dependsOn,
    manualBlockers: task.manualBlockers,
    linkedMetadata
  };
}

function stageList(value: unknown): readonly { id: string; category: string }[] {
  if (typeof value !== 'object' || value === null) return [];
  const items = (value as Readonly<Record<string, unknown>>).items;
  if (!Array.isArray(items)) return [];
  return (items as readonly unknown[]).flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const fields = item as Readonly<Record<string, unknown>>;
    return typeof fields.id === 'string' && typeof fields.category === 'string'
      ? [{ id: fields.id, category: fields.category }]
      : [];
  });
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
