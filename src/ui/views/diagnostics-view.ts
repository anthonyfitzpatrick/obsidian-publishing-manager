/** Native M7 Diagnostics Center with textual evidence, guided navigation, safe rebuild, and export. */
import { ItemView, Notice, TFile, setIcon, type Plugin, type WorkspaceLeaf } from 'obsidian';
import {
  type CacheRebuildPreview,
  type DiagnosticCategory,
  type DiagnosticReport,
  type DiagnosticsExportPreview,
  type DiagnosticsService
} from '../../application/diagnostics/diagnostics-service';
import { pageCollection, pagedCollectionWindow } from '../view-models/paged-collection';

export const DIAGNOSTICS_VIEW_TYPE = 'publishing-manager-diagnostics';
const CATEGORIES: readonly DiagnosticCategory[] = [
  'schema',
  'identity',
  'links',
  'dependencies',
  'integrations',
  'migrations',
  'caches'
];

/** Keeps preview state explicit so a rerender never applies an unseen export or rebuild. */
export class DiagnosticsView extends ItemView {
  private report: DiagnosticReport | undefined;
  private exportPreview: DiagnosticsExportPreview | undefined;
  private rebuildPreview: CacheRebuildPreview | undefined;
  private category: DiagnosticCategory | 'all' = 'all';
  private includeSensitive = false;
  private evidencePage = 0;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly diagnostics: DiagnosticsService
  ) {
    super(leaf);
    this.icon = 'stethoscope';
    this.navigation = true;
  }
  public getViewType(): string {
    return DIAGNOSTICS_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'Publishing diagnostics';
  }
  protected override async onOpen(): Promise<void> {
    await this.refresh();
  }
  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async refresh(): Promise<void> {
    try {
      this.report = await this.diagnostics.report();
      this.exportPreview = undefined;
      this.rebuildPreview = undefined;
      this.render();
    } catch (error) {
      new Notice(message(error, 'Diagnostics could not be loaded.'));
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-diagnostics-center');
    const header = root.createDiv({ cls: 'pm-page-header' });
    const titles = header.createDiv({ cls: 'pm-page-header__titles' });
    titles.createEl('p', { cls: 'pm-eyebrow', text: 'Read-mostly system evidence' });
    titles.createEl('h1', { text: 'Diagnostics' });
    titles.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Inspect schema, identity, links, dependencies, integrations, migrations, and disposable caches without silent repair.'
    });
    const actions = header.createDiv({ cls: 'pm-action-row' });
    button(actions, 'Refresh evidence', 'refresh-cw', () => void this.refresh());
    this.renderSummary(root);
    this.renderFilters(root);
    this.renderItems(root);
    this.renderRebuild(root);
    this.renderExport(root);
  }

  private renderSummary(root: HTMLElement): void {
    if (this.report === undefined) return;
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'System health' });
    const counts = new Map<string, number>();
    for (const item of this.report.items)
      counts.set(item.severity, (counts.get(item.severity) ?? 0) + 1);
    const grid = panel.createDiv({ cls: 'pm-summary-grid' });
    for (const [label, value] of [
      ['Errors', counts.get('error') ?? 0],
      ['Warnings', counts.get('warning') ?? 0],
      ['Clear checks', counts.get('clear') ?? 0],
      ['Projected records', this.report.projectedRecordCount]
    ] as const) {
      const card = grid.createDiv({ cls: 'pm-summary-card' });
      card.createEl('strong', { text: String(value) });
      card.createSpan({ text: label });
    }
    panel.createEl('p', {
      cls: 'pm-muted',
      text: `Catalog: ${this.report.catalogState} · Evidence ${this.report.fingerprint} · ${this.report.generatedAt}`
    });
  }

  private renderFilters(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Evidence filters' });
    const select = panel.createEl('select', { attr: { 'aria-label': 'Diagnostic category' } });
    select.createEl('option', { value: 'all', text: 'All categories' });
    for (const category of CATEGORIES)
      select.createEl('option', { value: category, text: sentence(category) });
    select.value = this.category;
    select.addEventListener('change', () => {
      this.category = select.value as DiagnosticCategory | 'all';
      this.evidencePage = 0;
      this.render();
    });
  }

  private renderItems(root: HTMLElement): void {
    if (this.report === undefined) return;
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Diagnostic evidence' });
    const visible = this.report.items.filter(
      ({ category }) => this.category === 'all' || category === this.category
    );
    const window = pagedCollectionWindow(visible.length, this.evidencePage, 50);
    this.evidencePage = window.page;
    panel.createEl('p', {
      cls: 'pm-muted',
      text:
        visible.length === 0
          ? 'No diagnostic evidence matches this filter.'
          : `Showing ${window.offset + 1}–${window.end} of ${window.total}.`
    });
    const list = panel.createEl('ol', { cls: 'pm-diagnostic-list pm-diagnostic-list--full' });
    for (const item of pageCollection(visible, window)) {
      const row = list.createEl('li');
      row.createEl('strong', {
        text: `${symbol(item.severity)} ${sentence(item.category)} · ${item.title}`
      });
      row.createEl('p', {
        text: `${sentence(item.severity)} · Source: ${item.source} · Impact: ${item.impact}`
      });
      row.createEl('p', { text: item.explanation });
      const details = row.createEl('details');
      details.createEl('summary', { text: 'Guidance and source evidence' });
      details.createEl('p', { text: item.guidance });
      if (item.path !== undefined)
        details.createEl('p', { text: `Path: ${item.path} · Field: ${item.field ?? 'record'}` });
      if (item.action === 'open-source')
        button(details, 'Preview guided action', 'external-link', () => {
          void this.diagnostics
            .previewRemediation(item.id)
            .then((preview) => {
              const steps = preview.steps.join('\n');
              if (preview.path === undefined) {
                new Notice(steps);
                return;
              }
              const file = this.app.vault.getAbstractFileByPath(preview.path);
              if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
              else new Notice(`Source is no longer available: ${preview.path}`);
            })
            .catch(
              (error: unknown) => new Notice(message(error, 'Guidance is no longer available.'))
            );
        });
    }
    this.renderEvidenceNavigation(panel, window);
  }

  /** Keeps diagnostic DOM proportional to one visible evidence window. */
  private renderEvidenceNavigation(
    parent: HTMLElement,
    window: ReturnType<typeof pagedCollectionWindow>
  ): void {
    if (window.total <= window.pageSize) return;
    const navigation = parent.createDiv({ cls: 'pm-pagination' });
    const previous = button(navigation, 'Previous diagnostic page', 'chevron-left', () => {
      this.evidencePage = Math.max(0, window.page - 1);
      this.render();
    });
    previous.disabled = window.page === 0;
    const next = button(navigation, 'Next diagnostic page', 'chevron-right', () => {
      this.evidencePage = window.page + 1;
      this.render();
    });
    next.disabled = window.page + 1 >= window.totalPages;
  }

  private renderRebuild(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Derived catalog rebuild' });
    panel.createEl('p', {
      text: 'A rebuild discards and reconstructs cache/index state from canonical Markdown. It is verification, not data repair.'
    });
    button(panel, 'Preview catalog rebuild', 'refresh-cw', () => {
      void this.diagnostics
        .previewCacheRebuild()
        .then((preview) => {
          this.rebuildPreview = preview;
          this.render();
        })
        .catch((error: unknown) => new Notice(message(error, 'Rebuild preview failed.')));
    });
    if (this.rebuildPreview === undefined) return;
    const box = panel.createEl('details', { attr: { open: 'open' } });
    box.createEl('summary', { text: 'Reviewed rebuild consequences' });
    box.createEl('p', {
      text: `${this.rebuildPreview.projectedRecordCount} projected records · ${this.rebuildPreview.diagnosticCount} current issues · Canonical writes: no`
    });
    const list = box.createEl('ul');
    for (const consequence of this.rebuildPreview.consequences)
      list.createEl('li', { text: consequence });
    button(box, 'Rebuild derived catalog', 'refresh-cw', () => {
      const preview = this.rebuildPreview;
      if (preview === undefined) return;
      void this.diagnostics
        .applyCacheRebuild(preview)
        .then((report) => {
          this.report = report;
          this.rebuildPreview = undefined;
          this.exportPreview = undefined;
          this.render();
          new Notice('Derived catalog rebuilt. Canonical records were not repaired or changed.');
        })
        .catch((error: unknown) => new Notice(message(error, 'Catalog rebuild stopped.')));
    });
  }

  private renderExport(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Local diagnostics export' });
    panel.createEl('p', {
      text: 'Exports are redacted by default. Including vault paths and stable identifiers requires an explicit preview.'
    });
    const label = panel.createEl('label', { cls: 'pm-checkbox-row' });
    const checkbox = label.createEl('input', { type: 'checkbox' });
    checkbox.checked = this.includeSensitive;
    label.createSpan({ text: 'Include vault-relative paths and stable identifiers' });
    checkbox.addEventListener('change', () => {
      this.includeSensitive = checkbox.checked;
      this.exportPreview = undefined;
    });
    button(panel, 'Preview diagnostics export', 'file-search', () => {
      void this.diagnostics
        .previewExport(!this.includeSensitive)
        .then((preview) => {
          this.exportPreview = preview;
          this.render();
        })
        .catch((error: unknown) => new Notice(message(error, 'Export preview failed.')));
    });
    if (this.exportPreview === undefined) return;
    const box = panel.createEl('details', { attr: { open: 'open' } });
    box.createEl('summary', {
      text: this.exportPreview.redacted ? 'Redacted export preview' : 'Sensitive export preview'
    });
    box.createEl('p', {
      text: `Target: ${this.exportPreview.target} · Never overwrite · Redactions: ${this.exportPreview.redactions.join(', ') || 'none'}`
    });
    const previewLimit = 16_384;
    const visibleContent = this.exportPreview.content.slice(0, previewLimit);
    box.createEl('pre').createEl('code', {
      text:
        visibleContent +
        (visibleContent.length < this.exportPreview.content.length
          ? `\n\n… Preview limited to ${previewLimit.toLocaleString()} characters; the confirmed export retains the complete report.`
          : '')
    });
    button(box, 'Create this local diagnostics export', 'file-plus-2', () => {
      const preview = this.exportPreview;
      if (preview === undefined) return;
      void this.diagnostics
        .applyExport(preview)
        .then((target) => {
          new Notice(`Diagnostics exported to ${target}.`);
          this.exportPreview = undefined;
          this.render();
        })
        .catch((error: unknown) => new Notice(message(error, 'Diagnostics export stopped.')));
    });
  }
}

/** Registers one reveal-or-create route shared by ribbon and command palette. */
export function registerDiagnosticsView(plugin: Plugin, diagnostics: DiagnosticsService): void {
  const open = async (): Promise<void> => {
    const leaf =
      plugin.app.workspace.getLeavesOfType(DIAGNOSTICS_VIEW_TYPE)[0] ??
      plugin.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: DIAGNOSTICS_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  plugin.registerView(DIAGNOSTICS_VIEW_TYPE, (leaf) => new DiagnosticsView(leaf, diagnostics));
  plugin.addRibbonIcon('stethoscope', 'Open publishing diagnostics', () => void open());
  plugin.addCommand({
    id: 'open-diagnostics',
    name: 'Open diagnostics',
    callback: () => void open()
  });
  plugin.register(() => plugin.app.workspace.detachLeavesOfType(DIAGNOSTICS_VIEW_TYPE));
}

function button(
  parent: HTMLElement,
  text: string,
  icon: string,
  action: () => void
): HTMLButtonElement {
  const control = parent.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text,
    attr: { type: 'button' }
  });
  const iconEl = control.createSpan({ cls: 'pm-button__icon' });
  setIcon(iconEl, icon);
  control.prepend(iconEl);
  control.addEventListener('click', action);
  return control;
}
function sentence(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1).replaceAll('-', ' ')}`;
}
function symbol(severity: string): string {
  return severity === 'error'
    ? '✕'
    : severity === 'warning'
      ? '⚠'
      : severity === 'clear'
        ? '✓'
        : 'ⓘ';
}
function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
