/**
 * Renders ISBN-006–ISBN-007 as an accessible pool and guarded assignment surface. Imports and
 * lifecycle actions always stop at a human-readable preview before mutation; published corrections
 * require a reason and can never return an identifier to the available pool.
 */

import { Notice } from 'obsidian';

import type {
  IsbnImportPreview,
  IsbnProjectService,
  IsbnTransactionPreview
} from '../../application/isbn/isbn-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';

export interface IsbnWorkspaceState {
  importText: string;
  importPreview?: IsbnImportPreview;
  transaction?: IsbnTransactionPreview;
  editionId?: string;
  formatId?: string;
  correctionReason: string;
}

export function createIsbnWorkspaceState(): IsbnWorkspaceState {
  return { importText: '', correctionReason: '' };
}

export interface IsbnWorkspaceContext {
  readonly parent: HTMLElement;
  readonly book: CatalogRecord;
  readonly snapshot: BookCatalogSnapshot;
  readonly isbns: IsbnProjectService;
  readonly state: IsbnWorkspaceState;
  readonly rerender: () => void;
}

export function renderIsbnWorkspace(context: IsbnWorkspaceContext): void {
  const page = context.parent.createEl('section', { cls: 'pm-isbn-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Canonical identifier pool' });
  title.createEl('h2', { text: 'ISBN management' });
  title.createEl('p', {
    text: 'Normalize ISBN-10/13 values, import with row-level evidence, and move identifiers through previewed reservation, assignment, publication, release, retirement, or correction.'
  });
  renderTransactionPreview(page, context);
  renderImport(page, context);
  renderAssignmentSelectors(page, context);
  renderPool(page, context);
}

function renderImport(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Add or import ISBNs' });
  details.createEl('p', {
    text: 'Enter one ISBN-10 or ISBN-13 per line. Hyphens and spaces are presentation only. Preview reports invalid check digits and duplicates before any record is created.'
  });
  const input = details.createEl('textarea', {
    text: context.state.importText,
    attr: { rows: '7', placeholder: '978-1-4028-9462-6\n0-306-40615-2' }
  });
  input.addEventListener('input', () => {
    context.state.importText = input.value;
    delete context.state.importPreview;
  });
  const actions = details.createDiv({ cls: 'pm-action-row' });
  const preview = actions.createEl('button', {
    cls: 'pm-button',
    text: 'Preview import',
    attr: { type: 'button' }
  });
  preview.addEventListener('click', () => {
    context.state.importText = input.value;
    context.state.importPreview = context.isbns.previewImport(input.value);
    context.rerender();
  });
  const result = context.state.importPreview;
  if (result === undefined) return;
  details.createEl('p', { text: `${result.ready} ready · ${result.rejected} rejected` });
  const table = details.createEl('table');
  const head = table.createEl('thead').createEl('tr');
  for (const label of ['Row', 'Input', 'Normalized', 'Result'])
    head.createEl('th', { text: label });
  const body = table.createEl('tbody');
  for (const row of result.rows) {
    const tr = body.createEl('tr');
    tr.createEl('td', { text: String(row.row) });
    tr.createEl('td', { text: row.input });
    tr.createEl('td', { text: row.normalized ?? '—' });
    tr.createEl('td', { text: `${row.status}: ${row.message}` });
  }
  if (result.ready > 0) {
    const apply = details.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: `Add ${result.ready} ready ISBN${result.ready === 1 ? '' : 's'}`,
      attr: { type: 'button' }
    });
    apply.addEventListener('click', () => {
      apply.disabled = true;
      void context.isbns
        .applyImport(context.state.importText)
        .then((records) => {
          new Notice(`${records.length} ISBN${records.length === 1 ? '' : 's'} added.`);
          context.state.importText = '';
          delete context.state.importPreview;
          context.rerender();
        })
        .catch((cause: unknown) => {
          new Notice(errorMessage(cause));
          apply.disabled = false;
        });
    });
  }
}

/** Assignment selectors are shared by card actions so the chosen scope is always visible. */
function renderAssignmentSelectors(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const card = parent.createEl('section', { cls: 'pm-panel' });
  card.createEl('h3', { text: 'Assignment target' });
  card.createEl('p', {
    text: 'Choose an edition and optional concrete format before Reserve or Assign. One assigned/published ISBN may occupy each edition/format scope.'
  });
  const editions = context.snapshot.editions.filter(
    (edition) => edition.fields['book-id'] === context.book.id
  );
  const edition = card.createEl('select', { attr: { 'aria-label': 'ISBN edition target' } });
  edition.createEl('option', { value: '', text: 'Choose edition' });
  for (const item of editions)
    edition.createEl('option', {
      value: item.id,
      text: `${String(item.fields.type)} · revision ${String(item.fields.revision)}`,
      attr: item.id === context.state.editionId ? { selected: 'true' } : {}
    });
  const format = card.createEl('select', { attr: { 'aria-label': 'Optional ISBN format target' } });
  const renderFormats = () => {
    format.empty();
    format.createEl('option', { value: '', text: 'Edition-wide / no format' });
    for (const item of context.snapshot.formats.filter(
      (candidate) => candidate.fields['edition-id'] === edition.value
    ))
      format.createEl('option', {
        value: item.id,
        text: String(item.fields.label ?? item.fields.kind),
        attr: item.id === context.state.formatId ? { selected: 'true' } : {}
      });
  };
  edition.addEventListener('change', () => {
    if (edition.value) context.state.editionId = edition.value;
    else delete context.state.editionId;
    delete context.state.formatId;
    renderFormats();
  });
  format.addEventListener('change', () => {
    if (format.value) context.state.formatId = format.value;
    else delete context.state.formatId;
  });
  renderFormats();
  const reason = card.createEl('input', {
    value: context.state.correctionReason,
    attr: { type: 'text', placeholder: 'Published ISBN correction reason' }
  });
  reason.addEventListener('input', () => {
    context.state.correctionReason = reason.value;
  });
}

function renderPool(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `ISBN pool · ${context.snapshot.isbns.length}` });
  if (context.snapshot.isbns.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No ISBNs. Add one above.' });
    return;
  }
  const grid = section.createDiv({ cls: 'pm-isbn-grid' });
  for (const record of context.snapshot.isbns) {
    const card = grid.createEl('article', { cls: 'pm-isbn-card' });
    card.createEl('strong', { text: String(record.fields.value) });
    if (typeof record.fields['isbn-10'] === 'string')
      card.createEl('p', { text: `ISBN-10: ${record.fields['isbn-10']}` });
    card.createEl('p', { text: `Status: ${String(record.fields.status)}` });
    card.createEl('p', {
      text:
        typeof record.fields['edition-id'] !== 'string'
          ? 'Unassigned'
          : `Edition ${record.fields['edition-id']}${typeof record.fields['format-id'] === 'string' ? ` · format ${record.fields['format-id']}` : ''}`
    });
    const actions = card.createDiv({ cls: 'pm-action-row' });
    for (const action of actionsFor(String(record.fields.status)))
      transactionButton(actions, context, record, action);
  }
}

function transactionButton(
  parent: HTMLElement,
  context: IsbnWorkspaceContext,
  record: CatalogRecord,
  action: 'reserve' | 'assign' | 'release' | 'publish' | 'retire' | 'correct'
): void {
  const button = parent.createEl('button', {
    cls: 'pm-text-button',
    text: actionLabel(action),
    attr: { type: 'button' }
  });
  button.addEventListener('click', () => {
    try {
      context.state.transaction = context.isbns.previewTransaction({
        recordId: record.id,
        action,
        ...(context.state.editionId === undefined ? {} : { editionId: context.state.editionId }),
        ...(context.state.formatId === undefined ? {} : { formatId: context.state.formatId }),
        ...(action === 'correct' ? { reason: context.state.correctionReason } : {})
      });
      context.rerender();
    } catch (cause) {
      new Notice(errorMessage(cause));
    }
  });
}

function renderTransactionPreview(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const preview = context.state.transaction;
  if (preview === undefined) return;
  const card = parent.createEl('section', { cls: 'pm-panel pm-inline-alert' });
  card.createEl('h3', { text: 'Review ISBN transaction' });
  card.createEl('p', { text: preview.explanation });
  for (const warning of preview.warnings) card.createEl('p', { text: `Warning: ${warning}` });
  card.createEl('pre', {
    text: `Before\n${JSON.stringify(preview.before, null, 2)}\n\nAfter\n${JSON.stringify(preview.after, null, 2)}`
  });
  const actions = card.createDiv({ cls: 'pm-action-row' });
  const apply = actions.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Apply reviewed transaction',
    attr: { type: 'button' }
  });
  apply.addEventListener('click', () => {
    apply.disabled = true;
    void context.isbns
      .applyTransaction(preview)
      .then(() => {
        new Notice('ISBN transaction applied.');
        delete context.state.transaction;
        context.state.correctionReason = '';
        context.rerender();
      })
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause));
        apply.disabled = false;
      });
  });
  const cancel = actions.createEl('button', {
    cls: 'pm-button',
    text: 'Cancel',
    attr: { type: 'button' }
  });
  cancel.addEventListener('click', () => {
    delete context.state.transaction;
    context.rerender();
  });
}

function actionsFor(
  status: string
): readonly ('reserve' | 'assign' | 'release' | 'publish' | 'retire' | 'correct')[] {
  if (status === 'available') return ['reserve', 'assign', 'retire'];
  if (status === 'reserved') return ['assign', 'release', 'retire'];
  if (status === 'assigned') return ['publish', 'release', 'retire'];
  if (status === 'published') return ['correct'];
  return [];
}
function actionLabel(action: string): string {
  if (action === 'correct') return 'Record correction';
  return action.charAt(0).toUpperCase() + action.slice(1);
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'ISBN operation failed.';
}
