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
import { pageCollection, pagedCollectionWindow } from '../view-models/paged-collection';

export interface IsbnWorkspaceState {
  importText: string;
  importPreview?: IsbnImportPreview;
  /** Import evidence is paged independently from the canonical pool. */
  importPage: number;
  transaction?: IsbnTransactionPreview;
  editionId?: string;
  formatId?: string;
  /** A free global identifier can be selected for this Project without rendering the global pool. */
  availableIsbnId?: string;
  correctionReason: string;
  /** Zero-based disposable page for ISBNs already related to this Project. */
  poolPage: number;
}

export function createIsbnWorkspaceState(): IsbnWorkspaceState {
  return { importText: '', importPage: 0, correctionReason: '', poolPage: 0 };
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
  title.createEl('h2', { text: 'Project ISBNs' });
  title.createEl('p', {
    text: 'Assign and manage ISBNs used by this Project. Add identifiers and browse the full inventory in Global data library.'
  });
  renderTransactionPreview(page, context);
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
    context.state.importPage = 0;
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
    context.state.importPage = 0;
    context.rerender();
  });
  const result = context.state.importPreview;
  if (result === undefined) return;
  const window = pagedCollectionWindow(result.rows.length, context.state.importPage, 50);
  context.state.importPage = window.page;
  details.createEl('p', { text: `${result.ready} ready · ${result.rejected} rejected` });
  const table = details.createEl('table', { cls: 'pm-mobile-table' });
  const head = table.createEl('thead').createEl('tr');
  for (const label of ['Row', 'Input', 'Normalized', 'Result'])
    head.createEl('th', { text: label });
  const body = table.createEl('tbody');
  for (const row of pageCollection(result.rows, window)) {
    const tr = body.createEl('tr');
    const values = [
      ['Row', String(row.row)],
      ['Input', row.input],
      ['Normalized', row.normalized ?? '—'],
      ['Result', `${row.status}: ${row.message}`]
    ] as const;
    for (const [label, value] of values)
      tr.createEl('td', { text: value, attr: { 'data-label': label } });
  }
  renderImportNavigation(details, context, window.offset, window.end, result.rows.length);
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
          context.state.importPage = 0;
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

/** Every import result remains reviewable while the table mounts at most fifty evidence rows. */
function renderImportNavigation(
  parent: HTMLElement,
  context: IsbnWorkspaceContext,
  offset: number,
  end: number,
  total: number
): void {
  if (total <= 50) return;
  const navigation = parent.createDiv({ cls: 'pm-pagination' });
  const previous = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Previous import page',
    attr: { type: 'button' }
  });
  previous.disabled = context.state.importPage === 0;
  previous.addEventListener('click', () => {
    context.state.importPage = Math.max(0, context.state.importPage - 1);
    context.rerender();
  });
  navigation.createSpan({ text: `Import rows ${offset + 1}–${end} of ${total}` });
  const next = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Next import page',
    attr: { type: 'button' }
  });
  next.disabled = end >= total;
  next.addEventListener('click', () => {
    context.state.importPage += 1;
    context.rerender();
  });
}

/** Assignment selectors are shared by card actions so the chosen scope is always visible. */
function renderAssignmentSelectors(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const card = parent.createEl('section', { cls: 'pm-panel' });
  card.createEl('h3', { text: 'Assignment target' });
  card.createEl('p', {
    text: 'Choose a Publishing Item revision and optional concrete format before Reserve or Assign. Each revision can receive its own ISBN.'
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
  const free = context.snapshot.isbns.filter((record) => record.fields.status === 'available');
  const freeLabel = card.createEl('label', { cls: 'pm-field', text: 'Available ISBN' });
  const freeIsbn = freeLabel.createEl('select', { attr: { 'aria-label': 'Available ISBN to assign' } });
  freeIsbn.createEl('option', { value: '', text: 'Choose available ISBN' });
  for (const record of free)
    freeIsbn.createEl('option', {
      value: record.id,
      text: String(record.fields.value),
      attr: record.id === context.state.availableIsbnId ? { selected: 'true' } : {}
    });
  freeIsbn.addEventListener('change', () => {
    if (freeIsbn.value) context.state.availableIsbnId = freeIsbn.value;
    else delete context.state.availableIsbnId;
  });
  const assign = card.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Assign selected ISBN',
    attr: { type: 'button' }
  });
  assign.addEventListener('click', () => {
    const recordId = context.state.availableIsbnId;
    if (recordId === undefined) {
      new Notice('Choose an available ISBN first.');
      return;
    }
    try {
      context.state.transaction = context.isbns.previewTransaction({
        recordId,
        action: 'assign',
        ...(context.state.editionId === undefined ? {} : { editionId: context.state.editionId }),
        ...(context.state.formatId === undefined ? {} : { formatId: context.state.formatId })
      });
      context.rerender();
    } catch (cause) {
      new Notice(errorMessage(cause));
    }
  });
  const reason = card.createEl('input', {
    value: context.state.correctionReason,
    attr: { type: 'text', placeholder: 'Published ISBN correction reason' }
  });
  reason.addEventListener('input', () => {
    context.state.correctionReason = reason.value;
  });
}

function renderPool(parent: HTMLElement, context: IsbnWorkspaceContext): void {
  const pageSize = 50;
  const editionIds = new Set(
    context.snapshot.editions
      .filter((edition) => edition.fields['book-id'] === context.book.id)
      .map((edition) => edition.id)
  );
  const projectIsbns = context.snapshot.isbns.filter(
    (record) => typeof record.fields['edition-id'] === 'string' && editionIds.has(record.fields['edition-id'])
  );
  const total = projectIsbns.length;
  const window = pagedCollectionWindow(total, context.state.poolPage, pageSize);
  context.state.poolPage = window.page;
  const visible = pageCollection(projectIsbns, window);
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `ISBNs assigned to this Project · ${total}` });
  if (total === 0) {
    section.createEl('p', {
      cls: 'pm-muted',
      text: 'No ISBNs are assigned to this Project. Choose a free ISBN above, or manage the global inventory in Global data library.'
    });
    return;
  }
  const grid = section.createDiv({ cls: 'pm-isbn-grid' });
  for (const record of visible) {
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
  renderPoolNavigation(section, context, window.offset, pageSize, total);
}

/** Keeps ISBN DOM bounded while retaining exact, keyboard-operable access to the complete pool. */
function renderPoolNavigation(
  parent: HTMLElement,
  context: IsbnWorkspaceContext,
  offset: number,
  pageSize: number,
  total: number
): void {
  const navigation = parent.createDiv({ cls: 'pm-pagination' });
  const previous = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Previous identifier page',
    attr: { type: 'button' }
  });
  previous.disabled = context.state.poolPage === 0;
  previous.addEventListener('click', () => {
    context.state.poolPage = Math.max(0, context.state.poolPage - 1);
    context.rerender();
  });
  navigation.createSpan({
    text: `ISBNs ${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}`
  });
  const next = navigation.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Next identifier page',
    attr: { type: 'button' }
  });
  next.disabled = offset + pageSize >= total;
  next.addEventListener('click', () => {
    context.state.poolPage += 1;
    context.rerender();
  });
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
