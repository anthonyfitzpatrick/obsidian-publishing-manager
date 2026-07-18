/**
 * Coordinates the WFL-001–WFL-009 engine through canonical records. The service instantiates an
 * immutable template snapshot per book, mutates one workflow/task record at a time, rejects graph
 * cycles before writes, and exposes derived blocker/completion/merge evidence without persisting it.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type {
  LoadedManagedRecord,
  ManagedRecordRepositoryPort
} from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import {
  DEFAULT_WORKFLOW_TEMPLATE,
  assessStageCompletion,
  assessTaskBlockers,
  cloneStages,
  findTaskDependencyCycle,
  hydrateWorkflowProject,
  hydrateWorkflowTask,
  previewTemplateMerge,
  validateWorkflowProject,
  validateWorkflowTask,
  type Checklist,
  type StageCompletionAssessment,
  type StageCompletionMode,
  type TaskBlockerAssessment,
  type TaskPriority,
  type TaskStatus,
  type TemplateMergePreview,
  type WorkflowProject,
  type WorkflowStage,
  type WorkflowStageCategory,
  type WorkflowStageCollection,
  type WorkflowStageStatus,
  type WorkflowTask
} from '../../domain/workflows/workflow';

export interface WorkflowProjectResult {
  readonly path: VaultPath;
  readonly workflow: WorkflowProject;
}
export interface WorkflowTaskResult {
  readonly path: VaultPath;
  readonly task: WorkflowTask;
}

export interface AddStageInput {
  readonly category: WorkflowStageCategory;
  readonly label: string;
  readonly afterStageId?: string;
  readonly branchFromStageId?: string;
  readonly completionMode?: StageCompletionMode;
  readonly owner?: string;
  readonly notes?: string;
}

export interface EditStageInput {
  readonly label: string;
  readonly order: number;
  readonly status: WorkflowStageStatus;
  readonly completionMode: StageCompletionMode;
  readonly manualApproved: boolean;
  readonly dependsOnStageIds: readonly string[];
  readonly owner?: string;
  readonly notes?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly actualStart?: string;
  readonly actualEnd?: string;
  readonly attachments: readonly string[];
}

interface TaskCoreInput {
  readonly workflowId: string;
  readonly stageId: string;
  readonly editionId?: string;
  readonly title: string;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly required?: boolean;
  readonly deadline?: string;
  readonly estimateMinutes?: number;
  readonly actualMinutes?: number;
  readonly owner?: string;
  readonly notes?: string;
  readonly attachments?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly manualBlockers?: readonly string[];
  readonly linkedMetadata?: Readonly<Record<string, string>>;
}

export interface CreateTaskInput extends TaskCoreInput {
  readonly checklist?: readonly {
    readonly text: string;
    readonly required?: boolean;
    readonly done?: boolean;
  }[];
}

export interface EditTaskInput extends TaskCoreInput {
  readonly checklist: Checklist;
}

/** Typed cycle failure retains the exact closed path without forcing UI to parse prose. */
export class WorkflowProjectServiceError extends Error {
  public constructor(
    public readonly code:
      | 'book-not-found'
      | 'dependency-cycle'
      | 'duplicate-workflow'
      | 'record-type-invalid'
      | 'stage-invalid'
      | 'task-invalid'
      | 'task-not-found'
      | 'workflow-invalid'
      | 'workflow-not-found',
    message: string,
    public readonly cycle?: readonly string[]
  ) {
    super(message);
    this.name = 'WorkflowProjectServiceError';
  }
}

export class WorkflowProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Copies the bundled template into one independent canonical workflow for a valid book. */
  public async instantiateDefault(bookId: string): Promise<WorkflowProjectResult> {
    const book = this.catalog.recordById(bookId);
    if (book?.type !== 'book')
      throw new WorkflowProjectServiceError(
        'book-not-found',
        'Choose one valid book before creating a workflow.'
      );
    const existing = this.workflowsForBook(bookId).find(({ archived }) => !archived);
    if (existing !== undefined)
      throw new WorkflowProjectServiceError(
        'duplicate-workflow',
        'This book already has an active workflow. Open or archive it instead of creating a duplicate.'
      );
    const now = this.now();
    const fields = {
      'book-id': bookId,
      name: DEFAULT_WORKFLOW_TEMPLATE.name,
      status: 'active',
      'template-id': DEFAULT_WORKFLOW_TEMPLATE.id,
      'template-version': DEFAULT_WORKFLOW_TEMPLATE.version,
      'template-baseline': cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages),
      stages: cloneStages(DEFAULT_WORKFLOW_TEMPLATE.stages)
    };
    assertValidWorkflow(fields);
    const path = this.layout.collisionSafePath(
      'workflow',
      `${String(book.fields.title)} workflow`,
      this.catalog.knownPaths()
    );
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: managedId('workflow', this.ids.generate()),
        pmType: 'workflow',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Workflow notes\n\nThis workflow is an independent snapshot of its source template.\n'
    });
    this.catalog.accept(loaded, 'created');
    return { path, workflow: hydrateWorkflowProject(loaded) };
  }

  public workflowsForBook(bookId: string): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType('workflow')
      .filter((record) => record.fields['book-id'] === bookId);
  }
  public tasksForWorkflow(workflowId: string): readonly WorkflowTask[] {
    return this.catalog
      .recordsOfType('task')
      .filter((record) => record.fields['workflow-id'] === workflowId)
      .map(hydrateCatalogTask);
  }

  /** Adds a stage or explicit branch while retaining immutable stable reporting category. */
  public async addStage(path: VaultPath, input: AddStageInput): Promise<WorkflowProjectResult> {
    const loaded = await this.requireWorkflow(path);
    const workflow = hydrateWorkflowProject(loaded);
    const stages = workflow.stages.items.map(cloneStage);
    const afterIndex =
      input.afterStageId === undefined
        ? stages.length - 1
        : stages.findIndex(({ id }) => id === input.afterStageId);
    if (input.afterStageId !== undefined && afterIndex < 0)
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        'The selected insertion stage no longer exists.'
      );
    if (
      input.branchFromStageId !== undefined &&
      !stages.some(({ id }) => id === input.branchFromStageId)
    )
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        'The selected branch source no longer exists.'
      );
    const newStage: WorkflowStage = {
      id: `stage-${safeOpaque(this.ids.generate())}`,
      category: input.category,
      label: input.label,
      order: afterIndex + 2,
      status: 'not-started',
      completionMode: input.completionMode ?? 'required-tasks',
      manualApproved: false,
      dependsOnStageIds:
        input.branchFromStageId === undefined
          ? afterIndex < 0
            ? []
            : [stages[afterIndex]!.id]
          : [input.branchFromStageId],
      ...(input.branchFromStageId === undefined
        ? {}
        : { branchFromStageId: input.branchFromStageId }),
      ...(input.owner === undefined ? {} : { owner: input.owner }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      attachments: []
    };
    stages.splice(afterIndex + 1, 0, newStage);
    return this.saveStages(loaded, { items: reorder(stages) });
  }

  /** Renames, reorders, skips, archives, branches, schedules, and approves one retained stage. */
  public async editStage(
    path: VaultPath,
    stageId: string,
    input: EditStageInput
  ): Promise<WorkflowProjectResult> {
    const loaded = await this.requireWorkflow(path);
    const workflow = hydrateWorkflowProject(loaded);
    const stages = workflow.stages.items.map(cloneStage);
    const index = stages.findIndex(({ id }) => id === stageId);
    if (index < 0)
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        'The selected stage no longer exists.'
      );
    for (const attachment of input.attachments) normalizeVaultPath(attachment);
    const current = stages[index]!;
    const proposed: WorkflowStage = {
      id: current.id,
      category: current.category,
      ...(current.branchFromStageId === undefined
        ? {}
        : { branchFromStageId: current.branchFromStageId }),
      label: input.label,
      order: input.order,
      status: input.status,
      completionMode: input.completionMode,
      manualApproved: input.manualApproved,
      dependsOnStageIds: [...input.dependsOnStageIds],
      ...optionalStageFields(input),
      attachments: [...input.attachments]
    };
    if (input.status === 'complete') {
      const completion = assessStageCompletion(proposed, this.tasksForWorkflow(workflow.id));
      if (!completion.complete) {
        throw new WorkflowProjectServiceError(
          'stage-invalid',
          `Stage cannot complete: ${completion.explanations.join(' ')}`
        );
      }
    }
    stages[index] = proposed;
    stages.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return this.saveStages(loaded, { items: reorder(stages) });
  }

  /** Creates the complete WFL-005 task and proves its proposed graph remains acyclic first. */
  public async createTask(input: CreateTaskInput): Promise<WorkflowTaskResult> {
    const workflowRecord = this.requireWorkflowRecord(input.workflowId);
    const workflow = hydrateCatalogWorkflow(workflowRecord);
    this.assertTaskLinks(workflow, input);
    const id = managedId('task', this.ids.generate());
    const fields = taskFields(
      workflow.bookId,
      id,
      input,
      checklistFromInput(input.checklist ?? [], this.ids)
    );
    assertValidTask(fields);
    this.assertAcyclic([...this.tasksForWorkflow(workflow.id), hydrateProposedTask(id, fields)]);
    const now = this.now();
    const path = this.layout.collisionSafePath('task', input.title, this.catalog.knownPaths());
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: id,
        pmType: 'task',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Task notes\n'
    });
    this.catalog.accept(loaded, 'created');
    return { path, task: hydrateWorkflowTask(loaded) };
  }

  /** Saves all editable task evidence and rejects the exact cycle before canonical mutation. */
  public async editTask(path: VaultPath, input: EditTaskInput): Promise<WorkflowTaskResult> {
    const loaded = await this.requireTask(path);
    const current = hydrateWorkflowTask(loaded);
    const workflowRecord = this.requireWorkflowRecord(current.workflowId);
    const workflow = hydrateCatalogWorkflow(workflowRecord);
    this.assertTaskLinks(workflow, input);
    const fields = taskFields(workflow.bookId, current.id, input, input.checklist);
    assertValidTask(fields);
    const proposed = hydrateProposedTask(current.id, fields);
    this.assertAcyclic([
      ...this.tasksForWorkflow(workflow.id).filter(({ id }) => id !== current.id),
      proposed
    ]);
    const patch = editableTaskPatch(fields, input);
    const saved = await this.repository.save(loaded, { fields: patch }, this.now());
    this.catalog.accept(saved, 'modified');
    return { path, task: hydrateWorkflowTask(saved) };
  }

  public assessTask(taskId: string): TaskBlockerAssessment {
    const task = this.requireTaskProjection(taskId);
    return assessTaskBlockers(task, this.tasksForWorkflow(task.workflowId));
  }
  public assessStage(workflowId: string, stageId: string): StageCompletionAssessment {
    const workflow = hydrateCatalogWorkflow(this.requireWorkflowRecord(workflowId));
    const stage = workflow.stages.items.find(({ id }) => id === stageId);
    if (stage === undefined)
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        'The selected stage no longer exists.'
      );
    return assessStageCompletion(stage, this.tasksForWorkflow(workflowId));
  }

  /** Persists completion only after evaluating the configured rule against current tasks. */
  public async completeStage(path: VaultPath, stageId: string): Promise<WorkflowProjectResult> {
    const loaded = await this.requireWorkflow(path);
    const workflow = hydrateWorkflowProject(loaded);
    const stages = workflow.stages.items.map(cloneStage);
    const index = stages.findIndex(({ id }) => id === stageId);
    if (index < 0) {
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        'The selected stage no longer exists.'
      );
    }
    const current = stages[index]!;
    const assessment = assessStageCompletion(current, this.tasksForWorkflow(workflow.id));
    if (!assessment.complete) {
      throw new WorkflowProjectServiceError(
        'stage-invalid',
        `Stage cannot complete: ${assessment.explanations.join(' ')}`
      );
    }
    stages[index] = { ...current, status: 'complete' };
    return this.saveStages(loaded, { items: stages });
  }

  /** Builds WFL-009 three-way evidence but deliberately leaves the current workflow unchanged. */
  public previewTemplateUpdate(
    workflowId: string,
    incoming: WorkflowStageCollection = DEFAULT_WORKFLOW_TEMPLATE.stages
  ): TemplateMergePreview {
    const workflow = hydrateCatalogWorkflow(this.requireWorkflowRecord(workflowId));
    return previewTemplateMerge(workflow.stages, workflow.templateBaseline, incoming);
  }

  private async saveStages(
    loaded: LoadedManagedRecord,
    stages: WorkflowStageCollection
  ): Promise<WorkflowProjectResult> {
    const fields = { ...loaded.fields, stages };
    assertValidWorkflow(fields);
    const saved = await this.repository.save(loaded, { fields: { stages } }, this.now());
    this.catalog.accept(saved, 'modified');
    return { path: saved.path, workflow: hydrateWorkflowProject(saved) };
  }
  private async requireWorkflow(path: VaultPath): Promise<LoadedManagedRecord> {
    const loaded = await this.repository.load(path);
    if (loaded.envelope.pmType !== 'workflow')
      throw new WorkflowProjectServiceError(
        'record-type-invalid',
        'The selected record is not a workflow.'
      );
    return loaded;
  }
  private async requireTask(path: VaultPath): Promise<LoadedManagedRecord> {
    const loaded = await this.repository.load(path);
    if (loaded.envelope.pmType !== 'task')
      throw new WorkflowProjectServiceError(
        'record-type-invalid',
        'The selected record is not a task.'
      );
    return loaded;
  }
  private requireWorkflowRecord(id: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'workflow')
      throw new WorkflowProjectServiceError(
        'workflow-not-found',
        'The selected workflow no longer resolves.'
      );
    return record;
  }
  private requireTaskProjection(id: string): WorkflowTask {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'task')
      throw new WorkflowProjectServiceError(
        'task-not-found',
        'The selected task no longer resolves.'
      );
    return hydrateCatalogTask(record);
  }
  private assertTaskLinks(
    workflow: WorkflowProject,
    input: Pick<CreateTaskInput, 'dependsOn' | 'editionId' | 'stageId'>
  ): void {
    if (
      !workflow.stages.items.some(({ id, status }) => id === input.stageId && status !== 'archived')
    )
      throw new WorkflowProjectServiceError(
        'task-invalid',
        'Choose a non-archived stage in this workflow.'
      );
    if (input.editionId !== undefined) {
      const edition = this.catalog.recordById(input.editionId);
      if (edition?.type !== 'edition' || edition.fields['book-id'] !== workflow.bookId)
        throw new WorkflowProjectServiceError(
          'task-invalid',
          'The linked edition must belong to the workflow book.'
        );
    }
    for (const dependency of input.dependsOn ?? []) {
      const task = this.catalog.recordById(dependency);
      if (task?.type !== 'task' || task.fields['workflow-id'] !== workflow.id)
        throw new WorkflowProjectServiceError(
          'task-invalid',
          `Dependency ${dependency} must belong to this workflow.`
        );
    }
  }
  private assertAcyclic(tasks: readonly WorkflowTask[]): void {
    // Stable identity order makes the same invalid graph produce the same exact cycle path after
    // reload, regardless of which edit caused the final edge to be proposed.
    const cycle = findTaskDependencyCycle(
      [...tasks].sort((left, right) => left.id.localeCompare(right.id))
    );
    if (cycle !== undefined)
      throw new WorkflowProjectServiceError(
        'dependency-cycle',
        `Task dependency cycle detected: ${cycle.join(' → ')}.`,
        cycle
      );
  }
  private now(): string {
    return this.clock.now().toISOString();
  }
}

function taskFields(
  bookId: string,
  _taskId: string,
  input: TaskCoreInput,
  checklist: Checklist
): Readonly<Record<string, unknown>> {
  for (const attachment of input.attachments ?? []) normalizeVaultPath(attachment);
  return {
    'book-id': bookId,
    'workflow-id': input.workflowId,
    'stage-id': input.stageId,
    ...(input.editionId === undefined ? {} : { 'edition-id': input.editionId }),
    title: input.title,
    status: input.status ?? 'not-started',
    priority: input.priority ?? 'normal',
    required: input.required ?? true,
    ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
    ...(input.estimateMinutes === undefined ? {} : { 'estimate-minutes': input.estimateMinutes }),
    ...(input.actualMinutes === undefined ? {} : { 'actual-minutes': input.actualMinutes }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    attachments: [...(input.attachments ?? [])],
    checklist,
    'depends-on': [...(input.dependsOn ?? [])],
    'manual-blockers': [...(input.manualBlockers ?? [])],
    'linked-metadata': { ...(input.linkedMetadata ?? {}) }
  };
}
function checklistFromInput(
  items: NonNullable<CreateTaskInput['checklist']>,
  ids: IdGenerator
): Checklist {
  return {
    items: items.map((item) => ({
      id: `check-${safeOpaque(ids.generate())}`,
      text: item.text,
      required: item.required ?? true,
      done: item.done ?? false
    }))
  };
}
function hydrateProposedTask(id: string, fields: Readonly<Record<string, unknown>>): WorkflowTask {
  return hydrateWorkflowTask({
    envelope: {
      pmId: id,
      pmType: 'task',
      pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z'
    },
    fields
  });
}
function hydrateCatalogTask(record: CatalogRecord): WorkflowTask {
  return hydrateWorkflowTask({ envelope: fakeEnvelope(record, 'task'), fields: record.fields });
}
function hydrateCatalogWorkflow(record: CatalogRecord): WorkflowProject {
  return hydrateWorkflowProject({
    envelope: fakeEnvelope(record, 'workflow'),
    fields: record.fields
  });
}
function fakeEnvelope(record: CatalogRecord, type: 'task' | 'workflow') {
  return {
    pmId: record.id,
    pmType: type,
    pmSchema: record.schemaVersion,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    ...(record.archived ? { archivedAt: '2000-01-01T00:00:00.000Z' } : {})
  } as const;
}
function assertValidWorkflow(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateWorkflowProject(fields);
  if (diagnostics.length > 0)
    throw new WorkflowProjectServiceError(
      'workflow-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
}
function assertValidTask(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateWorkflowTask(fields);
  if (diagnostics.length > 0)
    throw new WorkflowProjectServiceError(
      'task-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
}
function reorder(stages: readonly WorkflowStage[]): WorkflowStage[] {
  return stages.map((stage, index) => ({ ...stage, order: index + 1 }));
}
function cloneStage(stage: WorkflowStage): WorkflowStage {
  return {
    ...stage,
    dependsOnStageIds: [...stage.dependsOnStageIds],
    attachments: [...stage.attachments]
  };
}
function optionalStageFields(input: EditStageInput): Partial<WorkflowStage> {
  return {
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.plannedStart === undefined ? {} : { plannedStart: input.plannedStart }),
    ...(input.plannedEnd === undefined ? {} : { plannedEnd: input.plannedEnd }),
    ...(input.actualStart === undefined ? {} : { actualStart: input.actualStart }),
    ...(input.actualEnd === undefined ? {} : { actualEnd: input.actualEnd })
  };
}
/** Explicit undefined values remove optional fields through the lossless repository patch API. */
function editableTaskPatch(
  fields: Readonly<Record<string, unknown>>,
  input: EditTaskInput
): Readonly<Record<string, unknown>> {
  return {
    ...fields,
    'edition-id': input.editionId,
    deadline: input.deadline,
    'estimate-minutes': input.estimateMinutes,
    'actual-minutes': input.actualMinutes,
    owner: input.owner,
    notes: input.notes
  };
}
function safeOpaque(generated: string): string {
  const opaque = generated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (opaque.length < 8)
    throw new WorkflowProjectServiceError(
      'workflow-invalid',
      'Identity generator returned an invalid value.'
    );
  return opaque;
}
function managedId(type: 'task' | 'workflow', generated: string): string {
  return `pm-${type}-${safeOpaque(generated)}`;
}
