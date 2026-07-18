/**
 * Defines the WFL-001–WFL-009 workflow engine without storage, Obsidian, or UI dependencies.
 * Canonical workflow records own ordered stage instances; canonical task records own executable
 * work. Blocked and completion states are derived so stale projections never become truth.
 */

import type { ManagedRecordEnvelope } from '../records/record-envelope';
import { normalizeVaultPath } from '../storage/vault-path';

/** Stable reporting categories survive user-facing renames and reordering. */
export const WORKFLOW_STAGE_CATEGORIES = [
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
  'archived',
  'custom'
] as const;

export type WorkflowStageCategory = (typeof WORKFLOW_STAGE_CATEGORIES)[number];
export type WorkflowStageStatus = 'not-started' | 'active' | 'complete' | 'skipped' | 'archived';
export type StageCompletionMode = 'required-tasks' | 'manual-approval' | 'both';
export type WorkflowStatus = 'active' | 'archived';
export type TaskStatus = 'not-started' | 'active' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkflowStage {
  readonly id: string;
  readonly category: WorkflowStageCategory;
  readonly label: string;
  readonly order: number;
  readonly status: WorkflowStageStatus;
  readonly completionMode: StageCompletionMode;
  readonly manualApproved: boolean;
  readonly dependsOnStageIds: readonly string[];
  readonly branchFromStageId?: string;
  readonly owner?: string;
  readonly notes?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly actualStart?: string;
  readonly actualEnd?: string;
  readonly attachments: readonly string[];
}

/** Object wrapper remains compatible with frontmatter structured-object validation. */
export interface WorkflowStageCollection {
  readonly items: readonly WorkflowStage[];
}

export interface WorkflowProject {
  readonly id: string;
  readonly bookId: string;
  readonly name: string;
  readonly status: WorkflowStatus;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly templateBaseline: WorkflowStageCollection;
  readonly stages: WorkflowStageCollection;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly required: boolean;
  readonly done: boolean;
}

export interface Checklist {
  readonly items: readonly ChecklistItem[];
}

export interface WorkflowTask {
  readonly id: string;
  readonly bookId: string;
  readonly workflowId: string;
  readonly stageId: string;
  readonly editionId?: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly required: boolean;
  readonly deadline?: string;
  readonly estimateMinutes?: number;
  readonly actualMinutes?: number;
  readonly owner?: string;
  readonly notes?: string;
  readonly attachments: readonly string[];
  readonly checklist: Checklist;
  readonly dependsOn: readonly string[];
  readonly manualBlockers: readonly string[];
  readonly linkedMetadata: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface WorkflowDiagnostic {
  readonly field: string;
  readonly message: string;
}
export interface TaskDiagnostic {
  readonly field: string;
  readonly message: string;
}

const DEFAULT_STAGE_ORDER = WORKFLOW_STAGE_CATEGORIES.filter((category) => category !== 'custom');

/** Bundled v1 template is immutable; instances copy it and never retain a mutable reference. */
export const DEFAULT_WORKFLOW_TEMPLATE = {
  id: 'publishing-manager-default',
  version: 1,
  name: 'Default publishing workflow',
  stages: {
    items: [
      stage('planning', 'Planning', 1),
      stage('draft', 'Draft', 2),
      stage('development-edit', 'Development Edit', 3),
      stage('copy-edit', 'Copy Edit', 4),
      stage('proofreading', 'Proofreading', 5),
      stage('formatting', 'Formatting', 6),
      stage('metadata-complete', 'Metadata Complete', 7),
      stage('cover-ready', 'Cover Ready', 8),
      stage('isbn-assigned', 'ISBN Assigned', 9),
      stage('files-generated', 'Files Generated', 10),
      stage('retail-upload', 'Retail Upload', 11),
      stage('retail-review', 'Retail Review', 12, 'manual-approval'),
      stage('preorder', 'Preorder', 13, 'manual-approval'),
      stage('published', 'Published', 14, 'manual-approval'),
      stage('post-launch', 'Post Launch', 15),
      stage('archived', 'Archived', 16, 'manual-approval')
    ]
  }
} as const;

/** Validates a complete workflow proposal and returns all actionable defects. */
export function validateWorkflowProject(
  fields: Readonly<Record<string, unknown>>
): readonly WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  if (!isManagedId(fields['book-id']))
    diagnostics.push(problem('book-id', 'Choose one valid book.'));
  if (!isTrimmedText(fields.name, 160))
    diagnostics.push(
      problem('name', 'Workflow name must be trimmed text no longer than 160 characters.')
    );
  if (fields.status !== 'active' && fields.status !== 'archived')
    diagnostics.push(problem('status', 'Workflow status must be active or archived.'));
  if (!isStableToken(fields['template-id']))
    diagnostics.push(problem('template-id', 'Template identity must be a stable lowercase token.'));
  if (!isPositiveInteger(fields['template-version']))
    diagnostics.push(
      problem('template-version', 'Template version must be a positive whole number.')
    );
  const baseline = parseStageCollection(fields['template-baseline']);
  const stages = parseStageCollection(fields.stages);
  if (baseline === undefined)
    diagnostics.push(
      problem('template-baseline', 'Template baseline must contain a valid stage list.')
    );
  else diagnostics.push(...validateStages(baseline.items, 'template-baseline'));
  if (stages === undefined)
    diagnostics.push(problem('stages', 'Workflow stages must contain a valid stage list.'));
  if (stages !== undefined) diagnostics.push(...validateStages(stages.items, 'stages'));
  return diagnostics;
}

/** Validates the full WFL-005 task shape before persistence or graph analysis. */
export function validateWorkflowTask(
  fields: Readonly<Record<string, unknown>>
): readonly TaskDiagnostic[] {
  const diagnostics: TaskDiagnostic[] = [];
  if (!isManagedId(fields['book-id']))
    diagnostics.push(problem('book-id', 'Choose one valid book.'));
  if (!isManagedId(fields['workflow-id']))
    diagnostics.push(problem('workflow-id', 'Choose one valid workflow.'));
  if (!isStageId(fields['stage-id']))
    diagnostics.push(problem('stage-id', 'Choose one valid workflow stage.'));
  if (fields['edition-id'] !== undefined && !isManagedId(fields['edition-id']))
    diagnostics.push(problem('edition-id', 'Edition link must be one stable identity.'));
  if (!isTrimmedText(fields.title, 240))
    diagnostics.push(
      problem('title', 'Task title must be trimmed text no longer than 240 characters.')
    );
  if (!isTaskStatus(fields.status))
    diagnostics.push(
      problem('status', 'Task status must be not-started, active, done, or cancelled.')
    );
  if (!isTaskPriority(fields.priority))
    diagnostics.push(problem('priority', 'Task priority must be low, normal, high, or urgent.'));
  if (typeof fields.required !== 'boolean')
    diagnostics.push(problem('required', 'Required must be true or false.'));
  if (fields.deadline !== undefined && !isCalendarDate(fields.deadline))
    diagnostics.push(problem('deadline', 'Deadline must be a real YYYY-MM-DD date.'));
  for (const field of ['estimate-minutes', 'actual-minutes'] as const)
    if (fields[field] !== undefined && !isNonNegativeInteger(fields[field]))
      diagnostics.push(problem(field, `${field} must be a non-negative whole minute count.`));
  for (const field of ['owner', 'notes'] as const)
    if (
      fields[field] !== undefined &&
      !isTrimmedText(fields[field], field === 'notes' ? 8_000 : 160, true)
    )
      diagnostics.push(
        problem(field, `${field} must be trimmed text within its documented limit.`)
      );
  for (const field of ['attachments', 'depends-on', 'manual-blockers'] as const)
    if (!isStringList(fields[field] ?? []))
      diagnostics.push(problem(field, `${field} must be a list of text values.`));
  const attachments = fields.attachments ?? [];
  if (isStringList(attachments) && !attachments.every((attachment) => isSafeVaultPath(attachment)))
    diagnostics.push(
      problem('attachments', 'Every attachment must be a normalized vault-relative path.')
    );
  if (!isChecklist(fields.checklist))
    diagnostics.push(problem('checklist', 'Checklist must contain valid stable, labelled items.'));
  if (!isStringMap(fields['linked-metadata'] ?? {}))
    diagnostics.push(problem('linked-metadata', 'Linked metadata must be a text map.'));
  return diagnostics;
}

export function hydrateWorkflowProject(snapshot: {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}): WorkflowProject {
  const diagnostics = validateWorkflowProject(snapshot.fields);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(({ message }) => message).join(' '));
  return {
    id: snapshot.envelope.pmId,
    bookId: snapshot.fields['book-id'] as string,
    name: snapshot.fields.name as string,
    status: snapshot.fields.status as WorkflowStatus,
    templateId: snapshot.fields['template-id'] as string,
    templateVersion: snapshot.fields['template-version'] as number,
    templateBaseline: cloneStages(parseStageCollection(snapshot.fields['template-baseline'])!),
    stages: cloneStages(parseStageCollection(snapshot.fields.stages)!),
    createdAt: snapshot.envelope.createdAt,
    updatedAt: snapshot.envelope.updatedAt,
    ...(snapshot.envelope.archivedAt === undefined
      ? {}
      : { archivedAt: snapshot.envelope.archivedAt })
  };
}

export function hydrateWorkflowTask(snapshot: {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}): WorkflowTask {
  const diagnostics = validateWorkflowTask(snapshot.fields);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(({ message }) => message).join(' '));
  return {
    id: snapshot.envelope.pmId,
    bookId: snapshot.fields['book-id'] as string,
    workflowId: snapshot.fields['workflow-id'] as string,
    stageId: snapshot.fields['stage-id'] as string,
    ...(typeof snapshot.fields['edition-id'] === 'string'
      ? { editionId: snapshot.fields['edition-id'] }
      : {}),
    title: snapshot.fields.title as string,
    status: snapshot.fields.status as TaskStatus,
    priority: snapshot.fields.priority as TaskPriority,
    required: snapshot.fields.required as boolean,
    ...(typeof snapshot.fields.deadline === 'string' ? { deadline: snapshot.fields.deadline } : {}),
    ...(typeof snapshot.fields['estimate-minutes'] === 'number'
      ? { estimateMinutes: snapshot.fields['estimate-minutes'] }
      : {}),
    ...(typeof snapshot.fields['actual-minutes'] === 'number'
      ? { actualMinutes: snapshot.fields['actual-minutes'] }
      : {}),
    ...(typeof snapshot.fields.owner === 'string' ? { owner: snapshot.fields.owner } : {}),
    ...(typeof snapshot.fields.notes === 'string' ? { notes: snapshot.fields.notes } : {}),
    attachments: (snapshot.fields.attachments as readonly string[]) ?? [],
    checklist: cloneChecklist(snapshot.fields.checklist as Checklist),
    dependsOn: (snapshot.fields['depends-on'] as readonly string[]) ?? [],
    manualBlockers: (snapshot.fields['manual-blockers'] as readonly string[]) ?? [],
    linkedMetadata: (snapshot.fields['linked-metadata'] as Readonly<Record<string, string>>) ?? {},
    createdAt: snapshot.envelope.createdAt,
    updatedAt: snapshot.envelope.updatedAt,
    ...(snapshot.envelope.archivedAt === undefined
      ? {}
      : { archivedAt: snapshot.envelope.archivedAt })
  };
}

/** Returns the exact closed cycle path, including its repeated starting identity. */
export function findTaskDependencyCycle(
  tasks: readonly Pick<WorkflowTask, 'dependsOn' | 'id'>[]
): readonly string[] | undefined {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  const active = new Map<string, number>();
  const path: string[] = [];
  const visit = (id: string): readonly string[] | undefined => {
    const activeIndex = active.get(id);
    if (activeIndex !== undefined) return [...path.slice(activeIndex), id];
    if (visited.has(id)) return undefined;
    const task = byId.get(id);
    if (task === undefined) return undefined;
    active.set(id, path.length);
    path.push(id);
    for (const dependency of task.dependsOn) {
      const cycle = visit(dependency);
      if (cycle !== undefined) return cycle;
    }
    path.pop();
    active.delete(id);
    visited.add(id);
    return undefined;
  };
  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

export interface TaskBlockerAssessment {
  readonly blocked: boolean;
  readonly explanations: readonly string[];
}

/** Explains every unmet dependency and manual blocker rather than returning one boolean. */
export function assessTaskBlockers(
  task: WorkflowTask,
  tasks: readonly WorkflowTask[]
): TaskBlockerAssessment {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const explanations = task.manualBlockers.map((blocker) => `Manual blocker: ${blocker}`);
  for (const dependencyId of task.dependsOn) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined) explanations.push(`Dependency ${dependencyId} is missing.`);
    else if (dependency.status !== 'done')
      explanations.push(`Dependency “${dependency.title}” is ${dependency.status}.`);
  }
  return { blocked: explanations.length > 0, explanations };
}

export interface StageCompletionAssessment {
  readonly complete: boolean;
  readonly requiredTasksComplete: boolean;
  readonly manualApprovalComplete: boolean;
  readonly explanations: readonly string[];
}

/** Evaluates required-task, manual-approval, or combined completion without persisting derivation. */
export function assessStageCompletion(
  stage: WorkflowStage,
  tasks: readonly WorkflowTask[]
): StageCompletionAssessment {
  const required = tasks.filter(
    (task) => task.stageId === stage.id && task.required && task.status !== 'cancelled'
  );
  const incomplete = required.filter((task) => task.status !== 'done');
  const requiredTasksComplete = incomplete.length === 0;
  const manualApprovalComplete = stage.manualApproved;
  const complete =
    stage.completionMode === 'required-tasks'
      ? requiredTasksComplete
      : stage.completionMode === 'manual-approval'
        ? manualApprovalComplete
        : requiredTasksComplete && manualApprovalComplete;
  const explanations: string[] = [];
  if (
    (stage.completionMode === 'required-tasks' || stage.completionMode === 'both') &&
    !requiredTasksComplete
  )
    explanations.push(
      `${incomplete.length} required task${incomplete.length === 1 ? '' : 's'} remain incomplete: ${incomplete.map(({ title }) => title).join(', ')}.`
    );
  if (
    (stage.completionMode === 'manual-approval' || stage.completionMode === 'both') &&
    !manualApprovalComplete
  )
    explanations.push('Manual stage approval has not been confirmed.');
  return { complete, requiredTasksComplete, manualApprovalComplete, explanations };
}

export interface TemplateMergePreview {
  readonly proposedStages: WorkflowStageCollection;
  readonly changes: readonly string[];
  readonly conflicts: readonly string[];
}

/** Three-way merge uses stored baseline to preserve local edits and report template conflicts. */
export function previewTemplateMerge(
  current: WorkflowStageCollection,
  baseline: WorkflowStageCollection,
  incoming: WorkflowStageCollection
): TemplateMergePreview {
  const baseByCategory = new Map(baseline.items.map((stage) => [stage.category, stage]));
  const currentByCategory = new Map(current.items.map((stage) => [stage.category, stage]));
  const proposed: WorkflowStage[] = [];
  const changes: string[] = [];
  const conflicts: string[] = [];
  for (const next of incoming.items) {
    const base = baseByCategory.get(next.category);
    const local = currentByCategory.get(next.category);
    if (local === undefined) {
      proposed.push(cloneStage(next));
      changes.push(`Add template stage “${next.label}”.`);
      continue;
    }
    if (base === undefined) {
      proposed.push(cloneStage(local));
      conflicts.push(
        `Preserve local stage “${local.label}”; its category now also exists in the template.`
      );
      continue;
    }
    const locallyChanged = comparableStage(local) !== comparableStage(base);
    const templateChanged = comparableStage(next) !== comparableStage(base);
    if (locallyChanged && templateChanged) {
      proposed.push(cloneStage(local));
      conflicts.push(
        `Preserve local edits to “${local.label}”; review incoming changes to the same stage.`
      );
    } else if (locallyChanged) proposed.push(cloneStage(local));
    else {
      proposed.push({ ...cloneStage(next), id: local.id });
      if (templateChanged) changes.push(`Update template-managed stage “${next.label}”.`);
    }
  }
  for (const local of current.items.filter(
    (stage) => !incoming.items.some(({ category }) => category === stage.category)
  )) {
    proposed.push(cloneStage(local));
    conflicts.push(
      `Preserve local stage “${local.label}”; the incoming template no longer contains it.`
    );
  }
  return {
    proposedStages: { items: proposed.map((stage, index) => ({ ...stage, order: index + 1 })) },
    changes,
    conflicts
  };
}

export function cloneStages(collection: WorkflowStageCollection): WorkflowStageCollection {
  return { items: collection.items.map(cloneStage) };
}
export function parseStageCollection(value: unknown): WorkflowStageCollection | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  return { items: value.items as readonly WorkflowStage[] };
}

function stage(
  category: Exclude<WorkflowStageCategory, 'custom'>,
  label: string,
  order: number,
  completionMode: StageCompletionMode = 'required-tasks'
): WorkflowStage {
  return {
    id: `stage-${category}`,
    category,
    label,
    order,
    status: 'not-started',
    completionMode,
    manualApproved: false,
    dependsOnStageIds: order === 1 ? [] : [`stage-${DEFAULT_STAGE_ORDER[order - 2]}`],
    attachments: []
  };
}

function validateStages(
  stages: readonly WorkflowStage[],
  field: 'stages' | 'template-baseline'
): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const candidate of stages) {
    if (!isRecord(candidate) || !isStageId(candidate.id)) {
      diagnostics.push(problem(field, 'Every stage requires a stable stage-* identity.'));
      continue;
    }
    if (ids.has(candidate.id))
      diagnostics.push(problem(field, `Stage identity ${candidate.id} is duplicated.`));
    ids.add(candidate.id);
    if (!WORKFLOW_STAGE_CATEGORIES.includes(candidate.category))
      diagnostics.push(problem(field, `Stage ${candidate.id} has an invalid reporting category.`));
    if (!isTrimmedText(candidate.label, 160))
      diagnostics.push(problem(field, `Stage ${candidate.id} requires a trimmed label.`));
    if (!isPositiveInteger(candidate.order) || orders.has(candidate.order))
      diagnostics.push(problem(field, `Stage ${candidate.id} requires a unique positive order.`));
    orders.add(candidate.order);
    if (
      !['not-started', 'active', 'complete', 'skipped', 'archived'].includes(
        String(candidate.status)
      )
    )
      diagnostics.push(problem(field, `Stage ${candidate.id} has an invalid status.`));
    if (!['required-tasks', 'manual-approval', 'both'].includes(String(candidate.completionMode)))
      diagnostics.push(problem(field, `Stage ${candidate.id} has an invalid completion mode.`));
    if (
      typeof candidate.manualApproved !== 'boolean' ||
      !isStringList(candidate.dependsOnStageIds) ||
      !isStringList(candidate.attachments)
    )
      diagnostics.push(
        problem(
          field,
          `Stage ${candidate.id} has malformed approval, dependency, or attachment data.`
        )
      );
    if (
      isStringList(candidate.attachments) &&
      !candidate.attachments.every((attachment) => isSafeVaultPath(attachment))
    )
      diagnostics.push(problem(field, `Stage ${candidate.id} contains an unsafe attachment path.`));
    for (const dateField of ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'] as const)
      if (candidate[dateField] !== undefined && !isCalendarDate(candidate[dateField]))
        diagnostics.push(problem(field, `Stage ${candidate.id} has an invalid ${dateField} date.`));
    if (
      candidate.plannedStart !== undefined &&
      candidate.plannedEnd !== undefined &&
      candidate.plannedEnd < candidate.plannedStart
    )
      diagnostics.push(problem(field, `Stage ${candidate.id} planned end precedes its start.`));
    if (
      candidate.actualStart !== undefined &&
      candidate.actualEnd !== undefined &&
      candidate.actualEnd < candidate.actualStart
    )
      diagnostics.push(problem(field, `Stage ${candidate.id} actual end precedes its start.`));
  }
  for (const candidate of stages) {
    if (!isRecord(candidate) || !isStageId(candidate.id)) continue;
    if (isStringList(candidate.dependsOnStageIds))
      for (const dependency of candidate.dependsOnStageIds)
        if (!ids.has(dependency) || dependency === candidate.id)
          diagnostics.push(
            problem(field, `Stage ${candidate.id} has an invalid dependency ${dependency}.`)
          );
    if (
      candidate.branchFromStageId !== undefined &&
      (!isStageId(candidate.branchFromStageId) || !ids.has(candidate.branchFromStageId))
    )
      diagnostics.push(problem(field, `Stage ${candidate.id} has an invalid branch source.`));
  }
  return diagnostics;
}

function cloneStage(value: WorkflowStage): WorkflowStage {
  return {
    ...value,
    dependsOnStageIds: [...value.dependsOnStageIds],
    attachments: [...value.attachments]
  };
}
function cloneChecklist(value: Checklist): Checklist {
  return { items: value.items.map((item) => ({ ...item })) };
}
function comparableStage(value: WorkflowStage): string {
  const { id: _id, order: _order, ...rest } = value;
  return JSON.stringify(rest);
}
function isChecklist(value: unknown): value is Checklist {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        isStableToken(item.id) &&
        isTrimmedText(item.text, 240) &&
        typeof item.required === 'boolean' &&
        typeof item.done === 'boolean'
    )
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isManagedId(value: unknown): value is string {
  return typeof value === 'string' && /^pm-[a-z0-9][a-z0-9-]{7,127}$/u.test(value);
}
function isStageId(value: unknown): value is string {
  return typeof value === 'string' && /^stage-[a-z0-9][a-z0-9-]{2,127}$/u.test(value);
}
function isStableToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,127}$/u.test(value);
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
function isTrimmedText(value: unknown, limit: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length <= limit &&
    (allowEmpty || value.length > 0)
  );
}
function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === 'string' && ['not-started', 'active', 'done', 'cancelled'].includes(value)
  );
}
function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && ['low', 'normal', 'high', 'urgent'].includes(value);
}
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  );
}
function isSafeVaultPath(value: string): boolean {
  try {
    return normalizeVaultPath(value) === value;
  } catch {
    return false;
  }
}
function problem(field: string, message: string): WorkflowDiagnostic {
  return { field, message };
}
