/** Native HIS-003 chronological history, bounded evidence inspection, filters, and retention window. */
import { Notice } from 'obsidian';
import type { HistoryProjectService } from '../../application/history/history-project-service';
import {
  type HistoryPreferencesService,
  type HistoryRetentionDays
} from '../../application/history/history-preferences-service';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';

export interface HistoryWorkspaceState {
  action: string;
  entityType: string;
  actor: string;
  search: string;
  from: string;
  to: string;
}
export function createHistoryWorkspaceState(): HistoryWorkspaceState {
  return { action: '', entityType: '', actor: '', search: '', from: '', to: '' };
}

export function renderHistoryWorkspace(context: {
  parent: HTMLElement;
  book: CatalogRecord;
  history: HistoryProjectService;
  preferences: HistoryPreferencesService;
  state: HistoryWorkspaceState;
  rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-history-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Append-only · local · privacy-bounded' });
  title.createEl('h2', { text: 'History' });
  title.createEl('p', {
    text: 'Publishing Manager records user-meaningful changes without copying note bodies, quotes, private notes, or imported source payloads.'
  });
  renderCaptureState(page, context);
  renderFilters(page, context);
  renderEvents(page, context);
}

function renderCaptureState(
  parent: HTMLElement,
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const panel = parent.createEl('section', { cls: 'pm-panel' });
  const preferences = context.preferences.current();
  panel.createEl('p', {
    text: `Actor: ${preferences.actorLabel}. Canonical records are never automatically edited or deleted by the history window.`
  });
  const row = panel.createDiv({ cls: 'pm-action-row' });
  const label = row.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: 'History retention window' });
  const select = label.createEl('select');
  for (const [value, text] of [
    ['0', 'All canonical history'],
    ['365', 'Most recent year'],
    ['1095', 'Most recent 3 years'],
    ['1825', 'Most recent 5 years']
  ] as const) {
    select.createEl('option', {
      value,
      text,
      attr: Number(value) === preferences.retentionDays ? { selected: 'true' } : {}
    });
  }
  select.addEventListener('change', () => {
    void context.preferences
      .save({ ...preferences, retentionDays: Number(select.value) as HistoryRetentionDays })
      .then(() => context.rerender())
      .catch((cause: unknown) => new Notice(message(cause)));
  });
  const failures = context.history.failedCaptureCount();
  if (failures > 0) {
    panel.createDiv({
      cls: 'pm-inline-alert',
      text: `${failures} committed change${failures === 1 ? '' : 's'} could not yet write history evidence. The original operation will not be repeated.`,
      attr: { role: 'alert' }
    });
    const retry = row.createEl('button', {
      cls: 'pm-button pm-button--quiet',
      text: 'Retry history capture',
      attr: { type: 'button' }
    });
    retry.addEventListener('click', () => {
      void context.history.retryFailedCaptures().then(() => context.rerender());
    });
  }
}

function renderFilters(
  parent: HTMLElement,
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Filter history' });
  const fields = details.createDiv({ cls: 'pm-form-grid' });
  input(fields, 'Search summaries', 'search', context);
  input(fields, 'Actor contains', 'actor', context);
  selectFilter(
    fields,
    'Action',
    'action',
    ['', 'created', 'updated', 'archived', 'restored'],
    context
  );
  selectFilter(
    fields,
    'Entity type',
    'entityType',
    [
      '',
      'book',
      'edition',
      'format',
      'workflow',
      'task',
      'metadata-set',
      'isbn',
      'price',
      'platform-target',
      'readiness-override',
      'sales-line',
      'sales-correction',
      'launch',
      'review',
      'asset-reference'
    ],
    context
  );
  date(fields, 'From date', 'from', context);
  date(fields, 'Through date', 'to', context);
  const reset = details.createEl('button', {
    cls: 'pm-button pm-button--quiet',
    text: 'Clear filters',
    attr: { type: 'button' }
  });
  reset.addEventListener('click', () => {
    Object.assign(context.state, createHistoryWorkspaceState());
    context.rerender();
  });
}

function renderEvents(
  parent: HTMLElement,
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const events = context.history.eventsForBook(context.book.id, {
    ...(context.state.action ? { action: context.state.action } : {}),
    ...(context.state.entityType ? { entityType: context.state.entityType } : {}),
    ...(context.state.actor ? { actor: context.state.actor } : {}),
    ...(context.state.search ? { search: context.state.search } : {}),
    ...(context.state.from ? { from: context.state.from } : {}),
    ...(context.state.to ? { to: context.state.to } : {})
  });
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `Chronological history · ${events.length}` });
  if (events.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No history events match this view.' });
    return;
  }
  const list = section.createEl('ol');
  for (const event of events) {
    const row = list.createEl('li', { cls: 'pm-panel' });
    row.createEl('strong', { text: text(event.fields.summary, 'Recorded change') });
    row.createEl('p', {
      text: `${formatTimestamp(event.fields.timestamp)} · ${text(event.fields['actor-label'], 'Local user')} · ${text(event.fields.action, 'changed')}`
    });
    const evidence = row.createEl('details');
    evidence.createEl('summary', { text: 'Inspect bounded before/after evidence' });
    evidence.createEl('p', {
      text: `Before: ${text(event.fields['before-summary'], 'Not applicable')}`
    });
    evidence.createEl('p', { text: `After: ${text(event.fields['after-summary'], 'Not set')}` });
  }
}

type FilterKey = keyof HistoryWorkspaceState;
function input(
  parent: HTMLElement,
  labelText: string,
  key: Extract<FilterKey, 'actor' | 'search'>,
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  const control = label.createEl('input', { type: 'search', value: context.state[key] });
  control.addEventListener('change', () => {
    context.state[key] = control.value;
    context.rerender();
  });
}
function date(
  parent: HTMLElement,
  labelText: string,
  key: Extract<FilterKey, 'from' | 'to'>,
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  const control = label.createEl('input', { type: 'date', value: context.state[key] });
  control.addEventListener('change', () => {
    context.state[key] = control.value;
    context.rerender();
  });
}
function selectFilter(
  parent: HTMLElement,
  labelText: string,
  key: Extract<FilterKey, 'action' | 'entityType'>,
  values: readonly string[],
  context: Parameters<typeof renderHistoryWorkspace>[0]
): void {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  const control = label.createEl('select');
  for (const value of values)
    control.createEl('option', {
      value,
      text: value ? value.replaceAll('-', ' ') : 'All',
      attr: context.state[key] === value ? { selected: 'true' } : {}
    });
  control.addEventListener('change', () => {
    context.state[key] = control.value;
    context.rerender();
  });
}
function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string') return 'Unknown time';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'History settings could not be saved.';
}
