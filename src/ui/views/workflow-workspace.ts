/**
 * Renders the complete M3 Workflow workspace over canonical workflow/task projections. List and
 * board modes share one state and one task renderer; neither stores a second workflow model.
 * Every mutation delegates to the application service, batch work requires a visible preview and
 * durable journal, and retailer confirmation remains a separate explicit user action. The module
 * uses only Obsidian/browser UI capabilities and performs no network or filesystem access.
 */

import { Notice } from 'obsidian';

import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { VaultPath } from '../../domain/storage/vault-path';
import {
  hydrateWorkflowProject,
  type ChecklistItem,
  type TaskPriority,
  type TaskStatus,
  type WorkflowStage,
  type WorkflowTask
} from '../../domain/workflows/workflow';
import type {
  BatchTaskPatch,
  BatchTaskPreview,
  WorkflowProjectService
} from '../../application/workflows/workflow-project-service';
import { queryWorkflowAttention } from '../../application/workflows/workflow-queries';
import { pageCollection, pagedCollectionWindow } from '../view-models/paged-collection';

/** Runtime-only view choices; canonical records remain authoritative and selection is disposable. */
export interface WorkflowWorkspaceState {
  mode: 'board' | 'list';
  selectedTaskId?: string;
  readonly batchTaskIds: Set<string>;
  /** Zero-based task page shared by list and board so changing mode retains the same evidence. */
  taskPage: number;
  dependencyPage: number;
  batchPreviewPage: number;
  /** Stable-ID selections retain off-page dependencies without treating visibility as authority. */
  readonly dependencySelections: Map<string, Set<string>>;
}

/** Creates a fresh view state without leaking selection between Book Workspace leaves. */
export function createWorkflowWorkspaceState(): WorkflowWorkspaceState {
  return {
    mode: 'list',
    batchTaskIds: new Set<string>(),
    taskPage: 0,
    dependencyPage: 0,
    batchPreviewPage: 0,
    dependencySelections: new Map<string, Set<string>>()
  };
}

/** Dependencies kept explicit so the renderer can be tested and cannot acquire hidden I/O. */
export interface WorkflowWorkspaceContext {
  readonly parent: HTMLElement;
  readonly book: CatalogRecord;
  readonly snapshot: BookCatalogSnapshot;
  readonly workflows: WorkflowProjectService;
  readonly state: WorkflowWorkspaceState;
  readonly rerender: () => void;
  readonly openNote: (path: VaultPath) => Promise<void>;
}

/** Builds the WFL-010–WFL-014 surface and an honest empty state for books without a workflow. */
export function renderWorkflowWorkspace(context: WorkflowWorkspaceContext): void {
  const records = context.snapshot.workflows.filter(
    (record) => record.fields['book-id'] === context.book.id && !record.archived
  );
  const record = records[0];
  if (record === undefined) {
    renderWorkflowEmpty(context);
    return;
  }
  const workflow = hydrateWorkflowProject({
    envelope: catalogEnvelope(record, 'workflow'),
    fields: record.fields
  });
  const tasks = context.workflows.tasksForWorkflow(workflow.id);
  const stages = [...workflow.stages.items].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const ordered = orderedTasks(tasks, stages);
  const pageSize = 50;
  const window = pagedCollectionWindow(ordered.length, context.state.taskPage, pageSize);
  context.state.taskPage = window.page;
  const visibleTasks = pageCollection(ordered, window);
  const page = context.parent.createEl('section', { cls: 'pm-workflow-page' });
  renderWorkflowHeader(page, context, record, workflow.name, stages, tasks);
  renderTaskPageNavigation(page, context, window.offset, pageSize, tasks.length);
  renderAttention(page, tasks);
  renderQuickCapture(page, context, workflow.id, stages);
  renderAddStage(page, context, record, stages);
  if (context.state.mode === 'list')
    renderWorkflowList(page, context, record, stages, tasks, visibleTasks);
  else renderWorkflowBoard(page, context, record, stages, tasks, visibleTasks);
  renderBatchEditor(page, context, workflow.id, stages, tasks);
  const selected = tasks.find(({ id }) => id === context.state.selectedTaskId);
  if (selected !== undefined) renderTaskInspector(page, context, record, stages, tasks, selected);
}

/** One shared page controls both task projections and keeps at most fifty task cards in the DOM. */
function renderTaskPageNavigation(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  offset: number,
  pageSize: number,
  total: number
): void {
  if (total === 0) return;
  const navigation = parent.createDiv({ cls: 'pm-pagination' });
  const previous = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Previous task page',
    attr: { type: 'button' }
  });
  previous.disabled = context.state.taskPage === 0;
  previous.addEventListener('click', () => {
    context.state.taskPage = Math.max(0, context.state.taskPage - 1);
    context.rerender();
  });
  navigation.createSpan({
    text: `Tasks ${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}`
  });
  const next = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Next task page',
    attr: { type: 'button' }
  });
  next.disabled = offset + pageSize >= total;
  next.addEventListener('click', () => {
    context.state.taskPage += 1;
    context.rerender();
  });
}

/** Empty state makes workflow creation available in the tab and explains the one-instance rule. */
function renderWorkflowEmpty(context: WorkflowWorkspaceContext): void {
  const empty = context.parent.createDiv({ cls: 'pm-empty-state' });
  empty.createEl('h2', { text: 'No active workflow' });
  empty.createEl('p', {
    text: 'Create this book’s independent sixteen-stage publishing workflow. Later template changes cannot silently alter it.'
  });
  const create = empty.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Create default workflow',
    attr: { type: 'button' }
  });
  create.addEventListener('click', () => {
    create.disabled = true;
    void context.workflows
      .instantiateDefault(context.book.id)
      .then(() => new Notice('Default workflow created.'))
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Workflow could not be created.'));
        create.disabled = false;
      });
  });
}

/** Header exposes equivalent view modes, stable counts, and canonical Markdown navigation. */
function renderWorkflowHeader(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  record: CatalogRecord,
  name: string,
  stages: readonly WorkflowStage[],
  tasks: readonly WorkflowTask[]
): void {
  const heading = parent.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Canonical publishing workflow' });
  title.createEl('h2', { text: name });
  title.createEl('p', {
    text: `${stages.length} stages · ${tasks.length} tasks · list and board show the same records`
  });
  const actions = heading.createDiv({ cls: 'pm-action-row' });
  for (const mode of ['list', 'board'] as const) {
    const button = actions.createEl('button', {
      cls: `pm-button pm-button--secondary${context.state.mode === mode ? ' is-active' : ''}`,
      text: mode === 'list' ? 'List view' : 'Board view',
      attr: {
        type: 'button',
        'aria-pressed': String(context.state.mode === mode)
      }
    });
    button.addEventListener('click', () => {
      context.state.mode = mode;
      context.rerender();
    });
  }
  const open = actions.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Open workflow Markdown',
    attr: { type: 'button' }
  });
  open.addEventListener('click', () => void context.openNote(record.path));
}

/** WFL-013 summaries preserve owner names and exact task drill-through beneath the counts. */
function renderAttention(parent: HTMLElement, tasks: readonly WorkflowTask[]): void {
  const attention = queryWorkflowAttention(tasks, new Date(), 14);
  const details = parent.createEl('details', { cls: 'pm-panel pm-workflow-attention' });
  details.createEl('summary', {
    text: `Workload and attention · ${attention.overdue.length} overdue · ${attention.stalled.length} stalled`
  });
  const grid = details.createDiv({ cls: 'pm-workflow-attention-grid' });
  for (const owner of attention.owners.slice(0, 50)) {
    const card = grid.createEl('article', { cls: 'pm-workload-card' });
    card.createEl('strong', { text: owner.owner });
    card.createEl('p', {
      text: `${owner.openTasks} open · ${owner.blockedTasks} blocked · ${owner.overdueTasks} overdue`
    });
    card.createEl('small', { text: `${formatMinutes(owner.estimateMinutes)} estimated` });
  }
  if (attention.owners.length > 50)
    details.createEl('p', {
      cls: 'pm-muted',
      text: `${attention.owners.length - 50} additional owners are omitted from this summary; task pages retain their exact evidence.`
    });
  renderAttentionTasks(details, 'Overdue tasks', attention.overdue);
  renderAttentionTasks(details, 'Active but unchanged for 14 days', attention.stalled);
}

/** Keeps exact attention task titles/dates visible instead of presenting unexplained aggregate risk. */
function renderAttentionTasks(
  parent: HTMLElement,
  heading: string,
  tasks: readonly WorkflowTask[]
): void {
  parent.createEl('h4', { text: heading });
  if (tasks.length === 0) {
    parent.createEl('p', { cls: 'pm-muted', text: 'None.' });
    return;
  }
  const list = parent.createEl('ul');
  for (const task of tasks.slice(0, 50))
    list.createEl('li', {
      text: `${task.title} · ${task.owner ?? 'Unassigned'} · ${task.deadline ?? `updated ${task.updatedAt.slice(0, 10)}`}`
    });
  if (tasks.length > 50)
    parent.createEl('p', {
      cls: 'pm-muted',
      text: `${tasks.length - 50} additional matching tasks are available through the paged list or board.`
    });
}

/** WFL-012 quick capture asks only for title and inherits the selected current stage. */
function renderQuickCapture(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowId: string,
  stages: readonly WorkflowStage[]
): void {
  const section = parent.createEl('section', { cls: 'pm-panel pm-quick-capture' });
  section.createEl('h3', { text: 'Quick capture' });
  section.createEl('p', {
    text: 'Enter a title only; the new required, normal-priority task inherits this book, workflow, and selected stage.'
  });
  const row = section.createDiv({ cls: 'pm-action-row' });
  const title = row.createEl('input', {
    attr: { type: 'text', maxlength: '240', placeholder: 'Task title', 'aria-label': 'Task title' }
  });
  const stage = row.createEl('select', { attr: { 'aria-label': 'Task stage' } });
  for (const item of stages.filter(({ status }) => status !== 'archived'))
    stage.createEl('option', { value: item.id, text: item.label });
  const add = row.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Add task',
    attr: { type: 'button' }
  });
  add.addEventListener('click', () => {
    add.disabled = true;
    void context.workflows
      .quickCapture(workflowId, stage.value, title.value)
      .then(({ task }) => {
        context.state.selectedTaskId = task.id;
        new Notice('Task captured.');
        context.rerender();
      })
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Task could not be captured.'));
        add.disabled = false;
      });
  });
}

/** WFL-004 authoring becomes directly reachable without manufacturing a separate template editor. */
function renderAddStage(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowRecord: CatalogRecord,
  stages: readonly WorkflowStage[]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Add or branch a custom stage' });
  const fields = details.createDiv({ cls: 'pm-form-grid' });
  const label = inputField(fields, 'Stage label', 'text', '');
  const after = selectField(
    fields,
    'Insert after',
    stages.map(({ id }) => id),
    stages[stages.length - 1]?.id ?? ''
  );
  const branch = selectField(
    fields,
    'Branch from (optional)',
    ['', ...stages.map(({ id }) => id)],
    ''
  );
  for (const select of [after, branch])
    for (const option of Array.from(select.options))
      if (option.value)
        option.text = stages.find(({ id }) => id === option.value)?.label ?? option.value;
  const completion = selectField(
    fields,
    'Completion rule',
    ['required-tasks', 'manual-approval', 'both'],
    'required-tasks'
  );
  const add = details.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Add reviewed stage',
    attr: { type: 'button' }
  });
  add.addEventListener('click', () => {
    add.disabled = true;
    void context.workflows
      .addStage(workflowRecord.path, {
        category: 'custom',
        label: label.value,
        ...(after.value ? { afterStageId: after.value } : {}),
        ...(branch.value ? { branchFromStageId: branch.value } : {}),
        completionMode: completion.value as WorkflowStage['completionMode']
      })
      .then(() => new Notice('Custom workflow stage added.'))
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Stage could not be added.'));
        add.disabled = false;
      });
  });
}

/** Accessible list exposes the complete row summary and batch selection without horizontal drag. */
function renderWorkflowList(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowRecord: CatalogRecord,
  stages: readonly WorkflowStage[],
  tasks: readonly WorkflowTask[],
  visibleTasks: readonly WorkflowTask[]
): void {
  const list = parent.createEl('ul', { cls: 'pm-workflow-task-list' });
  for (const stage of stages) {
    const group = list.createEl('li', { cls: 'pm-workflow-column' });
    group.createEl('h3', { text: `${stage.order}. ${stage.label}` });
    group.createEl('small', { text: `${stage.status} · ${stage.completionMode}` });
    renderStageEditor(group, context, workflowRecord, stage, stages);
    const totalForStage = tasks.filter(({ stageId }) => stageId === stage.id).length;
    const staged = visibleTasks.filter(({ stageId }) => stageId === stage.id);
    group.createEl('p', { text: `${totalForStage} total tasks` });
    if (staged.length === 0)
      group.createEl('p', {
        cls: 'pm-muted',
        text: 'No tasks from this stage on the current page.'
      });
    for (const task of staged) {
      const item = group.createDiv({ cls: 'pm-workflow-task-row' });
      renderBatchCheckbox(item, context, task);
      const button = item.createEl('button', {
        cls: 'pm-workflow-task-button',
        attr: { type: 'button', 'aria-label': `Inspect task ${task.title}` }
      });
      renderTaskSummary(button, context, task, stage);
    }
  }
}

/** Board columns remain semantic sections; cards are buttons and never require drag-and-drop. */
function renderWorkflowBoard(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowRecord: CatalogRecord,
  stages: readonly WorkflowStage[],
  tasks: readonly WorkflowTask[],
  visibleTasks: readonly WorkflowTask[]
): void {
  const board = parent.createDiv({
    cls: 'pm-workflow-board',
    attr: { 'aria-label': 'Workflow board' }
  });
  for (const stage of stages.filter(({ status }) => status !== 'archived')) {
    const column = board.createEl('section', {
      cls: 'pm-workflow-column',
      attr: { 'aria-label': `${stage.label} stage` }
    });
    const totalForStage = tasks.filter(({ stageId }) => stageId === stage.id).length;
    const staged = visibleTasks.filter(({ stageId }) => stageId === stage.id);
    column.createEl('h3', { text: `${stage.order}. ${stage.label} · ${totalForStage}` });
    column.createEl('small', { text: `${stage.status} · ${stage.completionMode}` });
    renderStageEditor(column, context, workflowRecord, stage, stages);
    if (staged.length === 0)
      column.createEl('p', {
        cls: 'pm-muted',
        text: 'No tasks from this stage on the current page.'
      });
    for (const task of staged) {
      const card = column.createEl('article', { cls: 'pm-workflow-card' });
      renderBatchCheckbox(card, context, task);
      const button = card.createEl('button', {
        cls: 'pm-workflow-task-button',
        attr: { type: 'button', 'aria-label': `Inspect task ${task.title}` }
      });
      renderTaskSummary(button, context, task, stage);
    }
  }
}

/**
 * Stage editor exposes the full configurable stage contract while preserving stable identity and
 * reporting category inside the service. Archive/skip are statuses, and dependency checkboxes
 * never allow a stage to depend on itself.
 */
function renderStageEditor(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowRecord: CatalogRecord,
  stage: WorkflowStage,
  stages: readonly WorkflowStage[]
): void {
  const details = parent.createEl('details', { cls: 'pm-stage-editor' });
  details.createEl('summary', { text: 'Edit stage' });
  const fields = details.createDiv({ cls: 'pm-form-grid' });
  const label = inputField(fields, 'Label', 'text', stage.label);
  const order = inputField(fields, 'Order', 'number', String(stage.order));
  const status = selectField(
    fields,
    'Status',
    ['not-started', 'active', 'complete', 'skipped', 'archived'],
    stage.status
  );
  const completion = selectField(
    fields,
    'Completion rule',
    ['required-tasks', 'manual-approval', 'both'],
    stage.completionMode
  );
  const approved = labelledCheckbox(fields, 'Manual approval confirmed', stage.manualApproved);
  const owner = inputField(fields, 'Owner', 'text', stage.owner ?? '');
  const plannedStart = inputField(fields, 'Planned start', 'date', stage.plannedStart ?? '');
  const plannedEnd = inputField(fields, 'Planned end', 'date', stage.plannedEnd ?? '');
  const actualStart = inputField(fields, 'Actual start', 'date', stage.actualStart ?? '');
  const actualEnd = inputField(fields, 'Actual end', 'date', stage.actualEnd ?? '');
  const notes = textareaField(fields, 'Notes', stage.notes ?? '');
  const attachments = textareaField(
    fields,
    'Vault-relative attachments',
    stage.attachments.join('\n')
  );
  details.createEl('p', { text: `Stable reporting category: ${stage.category}` });
  details.createEl('h4', { text: 'Stage dependencies' });
  const dependencies = stages
    .filter(({ id }) => id !== stage.id)
    .map((candidate) => ({
      stage: candidate,
      input: labelledCheckbox(
        details,
        candidate.label,
        stage.dependsOnStageIds.includes(candidate.id)
      )
    }));
  const save = details.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Save stage',
    attr: { type: 'button' }
  });
  save.addEventListener('click', () => {
    save.disabled = true;
    void context.workflows
      .editStage(workflowRecord.path, stage.id, {
        label: label.value,
        order: Number(order.value),
        status: status.value as WorkflowStage['status'],
        completionMode: completion.value as WorkflowStage['completionMode'],
        manualApproved: approved.checked,
        dependsOnStageIds: dependencies
          .filter(({ input }) => input.checked)
          .map(({ stage: dependency }) => dependency.id),
        ...(owner.value.trim() ? { owner: owner.value.trim() } : {}),
        ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
        ...(plannedStart.value ? { plannedStart: plannedStart.value } : {}),
        ...(plannedEnd.value ? { plannedEnd: plannedEnd.value } : {}),
        ...(actualStart.value ? { actualStart: actualStart.value } : {}),
        ...(actualEnd.value ? { actualEnd: actualEnd.value } : {}),
        attachments: lines(attachments.value)
      })
      .then(() => new Notice('Workflow stage saved.'))
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Stage could not be saved.'));
        save.disabled = false;
      });
  });
}

/** Shared summary guarantees list and board communicate the same text-labelled state. */
function renderTaskSummary(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  task: WorkflowTask,
  stage?: WorkflowStage
): void {
  const blockers = context.workflows.assessTask(task.id);
  parent.createEl('strong', { text: task.title });
  parent.createSpan({
    text: `${task.status} · ${task.priority} · ${task.owner ?? 'Unassigned'}`
  });
  parent.createEl('small', {
    text: `${stage?.label ?? 'Unknown stage'} · due ${task.deadline ?? 'not set'} · ${blockers.blocked ? `Blocked: ${blockers.explanations.join(' ')}` : 'Not blocked'}`
  });
  parent.addEventListener('click', () => {
    if (context.state.selectedTaskId !== task.id) {
      context.state.dependencyPage = 0;
      context.state.dependencySelections.clear();
    }
    context.state.selectedTaskId = task.id;
    context.rerender();
  });
}

/** Selection control remains separate from opening a task so keyboard users can batch safely. */
function renderBatchCheckbox(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  task: WorkflowTask
): void {
  const label = parent.createEl('label', { cls: 'pm-batch-selector' });
  const checkbox = label.createEl('input', {
    attr: { type: 'checkbox', 'aria-label': `Select ${task.title} for batch edit` }
  });
  checkbox.checked = context.state.batchTaskIds.has(task.id);
  label.createSpan({ text: 'Select' });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) context.state.batchTaskIds.add(task.id);
    else context.state.batchTaskIds.delete(task.id);
  });
}

/** Preview is mandatory and shows every before/after row before journal-backed application. */
function renderBatchEditor(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowId: string,
  stages: readonly WorkflowStage[],
  tasks: readonly WorkflowTask[]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel pm-batch-editor' });
  details.createEl('summary', {
    text: `Preview batch edit · ${context.state.batchTaskIds.size} selected`
  });
  details.createEl('p', {
    text: 'Completed/cancelled tasks are excluded by default. Dependencies and checklist evidence cannot be changed in bulk.'
  });
  const fields = details.createDiv({ cls: 'pm-form-grid' });
  const status = optionalSelect(fields, 'Set status', [
    '',
    'not-started',
    'active',
    'done',
    'cancelled'
  ]);
  const priority = optionalSelect(fields, 'Set priority', ['', 'low', 'normal', 'high', 'urgent']);
  const stage = optionalSelect(fields, 'Move to stage', ['', ...stages.map(({ id }) => id)]);
  for (const option of Array.from(stage.options)) {
    if (option.value)
      option.text = stages.find(({ id }) => id === option.value)?.label ?? option.value;
  }
  const owner = inputField(fields, 'Set owner', 'text', '');
  const deadline = inputField(fields, 'Set deadline', 'date', '');
  const include = labelledCheckbox(fields, 'Deliberately include completed/cancelled tasks');
  const previewButton = details.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Build preview',
    attr: { type: 'button' }
  });
  const region = details.createDiv({ attr: { 'aria-live': 'polite' } });
  let currentPreview: BatchTaskPreview | undefined;
  previewButton.addEventListener('click', () => {
    try {
      const patch: BatchTaskPatch = {
        ...(status.value ? { status: status.value as TaskStatus } : {}),
        ...(priority.value ? { priority: priority.value as TaskPriority } : {}),
        ...(stage.value ? { stageId: stage.value } : {}),
        ...(owner.value.trim() ? { owner: owner.value.trim() } : {}),
        ...(deadline.value ? { deadline: deadline.value } : {})
      };
      currentPreview = context.workflows.previewBatchEdit(
        workflowId,
        [...context.state.batchTaskIds],
        patch,
        include.checked
      );
      context.state.batchPreviewPage = 0;
      renderBatchPreview(region, currentPreview, context, () => {
        currentPreview = undefined;
      });
    } catch (cause) {
      region.setText(errorMessage(cause, 'Batch preview failed.'));
    }
  });
  if (tasks.length === 0) details.createEl('p', { cls: 'pm-muted', text: 'Capture tasks first.' });
}

/** Apply button appears only beside the exact reviewed preview and disables during journal work. */
function renderBatchPreview(
  parent: HTMLElement,
  preview: BatchTaskPreview,
  context: WorkflowWorkspaceContext,
  clear: () => void
): void {
  parent.empty();
  parent.createEl('p', {
    text: `${preview.rows.length} tasks will change; ${preview.excludedTaskIds.length} completed/cancelled tasks excluded.`
  });
  const list = parent.createEl('ul');
  const window = pagedCollectionWindow(preview.rows.length, context.state.batchPreviewPage, 50);
  context.state.batchPreviewPage = window.page;
  for (const row of pageCollection(preview.rows, window))
    list.createEl('li', {
      text: `${row.before.title}: ${row.before.status}/${row.before.priority}/${row.before.owner ?? 'Unassigned'} → ${row.after.status}/${row.after.priority}/${row.after.owner ?? 'Unassigned'}`
    });
  renderBatchPreviewNavigation(parent, preview, context, clear, window.offset, window.end);
  const apply = parent.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Apply reviewed batch',
    attr: { type: 'button' }
  });
  apply.disabled = preview.rows.length === 0;
  apply.addEventListener('click', () => {
    apply.disabled = true;
    void context.workflows
      .applyBatchEdit(preview)
      .then((journalId) => {
        context.state.batchTaskIds.clear();
        clear();
        new Notice(`Batch completed with journal ${journalId}.`);
      })
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Batch stopped; its journal retains recovery state.'));
        apply.disabled = false;
      });
  });
}

/** Preserves one immutable batch preview while exposing every row through bounded local pages. */
function renderBatchPreviewNavigation(
  parent: HTMLElement,
  preview: BatchTaskPreview,
  context: WorkflowWorkspaceContext,
  clear: () => void,
  offset: number,
  end: number
): void {
  if (preview.rows.length <= 50) return;
  const navigation = parent.createDiv({ cls: 'pm-pagination' });
  const previous = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Previous batch page',
    attr: { type: 'button' }
  });
  previous.disabled = context.state.batchPreviewPage === 0;
  previous.addEventListener('click', () => {
    context.state.batchPreviewPage = Math.max(0, context.state.batchPreviewPage - 1);
    renderBatchPreview(parent, preview, context, clear);
  });
  navigation.createSpan({
    text: `Batch rows ${offset + 1}–${end} of ${preview.rows.length}`
  });
  const next = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Next batch page',
    attr: { type: 'button' }
  });
  next.disabled = end >= preview.rows.length;
  next.addEventListener('click', () => {
    context.state.batchPreviewPage += 1;
    renderBatchPreview(parent, preview, context, clear);
  });
}

/**
 * WFL-011 inspector exposes all task evidence in labelled sections. Saving completion with an
 * incomplete required checklist or downstream dependants requires a separate acknowledgement.
 */
function renderTaskInspector(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  workflowRecord: CatalogRecord,
  stages: readonly WorkflowStage[],
  tasks: readonly WorkflowTask[],
  task: WorkflowTask
): void {
  const inspector = parent.createEl('section', {
    cls: 'pm-panel pm-task-inspector',
    attr: { 'aria-label': `Task inspector for ${task.title}` }
  });
  const heading = inspector.createDiv({ cls: 'pm-section-heading' });
  heading.createEl('h3', { text: `Task inspector · ${task.title}` });
  const close = heading.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Close inspector',
    attr: { type: 'button' }
  });
  close.addEventListener('click', () => {
    delete context.state.selectedTaskId;
    context.state.dependencyPage = 0;
    context.state.dependencySelections.clear();
    context.rerender();
  });

  const record = context.snapshot.tasks.find(({ id }) => id === task.id);
  if (record === undefined) return;
  const details = inspector.createEl('details');
  details.open = true;
  details.createEl('summary', { text: 'Details' });
  const fields = details.createDiv({ cls: 'pm-form-grid' });
  const title = inputField(fields, 'Title', 'text', task.title);
  const status = selectField(
    fields,
    'Status',
    ['not-started', 'active', 'done', 'cancelled'],
    task.status
  );
  const priority = selectField(
    fields,
    'Priority',
    ['low', 'normal', 'high', 'urgent'],
    task.priority
  );
  const stage = selectField(
    fields,
    'Stage',
    stages.map(({ id }) => id),
    task.stageId
  );
  for (const option of Array.from(stage.options))
    option.text = stages.find(({ id }) => id === option.value)?.label ?? option.value;
  const owner = inputField(fields, 'Owner', 'text', task.owner ?? '');
  const deadline = inputField(fields, 'Deadline', 'date', task.deadline ?? '');
  const required = labelledCheckbox(fields, 'Required for stage completion', task.required);
  const notes = textareaField(fields, 'Notes', task.notes ?? '');

  const checklistDetails = inspector.createEl('details');
  checklistDetails.open = true;
  checklistDetails.createEl('summary', { text: `Checklist · ${task.checklist.items.length}` });
  const checklistInputs = task.checklist.items.map((item) =>
    renderChecklistItem(checklistDetails, item)
  );
  const addChecklistRow = checklistDetails.createDiv({ cls: 'pm-action-row' });
  const newChecklistText = addChecklistRow.createEl('input', {
    attr: { type: 'text', maxlength: '240', placeholder: 'New required checklist item' }
  });
  const addChecklist = addChecklistRow.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Add checklist item',
    attr: { type: 'button' }
  });
  addChecklist.addEventListener('click', () => {
    addChecklist.disabled = true;
    void context.workflows
      .addChecklistItem(record.path, newChecklistText.value)
      .then(() => new Notice('Checklist item added.'))
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Checklist item could not be added.'));
        addChecklist.disabled = false;
      });
  });

  const dependencyDetails = inspector.createEl('details');
  dependencyDetails.createEl('summary', { text: `Dependencies · ${task.dependsOn.length}` });
  const dependencyCandidates = tasks.filter(({ id }) => id !== task.id);
  const dependencySelection =
    context.state.dependencySelections.get(task.id) ?? new Set(task.dependsOn);
  context.state.dependencySelections.set(task.id, dependencySelection);
  const dependencyRegion = dependencyDetails.createDiv();
  renderDependencyPage(dependencyRegion, context, dependencyCandidates, dependencySelection);
  const blockers = textareaField(
    dependencyDetails,
    'Manual blockers (one per line)',
    task.manualBlockers.join('\n')
  );
  const assessment = context.workflows.assessTask(task.id);
  dependencyDetails.createEl('p', {
    text: assessment.blocked ? assessment.explanations.join(' ') : 'Not currently blocked.'
  });

  const links = inspector.createEl('details');
  links.createEl('summary', { text: 'Links and attachments' });
  const edition = selectField(
    links,
    'Linked edition',
    [
      '',
      ...context.snapshot.editions
        .filter((candidate) => candidate.fields['book-id'] === context.book.id)
        .map(({ id }) => id)
    ],
    task.editionId ?? ''
  );
  const attachments = textareaField(
    links,
    'Vault-relative attachments (one per line)',
    task.attachments.join('\n')
  );
  links.createEl('pre', { text: JSON.stringify(task.linkedMetadata, null, 2) });

  const time = inspector.createEl('details');
  time.createEl('summary', { text: 'Time' });
  const estimate = inputField(
    time,
    'Estimate in minutes',
    'number',
    numberText(task.estimateMinutes)
  );
  const actual = inputField(time, 'Actual minutes', 'number', numberText(task.actualMinutes));

  const activity = inspector.createEl('details');
  activity.createEl('summary', { text: 'Activity' });
  const events = context.snapshot.recentActivity.filter(
    ({ entityId, path }) => entityId === task.id || path === record.path
  );
  if (events.length === 0)
    activity.createEl('p', { cls: 'pm-muted', text: 'No activity in this session.' });
  else {
    const list = activity.createEl('ul');
    for (const event of events)
      list.createEl('li', { text: `${event.occurredAt} · ${event.action} · ${event.path}` });
  }

  renderRetailerConfirmation(inspector, context, workflowRecord, stages, task, record);
  const downstream = tasks.filter(({ dependsOn }) => dependsOn.includes(task.id));
  const acknowledgement = labelledCheckbox(
    inspector,
    `I reviewed completion warnings (${task.checklist.items.filter((item) => item.required && !item.done).length} incomplete required checklist items; ${downstream.length} downstream tasks).`
  );
  const errors = inspector.createDiv({
    cls: 'pm-validation-summary',
    attr: { 'aria-live': 'polite' }
  });
  const actions = inspector.createDiv({ cls: 'pm-action-row' });
  const save = actions.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Save task',
    attr: { type: 'button' }
  });
  const open = actions.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Open task Markdown',
    attr: { type: 'button' }
  });
  open.addEventListener('click', () => void context.openNote(record.path));
  save.addEventListener('click', () => {
    const checklist = checklistInputs.map(({ item, done }) => ({ ...item, done: done.checked }));
    const estimateMinutes = numberValue(estimate.value);
    const actualMinutes = numberValue(actual.value);
    if (
      status.value === 'done' &&
      (checklist.some((item) => item.required && !item.done) || downstream.length > 0) &&
      !acknowledgement.checked
    ) {
      errors.setText('Review and acknowledge the completion warnings before saving done.');
      return;
    }
    save.disabled = true;
    errors.empty();
    void context.workflows
      .editTask(record.path, {
        workflowId: task.workflowId,
        stageId: stage.value,
        ...(edition.value ? { editionId: edition.value } : {}),
        title: title.value,
        status: status.value as TaskStatus,
        priority: priority.value as TaskPriority,
        required: required.checked,
        ...(deadline.value ? { deadline: deadline.value } : {}),
        ...(estimateMinutes === undefined ? {} : { estimateMinutes }),
        ...(actualMinutes === undefined ? {} : { actualMinutes }),
        ...(owner.value.trim() ? { owner: owner.value.trim() } : {}),
        ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
        attachments: lines(attachments.value),
        checklist: { items: checklist },
        dependsOn: [...dependencySelection],
        manualBlockers: lines(blockers.value),
        linkedMetadata: { ...task.linkedMetadata }
      })
      .then(() => {
        context.state.dependencySelections.delete(task.id);
        new Notice('Task saved.');
      })
      .catch((cause: unknown) => {
        errors.setText(errorMessage(cause, 'Task could not be saved.'));
        save.disabled = false;
      });
  });
}

/**
 * Replaces only dependency rows so paging cannot discard unsaved title, checklist, time, or other
 * inspector fields. The stable-ID Set retains checked candidates outside the visible page.
 */
function renderDependencyPage(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  candidates: readonly WorkflowTask[],
  selection: Set<string>
): void {
  parent.empty();
  const window = pagedCollectionWindow(candidates.length, context.state.dependencyPage, 50);
  context.state.dependencyPage = window.page;
  for (const candidate of pageCollection(candidates, window)) {
    const input = labelledCheckbox(
      parent,
      `${candidate.title} · ${candidate.status}`,
      selection.has(candidate.id)
    );
    input.addEventListener('change', () => {
      if (input.checked) selection.add(candidate.id);
      else selection.delete(candidate.id);
    });
  }
  if (candidates.length <= 50) return;
  const navigation = parent.createDiv({ cls: 'pm-pagination' });
  const previous = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Previous dependency page',
    attr: { type: 'button' }
  });
  previous.disabled = context.state.dependencyPage === 0;
  previous.addEventListener('click', () => {
    context.state.dependencyPage = Math.max(0, context.state.dependencyPage - 1);
    renderDependencyPage(parent, context, candidates, selection);
  });
  navigation.createSpan({
    text: `Dependencies ${window.offset + 1}–${window.end} of ${candidates.length}`
  });
  const next = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Next dependency page',
    attr: { type: 'button' }
  });
  next.disabled = window.end >= candidates.length;
  next.addEventListener('click', () => {
    context.state.dependencyPage += 1;
    renderDependencyPage(parent, context, candidates, selection);
  });
}

/** Retailer evidence is visually and technically separate from Done and supports explicit revoke. */
function renderRetailerConfirmation(
  parent: HTMLElement,
  context: WorkflowWorkspaceContext,
  _workflowRecord: CatalogRecord,
  stages: readonly WorkflowStage[],
  task: WorkflowTask,
  record: CatalogRecord
): void {
  const stage = stages.find(({ id }) => id === task.stageId);
  if (!['retail-upload', 'retail-review', 'preorder', 'published'].includes(stage?.category ?? ''))
    return;
  const section = parent.createEl('details');
  section.open = true;
  section.createEl('summary', { text: 'External retailer confirmation · manual only' });
  const current = context.workflows.retailerConfirmation(task);
  section.createEl('p', {
    text: current.confirmed
      ? `Confirmed manually ${current.confirmedAt ?? ''}. Completing a task did not create this evidence.`
      : 'Not confirmed. Task or stage completion never implies an upload, review, preorder, or publication happened externally.'
  });
  const note = inputField(section, 'Confirmation note', 'text', current.note ?? '');
  const button = section.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: current.confirmed ? 'Revoke manual confirmation' : 'Confirm external action manually',
    attr: { type: 'button' }
  });
  button.addEventListener('click', () => {
    button.disabled = true;
    void context.workflows
      .confirmRetailerAction(record.path, !current.confirmed, note.value)
      .then(
        () =>
          new Notice(
            current.confirmed
              ? 'Retailer confirmation revoked.'
              : 'External action confirmed manually.'
          )
      )
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause, 'Retailer confirmation could not be changed.'));
        button.disabled = false;
      });
  });
}

/** Checklist rows retain stable item identities while exposing labelled completion controls. */
function renderChecklistItem(parent: HTMLElement, item: ChecklistItem) {
  const label = parent.createEl('label', { cls: 'pm-checklist-row' });
  const done = label.createEl('input', { attr: { type: 'checkbox' } });
  done.checked = item.done;
  label.createSpan({ text: `${item.text}${item.required ? ' · required' : ' · optional'}` });
  return { item, done };
}

/** Stable ordering groups stages and then prioritizes urgent/due work. */
function orderedTasks(
  tasks: readonly WorkflowTask[],
  stages: readonly WorkflowStage[]
): WorkflowTask[] {
  const order = new Map(stages.map(({ id, order: position }) => [id, position]));
  const priority = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return [...tasks].sort(
    (left, right) =>
      (order.get(left.stageId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.stageId) ?? Number.MAX_SAFE_INTEGER) ||
      priority[left.priority] - priority[right.priority] ||
      (left.deadline ?? '9999-12-31').localeCompare(right.deadline ?? '9999-12-31') ||
      left.title.localeCompare(right.title)
  );
}

/** Catalog projections retain real timestamps while this adapter supplies the domain envelope. */
function catalogEnvelope(record: CatalogRecord, type: 'workflow') {
  return {
    pmId: record.id,
    pmType: type,
    pmSchema: record.schemaVersion,
    createdAt: record.createdAt ?? '2000-01-01T00:00:00.000Z',
    updatedAt: record.updatedAt ?? '2000-01-01T00:00:00.000Z',
    ...(record.archived ? { archivedAt: record.updatedAt ?? '2000-01-01T00:00:00.000Z' } : {})
  } as const;
}

/** Small form helpers keep every control visibly labelled and consistently keyboard reachable. */
function inputField(
  parent: HTMLElement,
  labelText: string,
  type: string,
  value: string
): HTMLInputElement {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  return label.createEl('input', { value, attr: { type } });
}
function textareaField(parent: HTMLElement, labelText: string, value: string): HTMLTextAreaElement {
  const label = parent.createEl('label', { cls: 'pm-field pm-field--wide' });
  label.createSpan({ text: labelText });
  return label.createEl('textarea', { text: value, attr: { rows: '4' } });
}
function selectField(
  parent: HTMLElement,
  labelText: string,
  values: readonly string[],
  selected: string
): HTMLSelectElement {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  const select = label.createEl('select');
  for (const value of values)
    select.createEl('option', {
      value,
      text: value || 'No change',
      attr: value === selected ? { selected: 'true' } : {}
    });
  return select;
}
function optionalSelect(
  parent: HTMLElement,
  label: string,
  values: readonly string[]
): HTMLSelectElement {
  return selectField(parent, label, values, '');
}
function labelledCheckbox(parent: HTMLElement, text: string, checked = false): HTMLInputElement {
  const label = parent.createEl('label', { cls: 'pm-checkbox-field' });
  const input = label.createEl('input', { attr: { type: 'checkbox' } });
  input.checked = checked;
  label.createSpan({ text });
  return input;
}
function lines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
function numberValue(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}
function formatMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
