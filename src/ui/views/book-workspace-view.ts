/**
 * Renders the M1 Book Workspace around one valid catalog record. The persistent header supplies
 * identity, series, status, publication/readiness placeholders, edition context, and lifecycle
 * commands. Overview editing uses the shared draft store; navigation never discards input, while
 * explicit discard requires confirmation. Responsive desktop/mobile navigation and keyboard tabs
 * expose the same implemented content without hover or color-only meaning.
 */

import {
  ItemView,
  Notice,
  TFile,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import { BOOK_STATUSES, type BookStatus } from '../../domain/books/book-project';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import { ConfirmDiscardModal } from '../dialogs/confirm-discard-modal';
import type { BookDraftStore, BookOverviewDraft } from '../state/book-draft-store';
import {
  ENABLED_WORKSPACE_TABS,
  isWorkspaceTab,
  nextWorkspaceTab,
  type WorkspaceTab
} from '../view-models/workspace-navigation';

/** Stable Obsidian view identifier persisted with the selected book and active tab. */
export const BOOK_WORKSPACE_VIEW_TYPE = 'publishing-manager-book-workspace';

const FUTURE_TABS = [
  'Workflow',
  'Editions',
  'Metadata',
  'ISBNs',
  'Pricing',
  'Distribution',
  'Sales',
  'Assets',
  'Launch',
  'Reviews',
  'Notes',
  'History'
] as const;

/** Native book workspace with per-book draft continuity and immutable catalog subscriptions. */
export class BookWorkspaceView extends ItemView {
  private unsubscribe: (() => void) | undefined;
  private snapshot?: BookCatalogSnapshot;
  private selectedPath: VaultPath | undefined;
  private activeTab: WorkspaceTab = 'overview';
  private operationError: string | undefined;

  /** Receives state/services and dashboard navigation without importing persistence adapters. */
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly books: BookProjectService,
    private readonly drafts: BookDraftStore,
    private readonly openDashboard: () => Promise<void>
  ) {
    super(leaf);
    this.icon = 'book-open';
    this.navigation = true;
  }

  /** Identifies this view to Obsidian workspace persistence. */
  public getViewType(): string {
    return BOOK_WORKSPACE_VIEW_TYPE;
  }

  /** Uses the selected title when available while keeping a stable fallback tab label. */
  public getDisplayText(): string {
    const book = this.snapshot?.books.find(({ path }) => path === this.selectedPath);
    return typeof book?.fields.title === 'string' ? book.fields.title : 'Book Workspace';
  }

  /** Persists navigation state without serializing private draft content into workspace layout. */
  public override getState(): Record<string, unknown> {
    return {
      ...(this.selectedPath === undefined ? {} : { bookPath: this.selectedPath }),
      tab: this.activeTab
    };
  }

  /** Restores only validated path/tab state and lets the subscription resolve current data. */
  public override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (isRecord(state)) {
      const bookPath = state.bookPath;
      if (typeof bookPath === 'string') {
        try {
          this.selectedPath = normalizeVaultPath(bookPath);
        } catch {
          this.selectedPath = undefined;
        }
      }
      if (isWorkspaceTab(state.tab)) this.activeTab = state.tab;
    }
    result.history = true;
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Subscribes while open and selects the first active book only when state has no valid choice. */
  protected override async onOpen(): Promise<void> {
    this.unsubscribe = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.reconcileSelection(snapshot);
      this.render(snapshot);
    });
  }

  /** Preserves drafts in the shared store while releasing only this view's subscription and DOM. */
  protected override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  /** Keeps selection valid after external delete/repair and never transfers a draft to another book. */
  private reconcileSelection(snapshot: BookCatalogSnapshot): void {
    if (
      this.selectedPath !== undefined &&
      snapshot.books.some(({ path }) => path === this.selectedPath)
    ) {
      return;
    }
    if (this.selectedPath !== undefined) this.drafts.forget(this.selectedPath);
    this.selectedPath =
      snapshot.books.find(({ archived }) => !archived)?.path ?? snapshot.books[0]?.path;
  }

  /** Renders explicit availability/empty state or the complete M1 workspace. */
  private render(snapshot: BookCatalogSnapshot): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-workspace');
    if (snapshot.availability.state !== 'ready') {
      renderWorkspaceState(
        root,
        snapshot.availability.state,
        'message' in snapshot.availability ? snapshot.availability.message : undefined
      );
    }
    const record = snapshot.books.find(({ path }) => path === this.selectedPath);
    if (record === undefined) {
      renderNoBook(root, snapshot, () => void this.openDashboard());
      return;
    }

    this.renderHeader(root, record);
    this.renderNavigation(root);
    if (this.operationError !== undefined) {
      root.createDiv({
        cls: 'pm-inline-alert',
        text: this.operationError,
        attr: { role: 'alert' }
      });
    }
    const content = root.createDiv({ cls: 'pm-workspace-content' });
    if (this.activeTab === 'overview') {
      this.renderOverview(content, record, snapshot);
    } else {
      this.renderDiagnostics(content, record, snapshot);
    }
  }

  /** Builds the persistent header required by UI-002 with honest unavailable placeholders. */
  private renderHeader(root: HTMLElement, record: CatalogRecord): void {
    const header = root.createEl('header', { cls: 'pm-workspace-header' });
    const breadcrumb = header.createDiv({ cls: 'pm-breadcrumb' });
    const dashboard = breadcrumb.createEl('button', {
      cls: 'pm-text-button',
      text: 'Dashboard',
      attr: { type: 'button', 'aria-label': 'Return to publishing dashboard' }
    });
    dashboard.addEventListener('click', () => void this.openDashboard());
    breadcrumb.createSpan({ text: '›' });
    breadcrumb.createSpan({ text: String(record.fields.title) });

    const identity = header.createDiv({ cls: 'pm-workspace-header__identity' });
    const titles = identity.createDiv();
    titles.createEl('p', { cls: 'pm-eyebrow', text: this.seriesLabel(record) });
    titles.createEl('h1', { text: String(record.fields.title) });
    titles.createSpan({
      cls: `pm-status-chip pm-status-chip--${record.archived ? 'archived' : String(record.fields.status)}`,
      text: record.archived ? '◇ Archived book' : `● ${String(record.fields.status)} book`
    });

    const commands = identity.createDiv({ cls: 'pm-action-row' });
    const openNote = commands.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Open Markdown',
      attr: { type: 'button' }
    });
    openNote.addEventListener('click', () => void this.openCanonicalNote(record.path));
    const lifecycle = commands.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: record.archived ? 'Restore book' : 'Archive book',
      attr: { type: 'button' }
    });
    lifecycle.addEventListener('click', () => void this.changeArchiveState(record));

    const context = header.createDiv({ cls: 'pm-context-grid' });
    renderContextItem(
      context,
      'Publication anchor',
      '— Not set',
      'Available after an edition exists.'
    );
    renderContextItem(context, 'Readiness', '○ Not calculated', 'Readiness scoring begins in M5.');
    const edition = context.createDiv({ cls: 'pm-context-item' });
    edition.createSpan({ text: 'Edition' });
    const selector = edition.createEl('select', {
      attr: {
        disabled: 'true',
        'aria-label': 'Edition selector unavailable until the next milestone'
      }
    });
    selector.createEl('option', { text: 'No editions yet' });
    edition.createEl('small', { text: 'Edition management begins in the next milestone.' });
  }

  /** Renders desktop tabs and an equivalent mobile picker over the same active state. */
  private renderNavigation(root: HTMLElement): void {
    const nav = root.createEl('nav', {
      cls: 'pm-workspace-tabs',
      attr: { 'aria-label': 'Book workspace sections' }
    });
    const tablist = nav.createDiv({
      attr: { role: 'tablist', 'aria-label': 'Book workspace tabs' }
    });
    for (const tab of ENABLED_WORKSPACE_TABS) {
      const button = tablist.createEl('button', {
        cls: `pm-tab${this.activeTab === tab ? ' is-active' : ''}`,
        text: capitalize(tab),
        attr: {
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.activeTab === tab),
          tabindex: this.activeTab === tab ? '0' : '-1'
        }
      });
      button.addEventListener('click', () => this.selectTab(tab));
      button.addEventListener('keydown', (event) => this.handleTabKey(event, tab, tablist));
    }
    for (const tab of FUTURE_TABS) {
      tablist.createEl('button', {
        cls: 'pm-tab',
        text: tab,
        attr: {
          type: 'button',
          role: 'tab',
          disabled: 'true',
          'aria-disabled': 'true',
          title: 'Planned for a later milestone'
        }
      });
    }

    const mobile = nav.createEl('label', { cls: 'pm-mobile-tab-picker' });
    mobile.createSpan({ text: 'Workspace section' });
    const select = mobile.createEl('select', { attr: { 'aria-label': 'Workspace section' } });
    for (const tab of ENABLED_WORKSPACE_TABS) {
      select.createEl('option', {
        text: capitalize(tab),
        value: tab,
        attr: this.activeTab === tab ? { selected: 'true' } : {}
      });
    }
    select.addEventListener('change', () => {
      if (isWorkspaceTab(select.value)) this.selectTab(select.value);
    });
  }

  /** Renders editable identity/summary plus next step, activity, and diagnostics in a split layout. */
  private renderOverview(
    parent: HTMLElement,
    record: CatalogRecord,
    snapshot: BookCatalogSnapshot
  ): void {
    const draft = this.drafts.ensure(record);
    const grid = parent.createDiv({ cls: 'pm-overview-grid' });
    const primary = grid.createDiv({ cls: 'pm-overview-primary' });
    const form = primary.createEl('section', { cls: 'pm-panel' });
    const heading = form.createDiv({ cls: 'pm-section-heading' });
    heading.createDiv().createEl('h2', { text: 'Book overview' });
    const dirty = heading.createSpan({
      cls: 'pm-dirty-indicator',
      text: draft.dirty ? '● Unsaved draft' : '✓ Saved',
      attr: { 'aria-live': 'polite' }
    });

    const fields = form.createDiv({ cls: 'pm-form-grid' });
    const title = createInputField(fields, 'Title', 'text', draft.title);
    const language = createInputField(fields, 'Primary language', 'text', draft.primaryLanguage);
    const statusLabel = fields.createEl('label', { cls: 'pm-field' });
    statusLabel.createSpan({ text: 'Status' });
    const status = statusLabel.createEl('select');
    for (const value of BOOK_STATUSES) {
      status.createEl('option', {
        text: capitalize(value),
        value,
        attr: draft.status === value ? { selected: 'true' } : {}
      });
    }
    const summaryLabel = fields.createEl('label', { cls: 'pm-field pm-field--wide' });
    summaryLabel.createSpan({ text: 'Summary' });
    const summary = summaryLabel.createEl('textarea', {
      text: draft.summary,
      attr: { rows: '6', maxlength: '4000' }
    });
    const validation = form.createDiv({
      cls: 'pm-validation-summary',
      attr: { 'aria-live': 'polite' }
    });
    const actions = form.createDiv({ cls: 'pm-action-row' });
    const save = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Save changes',
      attr: { type: 'button' }
    });
    const discard = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Discard draft',
      attr: { type: 'button' }
    });

    const update = (patch: Parameters<BookDraftStore['update']>[1]) => {
      const next = this.drafts.update(record.path, patch);
      dirty.setText(next.dirty ? '● Unsaved draft' : '✓ Saved');
      renderDraftValidation(validation, next);
      save.toggleAttribute('disabled', !next.dirty || next.diagnostics.length > 0);
      discard.toggleAttribute('disabled', !next.dirty);
    };
    title.addEventListener('input', () => update({ title: title.value }));
    language.addEventListener('input', () => update({ primaryLanguage: language.value }));
    status.addEventListener('change', () => update({ status: status.value as BookStatus }));
    summary.addEventListener('input', () => update({ summary: summary.value }));
    renderDraftValidation(validation, draft);
    save.toggleAttribute('disabled', !draft.dirty || draft.diagnostics.length > 0);
    discard.toggleAttribute('disabled', !draft.dirty);
    save.addEventListener('click', () => void this.saveDraft(record, save));
    discard.addEventListener('click', () => {
      new ConfirmDiscardModal(this.app, () => {
        this.drafts.discard(record.path);
        this.render(snapshot);
      }).open();
    });

    const aside = grid.createDiv({ cls: 'pm-overview-aside' });
    const next = aside.createEl('section', { cls: 'pm-panel pm-next-action' });
    next.createEl('p', { cls: 'pm-eyebrow', text: 'Next publishing step' });
    next.createEl('h2', { text: snapshot.nextMilestone.title });
    next.createEl('p', { text: snapshot.nextMilestone.explanation });
    renderBookDiagnostics(aside, record, snapshot.diagnostics);
    renderBookActivity(aside, record, snapshot);
  }

  /** Renders the read-mostly Diagnostics tab with path, field, explanation, and repair action. */
  private renderDiagnostics(
    parent: HTMLElement,
    record: CatalogRecord,
    snapshot: BookCatalogSnapshot
  ): void {
    const section = parent.createEl('section', { cls: 'pm-panel pm-diagnostics-page' });
    section.createEl('p', { cls: 'pm-eyebrow', text: 'Read-only guidance' });
    section.createEl('h2', { text: 'Book diagnostics' });
    section.createEl('p', {
      text: 'The plugin does not silently rewrite damaged data. Open the named Markdown note and follow the suggested repair.'
    });
    const diagnostics = diagnosticsFor(record, snapshot.diagnostics);
    if (diagnostics.length === 0) {
      section.createDiv({ cls: 'pm-success-state', text: '✓ No diagnostics for this book.' });
      return;
    }
    const list = section.createEl('ul', { cls: 'pm-diagnostic-list pm-diagnostic-list--full' });
    for (const diagnostic of diagnostics) {
      const item = list.createEl('li');
      item.createEl('strong', { text: `⚠ ${diagnostic.message}` });
      item.createEl('p', {
        text: `Field: ${diagnostic.field ?? 'record'} · Path: ${diagnostic.path}`
      });
      item.createEl('p', { text: diagnostic.suggestedAction });
      const open = item.createEl('button', {
        cls: 'pm-button pm-button--secondary',
        text: 'Open Markdown note',
        attr: { type: 'button' }
      });
      open.addEventListener('click', () => void this.openCanonicalNote(diagnostic.path));
    }
  }

  /** Persists the current valid draft and refreshes its baseline from the accepted catalog record. */
  private async saveDraft(record: CatalogRecord, button: HTMLButtonElement): Promise<void> {
    button.setAttr('disabled', 'true');
    this.operationError = undefined;
    try {
      const result = await this.books.edit(record.path, this.drafts.toEditInput(record.path));
      const accepted = this.catalog.recordById(result.book.id);
      if (accepted !== undefined) this.drafts.markSaved(accepted);
      new Notice('Book overview saved.');
    } catch (error) {
      this.operationError =
        error instanceof Error ? error.message : 'Book overview could not be saved.';
    }
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Archives/restores through application services and retains any unrelated overview draft. */
  private async changeArchiveState(record: CatalogRecord): Promise<void> {
    this.operationError = undefined;
    try {
      if (record.archived) await this.books.restore(record.path);
      else await this.books.archive(record.path);
    } catch (error) {
      this.operationError =
        error instanceof Error ? error.message : 'Book lifecycle change failed.';
      if (this.snapshot !== undefined) this.render(this.snapshot);
    }
  }

  /** Opens canonical Markdown using Obsidian workspace APIs only. */
  private async openCanonicalNote(path: VaultPath): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Managed note is no longer available: ${path}`);
  }

  /** Resolves the human series label without making the title a relationship key. */
  private seriesLabel(record: CatalogRecord): string {
    const seriesId = record.fields['series-id'];
    if (typeof seriesId !== 'string') return 'Standalone book';
    const series = this.catalog.recordById(seriesId);
    if (typeof series?.fields.name !== 'string') return 'Series link requires repair';
    const position = record.fields['series-position'];
    return `${series.fields.name} · Book ${typeof position === 'number' ? String(position) : '—'}`;
  }

  /** Changes tabs without touching the shared draft store. */
  private selectTab(tab: WorkspaceTab): void {
    this.activeTab = tab;
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Implements wrapping arrow/home/end tab navigation and moves focus to the selected tab. */
  private handleTabKey(event: KeyboardEvent, tab: WorkspaceTab, tablist: HTMLElement): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = nextWorkspaceTab(tab, event.key as 'ArrowLeft' | 'ArrowRight' | 'End' | 'Home');
    this.selectTab(next);
    const target = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent?.toLowerCase() === next
    );
    window.setTimeout(() => target?.focus(), 0);
  }
}

/** Renders catalog lifecycle above retained partial content. */
function renderWorkspaceState(
  root: HTMLElement,
  state: Exclude<BookCatalogSnapshot['availability']['state'], 'ready'>,
  message?: string
): void {
  const panel = root.createDiv({
    cls: `pm-state-banner pm-state-banner--${state}`,
    attr: { role: state === 'error' || state === 'unavailable' ? 'alert' : 'status' }
  });
  panel.createEl('strong', { text: capitalize(state) });
  panel.createSpan({ text: message ?? 'Catalog state is changing.' });
}

/** Renders empty/unavailable workspace state with a route back to portfolio context. */
function renderNoBook(
  root: HTMLElement,
  snapshot: BookCatalogSnapshot,
  openDashboard: () => void
): void {
  const empty = root.createDiv({ cls: 'pm-empty-state' });
  const icon = empty.createDiv({ cls: 'pm-empty-state__icon' });
  setIcon(icon, snapshot.diagnostics.length > 0 ? 'stethoscope' : 'book-open');
  empty.createEl('h1', {
    text: snapshot.diagnostics.length > 0 ? 'No valid book available' : 'Choose or create a book'
  });
  empty.createEl('p', {
    text:
      snapshot.diagnostics.length > 0
        ? 'Return to the dashboard for catalog repair guidance.'
        : 'The Book Workspace opens after a valid book project exists.'
  });
  const button = empty.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Open dashboard',
    attr: { type: 'button' }
  });
  button.addEventListener('click', openDashboard);
}

/** Builds one header context cell with explicit availability detail. */
function renderContextItem(
  parent: HTMLElement,
  label: string,
  value: string,
  detail: string
): void {
  const item = parent.createDiv({ cls: 'pm-context-item' });
  item.createSpan({ text: label });
  item.createEl('strong', { text: value });
  item.createEl('small', { text: detail });
}

/** Creates one labelled text input and returns the native control for draft events. */
function createInputField(
  parent: HTMLElement,
  label: string,
  type: 'text',
  value: string
): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('input', { type, value });
}

/** Replaces inline validation without rerendering controls or disturbing keyboard focus. */
function renderDraftValidation(parent: HTMLElement, draft: BookOverviewDraft): void {
  parent.empty();
  if (draft.diagnostics.length === 0) {
    parent.createSpan({ text: draft.dirty ? 'Ready to save.' : 'No unsaved changes.' });
    return;
  }
  parent.createEl('strong', { text: 'Fix these fields before saving:' });
  const list = parent.createEl('ul');
  for (const diagnostic of draft.diagnostics) list.createEl('li', { text: diagnostic.message });
}

/** Renders book-scoped diagnostic summary on Overview. */
function renderBookDiagnostics(
  parent: HTMLElement,
  record: CatalogRecord,
  allDiagnostics: readonly CatalogDiagnostic[]
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Diagnostics' });
  const diagnostics = diagnosticsFor(record, allDiagnostics);
  section.createEl('p', {
    text:
      diagnostics.length === 0
        ? '✓ No diagnostics for this book.'
        : `⚠ ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'} require attention.`
  });
}

/** Renders recent activity belonging to the selected stable identity. */
function renderBookActivity(
  parent: HTMLElement,
  record: CatalogRecord,
  snapshot: BookCatalogSnapshot
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Recent activity' });
  const activities = snapshot.recentActivity.filter(({ entityId }) => entityId === record.id);
  if (activities.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No activity for this book in this session.' });
    return;
  }
  const list = section.createEl('ol', { cls: 'pm-activity-list' });
  for (const activity of activities.slice(0, 6)) {
    list.createEl('li', { text: `${activity.action} · ${activity.occurredAt}` });
  }
}

/** Includes path-level and stable-identity diagnostics for the selected book. */
function diagnosticsFor(
  record: CatalogRecord,
  diagnostics: readonly CatalogDiagnostic[]
): readonly CatalogDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.path === record.path || diagnostic.entityId === record.id
  );
}

/** Uppercases only the first character for human labels. */
function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1);
}

/** Narrows restored Obsidian state to a safe object before reading properties. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
