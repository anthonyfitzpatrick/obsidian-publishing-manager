/**
 * Renders the native Publishing Manager portfolio dashboard from immutable catalog snapshots.
 * The view distinguishes every UI-006 state, keeps valid books usable beside damaged records,
 * provides accessible non-color status labels, and delegates all creation, refresh, navigation,
 * and note-opening actions rather than importing persistence implementations.
 */

import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from 'obsidian';

import type { BookCatalog } from '../../application/catalog/book-catalog';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';
import { buildDashboardViewModel } from '../view-models/dashboard-view-model';

/** Stable Obsidian view identifier persisted in workspace layout state. */
export const PUBLISHING_DASHBOARD_VIEW_TYPE = 'publishing-manager-dashboard';

/** Native portfolio dashboard used as the top-level Publishing Manager entry point. */
export class PublishingDashboardView extends ItemView {
  private unsubscribe: (() => void) | undefined;
  private snapshot?: BookCatalogSnapshot;

  /** Receives application state and narrow user-intent callbacks. */
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly createBook: () => void,
    private readonly openBook: (record: CatalogRecord) => Promise<void>,
    private readonly refreshCatalog: () => Promise<void>
  ) {
    super(leaf);
    this.icon = 'library';
    this.navigation = true;
  }

  /** Identifies this view to Obsidian workspace persistence. */
  public getViewType(): string {
    return PUBLISHING_DASHBOARD_VIEW_TYPE;
  }

  /** Supplies a concise tab label. */
  public getDisplayText(): string {
    return 'Publishing manager';
  }

  /** Subscribes only while open; every update replaces the rendered immutable snapshot. */
  protected override async onOpen(): Promise<void> {
    this.unsubscribe = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render(snapshot);
    });
  }

  /** Releases catalog subscription and generated DOM when the leaf closes. */
  protected override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  /** Builds dashboard regions with semantic headings, lists, tables, and live status text. */
  private render(snapshot: BookCatalogSnapshot): void {
    const model = buildDashboardViewModel(snapshot);
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-dashboard');

    const header = root.createDiv({ cls: 'pm-page-header' });
    const headingGroup = header.createDiv({ cls: 'pm-page-header__titles' });
    headingGroup.createEl('p', { cls: 'pm-eyebrow', text: 'Publishing operations' });
    headingGroup.createEl('h1', { text: 'Publishing manager' });
    headingGroup.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Local, inspectable book projects in this vault.'
    });
    const actions = header.createDiv({ cls: 'pm-action-row' });
    const refresh = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Refresh catalog',
      attr: { type: 'button', 'aria-label': 'Refresh publishing catalog' }
    });
    const refreshIcon = refresh.createSpan({ cls: 'pm-button__icon' });
    setIcon(refreshIcon, 'refresh-cw');
    refresh.addEventListener('click', () => {
      refresh.setAttr('disabled', 'true');
      void this.refreshCatalog()
        .catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : 'Catalog refresh failed.');
        })
        .finally(() => refresh.removeAttribute('disabled'));
    });
    const create = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'New book project',
      attr: { type: 'button' }
    });
    const createIcon = create.createSpan({ cls: 'pm-button__icon' });
    setIcon(createIcon, 'plus');
    create.addEventListener('click', this.createBook);

    renderStateBanner(root, model.kind, model.heading, model.explanation);
    renderSummaryCards(root, model.activeBooks, model.archivedBooks, model.issueCount);

    if (model.kind === 'empty') {
      const empty = root.createDiv({ cls: 'pm-empty-state' });
      const icon = empty.createDiv({ cls: 'pm-empty-state__icon' });
      setIcon(icon, 'book-open');
      empty.createEl('h2', { text: 'No book projects yet' });
      empty.createEl('p', {
        text: 'Create the first stable book record to begin publishing work.'
      });
      const emptyAction = empty.createEl('button', {
        cls: 'pm-button pm-button--primary',
        text: 'Create first book',
        attr: { type: 'button' }
      });
      emptyAction.addEventListener('click', this.createBook);
      return;
    }

    const layout = root.createDiv({ cls: 'pm-dashboard-grid' });
    const primary = layout.createEl('main', { cls: 'pm-dashboard-main' });
    renderPortfolio(primary, model.books, (record) => void this.openBook(record));
    const aside = layout.createEl('aside', {
      cls: 'pm-dashboard-aside',
      attr: { 'aria-label': 'Catalog attention and recent activity' }
    });
    renderDiagnostics(
      aside,
      model.diagnostics,
      (diagnostic) => void this.openDiagnostic(diagnostic)
    );
    renderActivity(aside, snapshot);
  }

  /** Opens the canonical Markdown note named by one diagnostic when it still exists. */
  private async openDiagnostic(diagnostic: CatalogDiagnostic): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(diagnostic.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    } else {
      new Notice(`Managed note is no longer available: ${diagnostic.path}`);
    }
  }
}

/** Announces lifecycle state with icon plus text so color never carries meaning alone. */
function renderStateBanner(
  root: HTMLElement,
  kind: ReturnType<typeof buildDashboardViewModel>['kind'],
  heading: string,
  explanation: string
): void {
  const banner = root.createDiv({
    cls: `pm-state-banner pm-state-banner--${kind}`,
    attr: {
      role: kind === 'error' || kind === 'unavailable' ? 'alert' : 'status',
      'aria-live': 'polite'
    }
  });
  const icon = banner.createDiv({ cls: 'pm-state-banner__icon' });
  setIcon(icon, stateIcon(kind));
  const text = banner.createDiv();
  text.createEl('strong', { text: heading });
  text.createEl('p', { text: explanation });
}

/** Selects a familiar Obsidian icon while retaining the adjacent explicit status text. */
function stateIcon(
  kind: ReturnType<typeof buildDashboardViewModel>['kind']
):
  | 'alert-triangle'
  | 'check-circle-2'
  | 'circle-ellipsis'
  | 'info'
  | 'loader-circle'
  | 'refresh-cw' {
  if (kind === 'loading') return 'loader-circle';
  if (kind === 'rebuilding') return 'refresh-cw';
  if (kind === 'error' || kind === 'unavailable') return 'alert-triangle';
  if (kind === 'partial') return 'info';
  if (kind === 'ready') return 'check-circle-2';
  return 'circle-ellipsis';
}

/** Renders the three M1 counts as compact labelled cards. */
function renderSummaryCards(
  root: HTMLElement,
  active: number,
  archived: number,
  issues: number
): void {
  const section = root.createEl('section', {
    cls: 'pm-summary-grid',
    attr: { 'aria-label': 'Catalog summary' }
  });
  for (const card of [
    { label: 'Active books', value: active, detail: 'Available for publishing work' },
    { label: 'Archived books', value: archived, detail: 'Retained without destructive deletion' },
    {
      label: 'Catalog issues',
      value: issues,
      detail: issues === 0 ? 'No repair required' : 'Review repair guidance'
    }
  ]) {
    const element = section.createDiv({ cls: 'pm-summary-card' });
    element.createSpan({ cls: 'pm-summary-card__label', text: card.label });
    element.createEl('strong', { cls: 'pm-summary-card__value', text: String(card.value) });
    element.createSpan({ cls: 'pm-summary-card__detail', text: card.detail });
  }
}

/** Renders book cards that remain readable and keyboard-activatable at every width. */
function renderPortfolio(
  parent: HTMLElement,
  books: readonly CatalogRecord[],
  openBook: (record: CatalogRecord) => void
): void {
  const section = parent.createEl('section', { cls: 'pm-panel pm-portfolio' });
  const heading = section.createDiv({ cls: 'pm-section-heading' });
  heading.createDiv().createEl('h2', { text: 'Book portfolio' });
  heading.createSpan({ cls: 'pm-count-badge', text: `${books.length} books` });
  const list = section.createDiv({ cls: 'pm-book-list', attr: { role: 'list' } });
  for (const record of books) {
    const card = list.createEl('article', { cls: 'pm-book-card', attr: { role: 'listitem' } });
    const body = card.createDiv({ cls: 'pm-book-card__body' });
    body.createSpan({
      cls: `pm-status-chip pm-status-chip--${record.archived ? 'archived' : String(record.fields.status)}`,
      text: `${record.archived ? '◇ Archived' : `● ${String(record.fields.status)}`}`
    });
    body.createEl('h3', { text: String(record.fields.title) });
    body.createEl('p', {
      text: `${String(record.fields['primary-language'])} · ${record.id}`
    });
    const open = card.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Open workspace',
      attr: { type: 'button', 'aria-label': `Open workspace for ${String(record.fields.title)}` }
    });
    open.addEventListener('click', () => openBook(record));
  }
}

/** Renders repair guidance with direct canonical-note navigation. */
function renderDiagnostics(
  parent: HTMLElement,
  diagnostics: readonly CatalogDiagnostic[],
  openDiagnostic: (diagnostic: CatalogDiagnostic) => void
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Attention' });
  if (diagnostics.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No catalog diagnostics; status clear.' });
    return;
  }
  const list = section.createEl('ul', { cls: 'pm-diagnostic-list' });
  for (const diagnostic of diagnostics.slice(0, 8)) {
    const item = list.createEl('li');
    item.createEl('strong', { text: `⚠ ${diagnostic.message}` });
    item.createEl('p', { text: diagnostic.suggestedAction });
    const open = item.createEl('button', {
      cls: 'pm-text-button',
      text: 'Open managed note',
      attr: { type: 'button' }
    });
    open.addEventListener('click', () => openDiagnostic(diagnostic));
  }
}

/** Renders bounded local activity and clearly labels its session-only scope. */
function renderActivity(parent: HTMLElement, snapshot: BookCatalogSnapshot): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Recent activity' });
  section.createEl('p', {
    cls: 'pm-muted',
    text: 'This session only; canonical history arrives later.'
  });
  if (snapshot.recentActivity.length === 0) {
    section.createEl('p', { text: 'No activity in this session.' });
    return;
  }
  const list = section.createEl('ol', { cls: 'pm-activity-list' });
  for (const activity of snapshot.recentActivity.slice(0, 6)) {
    list.createEl('li', {
      text: `${activity.action}: ${activity.title ?? activity.entityId ?? activity.path}`
    });
  }
}
