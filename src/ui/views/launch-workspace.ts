/** Native LCH-001–LCH-006 preview, apply, reflow, protection, and critical-path workspace. */
import { Notice } from 'obsidian';
import type {
  LaunchPlanPreview,
  LaunchProjectService
} from '../../application/launch/launch-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { LaunchReflowMode } from '../../domain/launch/launch-plan';
import { pageCollection, pagedCollectionWindow } from '../view-models/paged-collection';

export interface LaunchWorkspaceState {
  editionId: string;
  publicationDate: string;
  mode: LaunchReflowMode;
  preview?: LaunchPlanPreview;
  editionPage: number;
  previewPage: number;
  planPage: number;
  taskPages: Record<string, number>;
}
export function createLaunchWorkspaceState(): LaunchWorkspaceState {
  return {
    editionId: '',
    publicationDate: '',
    mode: 'all-unpinned',
    editionPage: 0,
    previewPage: 0,
    planPage: 0,
    taskPages: {}
  };
}

export function renderLaunchWorkspace(context: {
  parent: HTMLElement;
  book: CatalogRecord;
  snapshot: BookCatalogSnapshot;
  launches: LaunchProjectService;
  state: LaunchWorkspaceState;
  rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-launch-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Date-only · preview before mutation' });
  title.createEl('h2', { text: 'Launch planner' });
  title.createEl('p', {
    text: 'Work backwards from publication day. Completed and manually pinned dates are protected during every reflow.'
  });

  const form = page.createEl('form', { cls: 'pm-panel pm-form-grid' });
  const editions = context.snapshot.editions.filter(
    (item) => item.fields['book-id'] === context.book.id
  );
  const editionWindow = pagedCollectionWindow(editions.length, context.state.editionPage, 50);
  context.state.editionPage = editionWindow.page;
  const edition = form.createEl('select', { attr: { 'aria-label': 'Launch edition' } });
  edition.createEl('option', { value: '', text: 'Book-wide launch' });
  for (const item of pageCollection(editions, editionWindow))
    edition.createEl('option', { value: item.id, text: String(item.fields.type) });
  const selectedEdition = editions.find(({ id }) => id === context.state.editionId);
  if (
    selectedEdition !== undefined &&
    !pageCollection(editions, editionWindow).some(({ id }) => id === selectedEdition.id)
  )
    edition.createEl('option', {
      value: selectedEdition.id,
      text: `${String(selectedEdition.fields.type)} · selected`
    });
  edition.value = context.state.editionId;
  edition.addEventListener('change', () => {
    context.state.editionId = edition.value;
    const selected = editions.find(({ id }) => id === edition.value);
    if (typeof selected?.fields['publication-date'] === 'string')
      context.state.publicationDate = selected.fields['publication-date'];
    clearPreview(context.state);
    context.rerender();
  });
  renderNavigation(form, editionWindow, 'edition option', (page) => {
    context.state.editionPage = page;
    context.rerender();
  });
  const anchor = form.createEl('input', {
    value: context.state.publicationDate,
    attr: { type: 'date', 'aria-label': 'Publication date' }
  });
  anchor.addEventListener('change', () => {
    context.state.publicationDate = anchor.value;
    clearPreview(context.state);
  });
  const mode = form.createEl('select', { attr: { 'aria-label': 'Launch reflow mode' } });
  for (const [value, label] of [
    ['all-unpinned', 'Reflow all unpinned incomplete work'],
    ['future-incomplete', 'Reflow future incomplete work only'],
    ['anchor-only', 'Change anchor only']
  ] as const)
    mode.createEl('option', { value, text: label });
  mode.value = context.state.mode;
  mode.addEventListener('change', () => {
    context.state.mode = mode.value as LaunchReflowMode;
    clearPreview(context.state);
  });
  const preview = form.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Preview launch plan',
    attr: { type: 'button' }
  });
  preview.addEventListener('click', () => {
    try {
      context.state.preview = context.launches.preview({
        bookId: context.book.id,
        ...(context.state.editionId ? { editionId: context.state.editionId } : {}),
        publicationDate: context.state.publicationDate,
        mode: context.state.mode
      });
      context.state.previewPage = 0;
      context.rerender();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : 'Launch preview failed.');
    }
  });

  if (context.state.preview !== undefined) renderPreview(page, context, context.state.preview);
  renderCurrentPlan(page, context);
}

function renderPreview(
  parent: HTMLElement,
  context: Parameters<typeof renderLaunchWorkspace>[0],
  preview: LaunchPlanPreview
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `Review ${preview.templateId} v${preview.templateVersion}` });
  section.createEl('p', { text: `Critical path: ${preview.criticalPath.join(' → ')}` });
  const window = pagedCollectionWindow(preview.rows.length, context.state.previewPage, 50);
  context.state.previewPage = window.page;
  const table = section.createEl('table', { cls: 'pm-table pm-mobile-table' });
  const head = table.createEl('thead').createEl('tr');
  for (const label of ['Milestone', 'Previous', 'Proposed', 'Action', 'Evidence'])
    head.createEl('th', { text: label });
  const body = table.createEl('tbody');
  for (const row of pageCollection(preview.rows, window)) {
    const tr = body.createEl('tr');
    const values = [
      ['Milestone', `${row.code} · ${row.label}`],
      ['Previous', row.previousDate ?? 'New'],
      ['Proposed', row.proposedDate],
      ['Action', row.action],
      ['Evidence', row.conflict ?? (row.past ? 'Date is in the past' : 'Ready')]
    ] as const;
    for (const [label, value] of values)
      tr.createEl('td', { text: value, attr: { 'data-label': label } });
  }
  renderNavigation(section, window, 'launch preview', (page) => {
    context.state.previewPage = page;
    context.rerender();
  });
  const apply = section.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Apply reviewed launch plan',
    attr: { type: 'button' }
  });
  apply.disabled = preview.rows.some(({ conflict }) => conflict !== undefined);
  apply.addEventListener(
    'click',
    () =>
      void context.launches
        .apply(preview)
        .then(() => {
          delete context.state.preview;
          context.rerender();
        })
        .catch(
          (cause: unknown) =>
            new Notice(cause instanceof Error ? cause.message : 'Launch plan could not be applied.')
        )
  );
}

function renderCurrentPlan(
  parent: HTMLElement,
  context: Parameters<typeof renderLaunchWorkspace>[0]
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  const plans = context.launches.launchesForBook(context.book.id);
  const planWindow = pagedCollectionWindow(plans.length, context.state.planPage, 10);
  context.state.planPage = planWindow.page;
  section.createEl('h3', { text: `Current launch plans · ${plans.length}` });
  if (!plans.length) {
    section.createEl('p', { cls: 'pm-muted', text: 'No launch plan has been applied.' });
    return;
  }
  for (const plan of pageCollection(plans, planWindow)) {
    const details = section.createEl('details');
    details.createEl('summary', {
      text: `${String(plan.fields['publication-date'])} · ${String(plan.fields['reflow-mode'])}`
    });
    details.createEl('pre', {
      text: JSON.stringify(
        { milestones: plan.fields.milestones, criticalPath: plan.fields['critical-path'] },
        null,
        2
      )
    });
    const workflow = context.snapshot.workflows.find(
      (item) => item.fields['book-id'] === context.book.id && !item.archived
    );
    const tasks = context.snapshot.tasks.filter(
      (task) =>
        task.fields['workflow-id'] === workflow?.id &&
        typeof (task.fields['linked-metadata'] as Record<string, unknown> | undefined)?.[
          'launch-milestone-code'
        ] === 'string'
    );
    const requestedTaskPage = context.state.taskPages[plan.id] ?? 0;
    const taskWindow = pagedCollectionWindow(tasks.length, requestedTaskPage, 10);
    context.state.taskPages[plan.id] = taskWindow.page;
    const list = details.createEl('ul');
    for (const task of pageCollection(tasks, taskWindow)) {
      const metadata = task.fields['linked-metadata'] as Record<string, unknown>;
      const pinned = metadata['launch-date-pinned'] === 'true';
      const row = list.createEl('li');
      row.appendText(
        `${String(task.fields.title)} · ${String(task.fields.deadline)} · ${String(task.fields.status)} `
      );
      const button = row.createEl('button', {
        cls: 'pm-button pm-button--quiet',
        text: pinned ? 'Unpin date' : 'Pin date',
        attr: { type: 'button' }
      });
      button.addEventListener(
        'click',
        () => void context.launches.setPinned(task.id, !pinned).then(context.rerender)
      );
    }
    renderNavigation(details, taskWindow, 'launch task', (page) => {
      context.state.taskPages[plan.id] = page;
      context.rerender();
    });
  }
  renderNavigation(section, planWindow, 'launch plan', (page) => {
    context.state.planPage = page;
    context.rerender();
  });
}
function clearPreview(state: LaunchWorkspaceState): void {
  delete state.preview;
  state.previewPage = 0;
}

/** Bounds each launch collection while preserving full preview/apply authority. */
function renderNavigation(
  parent: HTMLElement,
  window: ReturnType<typeof pagedCollectionWindow>,
  label: string,
  move: (page: number) => void
): void {
  if (window.total <= window.pageSize) return;
  const row = parent.createDiv({ cls: 'pm-pagination' });
  row.createSpan({ text: `${window.offset + 1}–${window.end} of ${window.total}` });
  const previous = row.createEl('button', {
    text: `Previous ${label} page`,
    attr: { type: 'button' }
  });
  previous.disabled = window.page === 0;
  previous.addEventListener('click', () => move(Math.max(0, window.page - 1)));
  const next = row.createEl('button', { text: `Next ${label} page`, attr: { type: 'button' } });
  next.disabled = window.page + 1 >= window.totalPages;
  next.addEventListener('click', () => move(window.page + 1));
}
