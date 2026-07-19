/** Native CAL-001–CAL-003 month/agenda/timeline, move-preview, and local ICS interface. */
import { Notice } from 'obsidian';
import type {
  CalendarEvent,
  CalendarMovePreview,
  CalendarProjectService
} from '../../application/calendar/calendar-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';

export interface CalendarWorkspaceState {
  view: 'month' | 'agenda' | 'book-timeline';
  month: string;
  bookId: string;
  moveEventId: string;
  proposedDate: string;
  movePreview?: CalendarMovePreview;
  acceptConflicts: boolean;
}
export function createCalendarWorkspaceState(today: string): CalendarWorkspaceState {
  return {
    view: 'month',
    month: today.slice(0, 7),
    bookId: '',
    moveEventId: '',
    proposedDate: '',
    acceptConflicts: false
  };
}

export function renderCalendarWorkspace(context: {
  parent: HTMLElement;
  calendar: CalendarProjectService;
  snapshot: BookCatalogSnapshot;
  state: CalendarWorkspaceState;
  visibleBookIds?: ReadonlySet<string>;
  openRecord: (record: CatalogRecord) => void;
  rerender: () => void;
}): void {
  const section = context.parent.createEl('section', { cls: 'pm-panel pm-calendar-page' });
  const heading = section.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Local all-day dates · no cloud events' });
  title.createEl('h2', { text: 'Publishing calendar' });
  const controls = section.createEl('form', { cls: 'pm-form-grid' });
  const view = controls.createEl('select', { attr: { 'aria-label': 'Calendar view' } });
  for (const [value, label] of [
    ['month', 'Month'],
    ['agenda', 'Agenda'],
    ['book-timeline', 'Book timeline']
  ] as const)
    view.createEl('option', { value, text: label });
  view.value = context.state.view;
  view.addEventListener('change', () => {
    context.state.view = view.value as CalendarWorkspaceState['view'];
    context.rerender();
  });
  const month = controls.createEl('input', {
    value: context.state.month,
    attr: { type: 'month', 'aria-label': 'Calendar month' }
  });
  month.addEventListener('change', () => {
    context.state.month = month.value;
    context.rerender();
  });
  const book = controls.createEl('select', { attr: { 'aria-label': 'Calendar book' } });
  book.createEl('option', { value: '', text: 'All visible books' });
  for (const item of context.snapshot.books.filter(
    (item) => context.visibleBookIds === undefined || context.visibleBookIds.has(item.id)
  ))
    book.createEl('option', { value: item.id, text: text(item.fields.title, item.id) });
  book.value = context.state.bookId;
  book.addEventListener('change', () => {
    context.state.bookId = book.value;
    context.rerender();
  });
  const visible = context.state.bookId ? new Set([context.state.bookId]) : context.visibleBookIds;
  const allEvents = context.calendar.events(visible);
  const events =
    context.state.view === 'agenda'
      ? allEvents
      : allEvents.filter(({ date }) => date.startsWith(context.state.month));
  const exportButton = controls.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Export visible dates to ICS',
    attr: { type: 'button' }
  });
  exportButton.disabled = events.length === 0;
  exportButton.addEventListener(
    'click',
    () =>
      void context.calendar
        .exportIcs(events)
        .then((path) => new Notice(`Local calendar created at ${path}.`))
  );

  if (!events.length) {
    section.createEl('p', {
      cls: 'pm-muted',
      text: 'No canonical publishing dates match this view.'
    });
  } else if (context.state.view === 'month') {
    renderMonth(section, events, context);
  } else {
    renderAgenda(section, events, context, context.state.view === 'book-timeline');
  }
  renderMovePreview(section, context);
}

function renderMonth(
  parent: HTMLElement,
  events: readonly CalendarEvent[],
  context: Parameters<typeof renderCalendarWorkspace>[0]
): void {
  const grid = parent.createDiv({ cls: 'pm-calendar-grid' });
  const days = new Map<string, CalendarEvent[]>();
  for (const event of events) days.set(event.date, [...(days.get(event.date) ?? []), event]);
  for (const [date, items] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const day = grid.createEl('section', { cls: 'pm-panel' });
    day.createEl('h3', { text: date });
    for (const event of items) renderEvent(day, event, context);
  }
}
function renderAgenda(
  parent: HTMLElement,
  events: readonly CalendarEvent[],
  context: Parameters<typeof renderCalendarWorkspace>[0],
  grouped: boolean
): void {
  const list = parent.createEl('ol', { cls: 'pm-calendar-agenda' });
  for (const event of events) {
    const row = list.createEl('li');
    const book = context.snapshot.books.find(({ id }) => id === event.bookId);
    renderEvent(row, event, context, grouped ? `${text(book?.fields.title, event.bookId)} · ` : '');
  }
}
function renderEvent(
  parent: HTMLElement,
  event: CalendarEvent,
  context: Parameters<typeof renderCalendarWorkspace>[0],
  prefix = ''
): void {
  const open = parent.createEl('button', {
    cls: 'pm-text-button',
    text: `${prefix}${event.date} · ${event.kind} · ${event.title}`,
    attr: { type: 'button' }
  });
  open.addEventListener('click', () => context.openRecord(event.record));
  if (event.movable) {
    const move = parent.createEl('button', {
      cls: 'pm-button pm-button--quiet',
      text: event.pinned ? 'Pinned date' : 'Move date',
      attr: { type: 'button' }
    });
    move.disabled = event.pinned;
    move.addEventListener('click', () => {
      context.state.moveEventId = event.id;
      context.state.proposedDate = event.date;
      delete context.state.movePreview;
      context.rerender();
    });
  }
}
function renderMovePreview(
  parent: HTMLElement,
  context: Parameters<typeof renderCalendarWorkspace>[0]
): void {
  if (!context.state.moveEventId) return;
  const panel = parent.createEl('section', { cls: 'pm-inline-alert' });
  panel.createEl('h3', { text: 'Preview task date movement' });
  const date = panel.createEl('input', {
    value: context.state.proposedDate,
    attr: { type: 'date', 'aria-label': 'Proposed task date' }
  });
  date.addEventListener('change', () => {
    context.state.proposedDate = date.value;
    delete context.state.movePreview;
  });
  const preview = panel.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Preview dependency impacts',
    attr: { type: 'button' }
  });
  preview.addEventListener('click', () => {
    try {
      context.state.movePreview = context.calendar.previewMove(
        context.state.moveEventId,
        context.state.proposedDate
      );
      context.state.acceptConflicts = false;
      context.rerender();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : 'Date preview failed.');
    }
  });
  const model = context.state.movePreview;
  if (model === undefined) return;
  panel.createEl('p', {
    text: `${model.event.date} → ${model.proposedDate} · ${model.impacts.length} dependent tasks`
  });
  const list = panel.createEl('ul');
  for (const impact of model.impacts)
    list.createEl('li', {
      text: `${impact.conflict ? 'Conflict' : 'Review'} · ${impact.title} · ${impact.explanation}`
    });
  const hasConflicts = model.impacts.some(({ conflict }) => conflict);
  if (hasConflicts) {
    const label = panel.createEl('label');
    const accept = label.createEl('input', { attr: { type: 'checkbox' } });
    accept.checked = context.state.acceptConflicts;
    label.appendText(' I reviewed the dependency conflicts and will move only this task.');
    accept.addEventListener('change', () => {
      context.state.acceptConflicts = accept.checked;
      context.rerender();
    });
  }
  const apply = panel.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Apply reviewed task date',
    attr: { type: 'button' }
  });
  apply.disabled =
    model.blockedReason !== undefined || (hasConflicts && !context.state.acceptConflicts);
  apply.addEventListener(
    'click',
    () =>
      void context.calendar
        .applyMove(model, context.state.acceptConflicts)
        .then(() => {
          context.state.moveEventId = '';
          delete context.state.movePreview;
          context.rerender();
        })
        .catch(
          (cause: unknown) =>
            new Notice(cause instanceof Error ? cause.message : 'Task date could not be moved.')
        )
  );
}
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
