/**
 * Renders the native Publishing Manager portfolio dashboard from immutable catalog snapshots.
 * The view distinguishes every UI-006 state, keeps valid books usable beside damaged records,
 * provides accessible non-color status labels, and delegates all creation, refresh, navigation,
 * and note-opening actions rather than importing persistence implementations.
 */

import { ItemView, Menu, Notice, TFile, setIcon, type WorkspaceLeaf } from 'obsidian';

import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { ReadinessProjectService } from '../../application/readiness/readiness-project-service';
import type { SalesProjectService } from '../../application/sales/sales-project-service';
import type { CalendarProjectService } from '../../application/calendar/calendar-project-service';
import {
  DEFAULT_DASHBOARD_COLUMNS,
  EMPTY_DASHBOARD_FILTERS,
  type DashboardFilterState,
  type DashboardPreferencesService,
  type DashboardSavedView
} from '../../application/dashboard/dashboard-preferences-service';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';
import { buildDashboardViewModel } from '../view-models/dashboard-view-model';
import {
  buildOperationalDashboardModel,
  type DashboardAttentionItem,
  type OperationalDashboardModel
} from '../view-models/operational-dashboard-view-model';
import type { ReadinessEvaluation } from '../../domain/readiness/readiness-engine';
import { createSalesWorkspaceState, renderSalesWorkspace } from './sales-workspace';
import { createCalendarWorkspaceState, renderCalendarWorkspace } from './calendar-workspace';

/** Stable Obsidian view identifier persisted in workspace layout state. */
export const PUBLISHING_DASHBOARD_VIEW_TYPE = 'publishing-manager-dashboard';

/**
 * Narrow routes to plugin-owned top-level tools. Keeping navigation as callbacks prevents the
 * Dashboard from importing other views or reaching into Obsidian's private command registry.
 */
export interface PublishingDashboardTools {
  readonly openGlobalDataLibrary: () => Promise<void>;
  readonly openTemplates: () => Promise<void>;
  readonly openExports: () => Promise<void>;
  readonly openDiagnostics: () => Promise<void>;
}

/** Native portfolio dashboard used as the top-level Publishing Manager entry point. */
export class PublishingDashboardView extends ItemView {
  private unsubscribe: (() => void) | undefined;
  private snapshot?: BookCatalogSnapshot;
  private readonly evaluations = new Map<string, ReadinessEvaluation>();
  private filters: DashboardFilterState = { ...EMPTY_DASHBOARD_FILTERS };
  private columns: readonly string[] = [...DEFAULT_DASHBOARD_COLUMNS];
  private savedViews: readonly DashboardSavedView[] = [];
  private portfolioPage = 0;
  private readonly salesState = createSalesWorkspaceState();
  private readonly calendarState = createCalendarWorkspaceState(
    new Date().toISOString().slice(0, 10)
  );

  /** Receives application state and narrow user-intent callbacks. */
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly readiness: ReadinessProjectService,
    private readonly preferences: DashboardPreferencesService,
    private readonly sales: SalesProjectService,
    private readonly calendar: CalendarProjectService,
    private readonly createBook: () => void,
    private readonly createSeries: () => void,
    private readonly openSeries: (record: CatalogRecord) => void,
    private readonly openBook: (record: CatalogRecord, tab?: string) => Promise<void>,
    private readonly refreshCatalog: () => Promise<void>,
    private readonly tools: PublishingDashboardTools
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
    this.savedViews = await this.preferences.savedViews();
    this.unsubscribe = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render(snapshot);
      void this.refreshReadiness(snapshot);
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
    const operations = buildOperationalDashboardModel(
      snapshot,
      this.evaluations,
      this.filters,
      new Date().toISOString().slice(0, 10)
    );
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-dashboard');

    const header = root.createDiv({ cls: 'pm-page-header' });
    const headingGroup = header.createDiv({ cls: 'pm-page-header__titles' });
    headingGroup.createEl('p', { cls: 'pm-eyebrow', text: 'Publishing operations' });
    headingGroup.createEl('h1', { text: 'Publishing manager' });
    headingGroup.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Local, inspectable publishing projects in this vault.'
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
    const globalData = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Global data library',
      attr: { type: 'button' }
    });
    const globalDataIcon = globalData.createSpan({ cls: 'pm-button__icon' });
    setIcon(globalDataIcon, 'database');
    globalData.prepend(globalDataIcon);
    globalData.addEventListener('click', () =>
      runDashboardTool(this.tools.openGlobalDataLibrary, 'Global data library could not open.')
    );
    const create = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'New',
      attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Create new publishing record' }
    });
    const createIcon = create.createSpan({ cls: 'pm-button__icon' });
    setIcon(createIcon, 'chevron-down');
    create.addEventListener('click', (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle('New Project')
          .setIcon('book-open')
          // Reuse the established Project modal so the dropdown cannot diverge from its workflow.
          .onClick(this.createBook)
      );
      menu.addItem((item) => item.setTitle('New Series').setIcon('list-ordered').onClick(this.createSeries));
      menu.showAtMouseEvent(event);
    });

    // The Dashboard remains the single visible entry point, but direct workspace routes keep
    // routine Publishing Manager functions available without requiring the command palette.
    // Manuscript Compiler is deliberately absent because ADR-045 retired that dependency.
    renderPublishingWorkspaces(root, model.kind === 'empty', this.createBook, this.tools);
    renderOperationalCards(root, operations);

    const series = this.catalog.seriesRecords();
    if (model.kind === 'empty' && series.length === 0) {
      const empty = root.createDiv({ cls: 'pm-empty-state' });
      const icon = empty.createDiv({ cls: 'pm-empty-state__icon' });
      setIcon(icon, 'book-open');
      empty.createEl('h2', { text: 'No publishing projects yet' });
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

    renderPortfolioTable(
      root,
      operations,
      series,
      this.portfolioPage,
      (page) => {
        this.portfolioPage = page;
        if (this.snapshot !== undefined) this.render(this.snapshot);
      },
      (record) => void this.openBook(record),
      this.openSeries,
      (record) => this.projectCoverUrl(record)
    );
  }

  /** Resolves only a local user-selected image, never a remote cover URL or copied asset. */
  private projectCoverUrl(record: CatalogRecord): string | undefined {
    const path = record.fields.cover;
    const file = typeof path === 'string' ? this.app.vault.getAbstractFileByPath(path) : null;
    // TFile exposes "webp", not ".webp", so this must validate the extension without a period.
    if (!(file instanceof TFile) || !/^(avif|gif|jpe?g|png|svg|webp)$/iu.test(file.extension))
      return undefined;
    return this.app.vault.getResourcePath(file);
  }

  private async refreshReadiness(snapshot: BookCatalogSnapshot): Promise<void> {
    const active = snapshot.books.filter(({ archived }) => !archived);
    const results = await Promise.all(
      active.map(async (book) =>
        this.readiness
          .evaluateBook(book.id)
          .then((evaluation) => [book.id, evaluation] as const)
          .catch(() => undefined)
      )
    );
    this.evaluations.clear();
    for (const result of results)
      if (result !== undefined) this.evaluations.set(result[0], result[1]);
    if (this.snapshot === snapshot) this.render(snapshot);
  }

  private async saveCurrentView(name: string): Promise<void> {
    const view: DashboardSavedView = {
      id: `dashboard-view-${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')}`,
      name,
      filters: { ...this.filters },
      columns: [...this.columns]
    };
    try {
      await this.preferences.saveView(view);
      this.savedViews = await this.preferences.savedViews();
      if (this.snapshot !== undefined) this.render(this.snapshot);
    } catch (cause: unknown) {
      new Notice(cause instanceof Error ? cause.message : 'Saved view could not be stored.');
    }
  }

  private openBookById(bookId: string, tab = 'overview'): void {
    const book = this.snapshot?.books.find(({ id }) => id === bookId);
    if (book !== undefined) void this.openBook(book, tab);
  }

  private async openRecord(record: CatalogRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
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

/**
 * Renders the one graphical navigation hub behind the Publishing Dashboard ribbon icon. Books
 * stay inside the Dashboard/Book Workspace flow; standalone tools reuse their registered leaves.
 * Rejected route promises become local notices so a failed tool cannot produce an unhandled task.
 */
function renderPublishingWorkspaces(
  root: HTMLElement,
  empty: boolean,
  createBook: () => void,
  tools: PublishingDashboardTools
): void {
  const section = root.createEl('section', {
    cls: 'pm-panel pm-tool-launcher',
    attr: { 'aria-labelledby': 'pm-tool-launcher-heading' }
  });
  section.createEl('h2', {
    text: 'Publishing workspaces',
    attr: { id: 'pm-tool-launcher-heading' }
  });
  section.createEl('p', {
    text: 'Open every publishing manager area from this dashboard. Command-palette routes remain available.'
  });
  const grid = section.createDiv({ cls: 'pm-tool-grid' });
  const entries: readonly {
    readonly label: string;
    readonly description: string;
    readonly icon: string;
    readonly action: () => void;
  }[] = [
    {
      label: 'Books and publishing workspaces',
      description: empty
        ? 'Create the first book, then manage editions, workflow, metadata, ISBNs, pricing, distribution, readiness, sales, launch, reviews, history, assets, and diagnostics.'
        : 'Choose a book in the portfolio, then use its complete publishing workspace.',
      icon: 'book-open',
      action: () => {
        if (empty) {
          createBook();
          return;
        }
        const portfolio = root.querySelector<HTMLElement>('#pm-dashboard-portfolio');
        portfolio?.scrollIntoView({ block: 'start' });
        portfolio?.focus();
      }
    },
    {
      label: 'Template library',
      description: 'Copy, edit, preview, import, and export reusable local publishing templates.',
      icon: 'layout-template',
      action: () => runDashboardTool(tools.openTemplates, 'Template library could not open.')
    },
    {
      label: 'Export center',
      description: 'Preview and create local Markdown, CSV, JSON, and calendar exports.',
      icon: 'file-output',
      action: () => runDashboardTool(tools.openExports, 'Export center could not open.')
    },
    {
      label: 'Diagnostics',
      description: 'Inspect local health, rebuild derived state, and create redacted evidence.',
      icon: 'stethoscope',
      action: () => runDashboardTool(tools.openDiagnostics, 'Diagnostics could not open.')
    },
  ];
  for (const entry of entries) {
    const control = grid.createEl('button', {
      cls: 'pm-tool-card',
      attr: {
        type: 'button',
        // The compact card visibly names the destination; the full purpose remains available to
        // assistive technology and as a native hover title without forcing dense prose into UI.
        'aria-label': `Open ${entry.label}: ${entry.description}`,
        title: entry.description
      }
    });
    const icon = control.createSpan({ cls: 'pm-tool-card__icon' });
    setIcon(icon, entry.icon);
    const copy = control.createSpan({ cls: 'pm-tool-card__copy' });
    copy.createEl('strong', { text: entry.label });
    control.addEventListener('click', entry.action);
  }
}

/** Converts a rejected navigation callback into one concise Obsidian notice. */
function runDashboardTool(action: () => Promise<void>, fallback: string): void {
  void action().catch((cause: unknown) => {
    new Notice(cause instanceof Error ? cause.message : fallback);
  });
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

/** DSH-001 cards are buttons so every aggregate reveals its supporting section. */
function renderOperationalCards(root: HTMLElement, model: OperationalDashboardModel): void {
  const section = root.createEl('section', {
    cls: 'pm-summary-grid',
    attr: { 'aria-label': 'Operational summary' }
  });
  for (const card of [
    {
      label: 'Active projects',
      value: model.activeBooks,
      detail: 'Inspect in portfolio',
      target: 'pm-dashboard-portfolio'
    },
    {
      label: 'Launches 30 / 60 / 90',
      value: `${model.launches30} / ${model.launches60} / ${model.launches90}`,
      detail: 'Inspect publication anchors',
      target: 'pm-dashboard-timeline'
    },
    {
      label: 'Overdue tasks',
      value: model.overdueTasks,
      detail: 'Inspect ranked attention',
      target: 'pm-dashboard-attention'
    },
    {
      label: 'Readiness blockers',
      value: model.readinessBlockers,
      detail: 'Inspect ranked attention',
      target: 'pm-dashboard-attention'
    }
  ]) {
    const element = section.createEl('button', {
      cls: 'pm-summary-card pm-summary-card--button',
      attr: { type: 'button' }
    });
    element.createSpan({ cls: 'pm-summary-card__label', text: card.label });
    element.createEl('strong', { cls: 'pm-summary-card__value', text: String(card.value) });
    element.createSpan({ cls: 'pm-summary-card__detail', text: card.detail });
    element.addEventListener('click', () => {
      const target = root.querySelector<HTMLElement>(`#${card.target}`);
      target?.scrollIntoView({ block: 'start' });
      target?.focus();
    });
  }
}

function renderDashboardControls(
  root: HTMLElement,
  filters: DashboardFilterState,
  columns: readonly string[],
  savedViews: readonly DashboardSavedView[],
  actions: {
    update: (filters: DashboardFilterState, columns: readonly string[]) => void;
    save: (name: string) => void;
    apply: (view: DashboardSavedView) => void;
  }
): void {
  const details = root.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Filters, columns, and saved views' });
  const draft = { ...filters };
  const selected = new Set(columns);
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  for (const [key, label] of [
    ['series', 'Series ID'],
    ['imprint', 'Imprint'],
    ['owner', 'Owner'],
    ['status', 'Book status'],
    ['editionType', 'Edition type'],
    ['platform', 'Platform'],
    ['territory', 'Territory'],
    ['maximumScore', 'Maximum score']
  ] as const) {
    const input = form.createEl('input', {
      value: draft[key],
      attr: { type: 'text', placeholder: label, 'aria-label': label }
    });
    input.addEventListener('input', () => {
      draft[key] = input.value;
    });
  }
  const launch = form.createEl('select', { attr: { 'aria-label': 'Launch window' } });
  for (const value of ['', '30', '60', '90'] as const) {
    const option = launch.createEl('option', {
      value,
      text: value ? `Launch within ${value} days` : 'Any launch window'
    });
    option.selected = value === draft.launchWindow;
  }
  launch.addEventListener('change', () => {
    draft.launchWindow = launch.value as DashboardFilterState['launchWindow'];
  });
  const columnBox = details.createDiv({ cls: 'pm-action-row' });
  for (const column of DEFAULT_DASHBOARD_COLUMNS) {
    const label = columnBox.createEl('label');
    const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = selected.has(column);
    label.appendText(` ${column}`);
    checkbox.addEventListener('change', () =>
      checkbox.checked ? selected.add(column) : selected.delete(column)
    );
  }
  const apply = form.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Apply view',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.update({ ...draft }, [...selected]);
  });
  apply.addEventListener('click', () => undefined);
  const saveRow = details.createDiv({ cls: 'pm-action-row' });
  const name = saveRow.createEl('input', {
    attr: { type: 'text', placeholder: 'Saved view name', 'aria-label': 'Saved view name' }
  });
  const save = saveRow.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Save current view',
    attr: { type: 'button' }
  });
  save.addEventListener('click', () => actions.save(name.value));
  if (savedViews.length > 0) {
    const choose = saveRow.createEl('select', { attr: { 'aria-label': 'Apply saved view' } });
    choose.createEl('option', { value: '', text: 'Choose saved view' });
    for (const view of savedViews) choose.createEl('option', { value: view.id, text: view.name });
    choose.addEventListener('change', () => {
      const view = savedViews.find(({ id }) => id === choose.value);
      if (view !== undefined) actions.apply(view);
    });
  }
}

/** DSH-004 semantic table collapses horizontally while retaining every selected column. */
function renderPortfolioTable(
  parent: HTMLElement,
  model: OperationalDashboardModel,
  series: readonly CatalogRecord[],
  requestedPage: number,
  changePage: (page: number) => void,
  openBook: (record: CatalogRecord) => void,
  openSeries: (record: CatalogRecord) => void,
  coverUrl: (record: CatalogRecord) => string | undefined
): void {
  const pageSize = 50;
  const entries: readonly PortfolioCard[] = [
    ...series.map((record) => ({ kind: 'series' as const, record })),
    ...model.portfolio.map(({ book }) => ({ kind: 'project' as const, record: book }))
  ];
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const rows = entries.slice(page * pageSize, (page + 1) * pageSize);
  const section = parent.createEl('section', {
    cls: 'pm-panel pm-portfolio',
    attr: { id: 'pm-dashboard-portfolio', tabindex: '-1' }
  });
  const heading = section.createDiv({ cls: 'pm-section-heading' });
  heading.createDiv().createEl('h2', { text: 'Publishing portfolio' });
  heading.createSpan({
    cls: 'pm-count-badge',
    text: `${model.portfolio.length} projects · ${series.length} series`
  });
  if (entries.length > pageSize) {
    const paging = section.createDiv({
      cls: 'pm-action-row',
      attr: { 'aria-label': 'Portfolio pages' }
    });
    const previous = paging.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Previous page',
      attr: { type: 'button' }
    });
    previous.disabled = page === 0;
    previous.addEventListener('click', () => changePage(page - 1));
    paging.createSpan({
      text: `Page ${page + 1} of ${pageCount} · ${rows.length} visible`,
      attr: { 'aria-live': 'polite' }
    });
    const next = paging.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Next page',
      attr: { type: 'button' }
    });
    next.disabled = page + 1 >= pageCount;
    next.addEventListener('click', () => changePage(page + 1));
  }
  renderProjectCards(section, rows, openBook, openSeries, coverUrl);
}

type PortfolioCard = { readonly kind: 'project' | 'series'; readonly record: CatalogRecord };

/** Renders a fixed desktop Project-card grid so a small portfolio never becomes one stretched row. */
function renderProjectCards(
  parent: HTMLElement,
  rows: readonly PortfolioCard[],
  openBook: (record: CatalogRecord) => void,
  openSeries: (record: CatalogRecord) => void,
  coverUrl: (record: CatalogRecord) => string | undefined
): void {
  const cards = parent.createDiv({ cls: 'pm-project-dashboard-cards', attr: { 'aria-label': 'Projects and series' } });
  for (const row of rows) {
    const card = cards.createEl('button', {
      cls: 'pm-project-dashboard-card',
      attr: { type: 'button' }
    });
    // The record type belongs above the visual cover so users can identify the card before
    // reading the artwork or title. This also keeps Project and Series cards structurally equal.
    card.createEl('p', {
      cls: 'pm-project-dashboard-card__type',
      text: row.kind === 'series' ? 'Series' : 'Project'
    });
    const cover = coverUrl(row.record);
    if (cover === undefined) card.createDiv({ cls: 'pm-project-dashboard-card__placeholder', text: 'No cover' });
    else
      card.createEl('img', {
        attr: {
          src: cover,
          alt: `${String(row.record.fields[row.kind === 'series' ? 'name' : 'title'])} cover art`
        }
      });
    const content = card.createDiv({ cls: 'pm-project-dashboard-card__content' });
    content.createEl('h3', {
      text: String(row.record.fields[row.kind === 'series' ? 'name' : 'title'])
    });
    card.addEventListener('click', () => {
      if (row.kind === 'series') openSeries(row.record);
      else openBook(row.record);
    });
  }
}

/** Supplies the visible mobile-card label for every configurable portfolio column. */
function dashboardColumnLabel(column: string): string {
  return column
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderTimeline(
  parent: HTMLElement,
  model: OperationalDashboardModel,
  open: (bookId: string) => void
): void {
  const section = parent.createEl('section', {
    cls: 'pm-panel',
    attr: { id: 'pm-dashboard-timeline', tabindex: '-1' }
  });
  section.createEl('h2', { text: 'Launch timeline' });
  if (model.timeline.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No publication anchors match this view.' });
    return;
  }
  const list = section.createEl('ol', { cls: 'pm-activity-list' });
  for (const item of model.timeline.slice(0, 12)) {
    const row = list.createEl('li');
    const button = row.createEl('button', {
      cls: 'pm-text-button',
      text: `${item.date} · ${item.title} · ${item.days} days`,
      attr: { type: 'button' }
    });
    button.addEventListener('click', () => open(item.bookId));
  }
}

function renderWorkload(parent: HTMLElement, model: OperationalDashboardModel): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Owner workload' });
  if (model.workload.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No open assigned tasks match this view.' });
    return;
  }
  const list = section.createEl('ul');
  for (const owner of model.workload)
    list.createEl('li', { text: `${owner.owner} · ${owner.open} open · ${owner.overdue} overdue` });
}

function renderAttention(
  parent: HTMLElement,
  model: OperationalDashboardModel,
  open: (item: DashboardAttentionItem) => void
): void {
  const section = parent.createEl('section', {
    cls: 'pm-panel',
    attr: { id: 'pm-dashboard-attention', tabindex: '-1' }
  });
  section.createEl('h2', { text: 'Ranked attention' });
  if (model.attention.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No operational attention items.' });
    return;
  }
  const list = section.createEl('ol', { cls: 'pm-diagnostic-list' });
  for (const item of model.attention.slice(0, 16)) {
    const row = list.createEl('li');
    row.createEl('strong', { text: `${item.kind} · priority ${item.priority} · ${item.title}` });
    row.createEl('p', { text: item.explanation });
    if (item.bookId !== undefined || item.record !== undefined) {
      const button = row.createEl('button', {
        cls: 'pm-text-button',
        text: 'Inspect source',
        attr: { type: 'button' }
      });
      button.addEventListener('click', () => open(item));
    }
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
