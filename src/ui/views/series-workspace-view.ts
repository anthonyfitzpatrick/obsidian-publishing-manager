/**
 * Renders a persistent Series page. A Series only groups Projects, so this workspace presents
 * its identity, cover, and membership without duplicating any Project/edition data or using a
 * transient modal as the primary management surface.
 */

import {
  ItemView,
  Notice,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import { AddProjectToSeriesModal } from '../dialogs/add-project-to-series-modal';

/** Stable persisted type used by Obsidian for a selected Series workspace tab. */
export const SERIES_WORKSPACE_VIEW_TYPE = 'publishing-manager-series-workspace';

/** Full-page Series management surface, intentionally parallel to the Project workspace. */
export class SeriesWorkspaceView extends ItemView {
  private unsubscribe: (() => void) | undefined;
  private snapshot: BookCatalogSnapshot | undefined;
  private selectedPath: VaultPath | undefined;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly books: BookProjectService,
    private readonly openDashboard: () => Promise<void>
  ) {
    super(leaf);
    this.icon = 'list-ordered';
    this.navigation = true;
  }

  public getViewType(): string {
    return SERIES_WORKSPACE_VIEW_TYPE;
  }

  public getDisplayText(): string {
    const series = this.catalog.seriesRecords().find((record) => record.path === this.selectedPath);
    return typeof series?.fields.name === 'string' ? series.fields.name : 'Series workspace';
  }

  public override getState(): Record<string, unknown> {
    return this.selectedPath === undefined ? {} : { seriesPath: this.selectedPath };
  }

  /** Restores only a normalized record path; the current catalog resolves the actual Series. */
  public override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (isRecord(state) && typeof state.seriesPath === 'string') {
      try {
        this.selectedPath = normalizeVaultPath(state.seriesPath);
      } catch {
        this.selectedPath = undefined;
      }
    }
    result.history = true;
    if (this.snapshot !== undefined) this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.unsubscribe = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.reconcileSelection();
      this.render();
    });
  }

  protected override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  /** Never silently transfers a Series tab to a different record after an external deletion. */
  private reconcileSelection(): void {
    if (this.selectedPath !== undefined && this.catalog.seriesRecords().some((item) => item.path === this.selectedPath)) return;
    this.selectedPath = undefined;
  }

  /** Builds a page header and the two Series management panels from the immutable catalog. */
  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-series-workspace');
    const series = this.catalog.seriesRecords().find((record) => record.path === this.selectedPath);
    if (series === undefined) {
      const empty = root.createDiv({ cls: 'pm-empty-state' });
      empty.createEl('h2', { text: 'Series unavailable' });
      empty.createEl('p', { text: 'Return to the Dashboard and select an available Series card.' });
      const dashboard = empty.createEl('button', {
        cls: 'pm-button pm-button--primary',
        text: 'Open Dashboard',
        attr: { type: 'button' }
      });
      dashboard.addEventListener('click', () => void this.openDashboard());
      return;
    }

    const header = root.createDiv({ cls: 'pm-workspace-header' });
    const breadcrumb = header.createDiv({ cls: 'pm-breadcrumb' });
    const dashboard = breadcrumb.createEl('button', { text: 'Dashboard', attr: { type: 'button' } });
    dashboard.addEventListener('click', () => void this.openDashboard());
    breadcrumb.createSpan({ text: '›' });
    breadcrumb.createSpan({ text: String(series.fields.name) });
    const body = header.createDiv({ cls: 'pm-workspace-header__body' });
    const identity = body.createDiv({ cls: 'pm-workspace-header__identity' });
    identity.createEl('p', { cls: 'pm-eyebrow', text: 'Series' });
    identity.createEl('h1', { text: String(series.fields.name) });
    const members = this.catalog.orderedBooks(series.id).filter((project) => !project.archived);
    identity.createSpan({
      cls: 'pm-status-chip pm-status-chip--active',
      text: `${members.length} Project${members.length === 1 ? '' : 's'}`
    });
    const side = body.createDiv({ cls: 'pm-workspace-header__side' });
    const actions = side.createDiv({ cls: 'pm-action-row pm-workspace-header__commands' });
    const openMarkdown = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Open Markdown',
      attr: { type: 'button' }
    });
    openMarkdown.addEventListener('click', () => void this.openMarkdown(series));
    this.renderHeaderCover(side, series);

    const page = root.createDiv({ cls: 'pm-series-workspace__content' });
    this.renderCoverPanel(page, series);
    this.renderMembershipPanel(page, series);
  }

  /** Shows the current local Series cover in the same persistent header position as a Project. */
  private renderHeaderCover(parent: HTMLElement, series: CatalogRecord): void {
    const path = series.fields.cover;
    const file = typeof path === 'string' ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) || !isCoverFile(file)) return;
    const cover = parent.createDiv({ cls: 'pm-workspace-header__cover' });
    cover.createEl('img', {
      attr: { src: this.app.vault.getResourcePath(file), alt: `${String(series.fields.name)} cover art` }
    });
  }

  /** Offers the same local drag/drop derivative workflow used by Project cover art. */
  private renderCoverPanel(parent: HTMLElement, series: CatalogRecord): void {
    const panel = parent.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Series cover art' });
    panel.createEl('p', {
      text: 'Optional local image. It is optimized for the Dashboard card while the original file remains untouched in your vault.'
    });
    const error = panel.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    const drop = panel.createEl('button', {
      cls: 'pm-cover-drop-zone',
      text: 'Drop Series cover art here, or click to choose an image',
      attr: { type: 'button' }
    });
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    picker.hidden = true;
    drop.appendChild(picker);
    const accept = (source: File | TFile) => {
      drop.setAttr('disabled', 'true');
      void this.optimizeCover(series, source)
        .then((path) => this.books.editSeries(series.path, { cover: path }))
        .then(() => new Notice('Optimized Series cover art is ready.'))
        .catch((cause: unknown) => {
          error.setText(cause instanceof Error ? cause.message : 'Could not prepare the Series cover art.');
          error.focus();
        })
        .finally(() => drop.removeAttribute('disabled'));
    };
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (file !== undefined) accept(file);
    });
    drop.addEventListener('click', () => picker.click());
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.addClass('is-dragging');
    });
    drop.addEventListener('dragleave', () => drop.removeClass('is-dragging'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.removeClass('is-dragging');
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) accept(file);
      else new Notice('Drop a local image file or choose one from your device.');
    });
  }

  /** Keeps the page focused on current members; available Projects are opened only when requested. */
  private renderMembershipPanel(parent: HTMLElement, series: CatalogRecord): void {
    const panel = parent.createEl('section', { cls: 'pm-panel' });
    const heading = panel.createDiv({ cls: 'pm-section-heading' });
    heading.createDiv().createEl('h2', { text: 'Projects in this Series' });
    const add = heading.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Add Project',
      attr: { type: 'button' }
    });
    add.addEventListener('click', () =>
      new AddProjectToSeriesModal(this.app, this.books, this.catalog, series).open()
    );
    const projects = this.catalog.orderedBooks(series.id).filter((project) => !project.archived);
    if (projects.length === 0) {
      panel.createEl('p', {
        text: 'No Projects are attached yet. Use Add Project to choose a standalone Project.'
      });
      return;
    }
    panel.createEl('p', {
      text: 'Attached Projects appear only inside this Series. Remove one to make it a top-level standalone Project again.'
    });
    const error = panel.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    const partNumbers = new Map(
      projects.map((project) => [project.path, Number(project.fields['series-position'])])
    );
    // Membership uses the same compact visual language as the Dashboard. The controls stay in
    // each card, so a Series remains easy to maintain without falling back to a dense settings row.
    const cards = panel.createDiv({
      cls: 'pm-project-dashboard-cards pm-series-project-cards',
      attr: { 'aria-label': 'Projects in this Series' }
    });
    for (const project of projects) {
      const title = typeof project.fields.title === 'string' ? project.fields.title : project.id;
      const card = cards.createEl('article', { cls: 'pm-project-dashboard-card pm-series-project-card' });
      card.createEl('p', { cls: 'pm-project-dashboard-card__type', text: 'Project' });
      this.renderProjectCardCover(card, project, title);
      const content = card.createDiv({ cls: 'pm-project-dashboard-card__content' });
      content.createEl('h3', { text: title });
      const controls = content.createDiv({ cls: 'pm-series-project-card__controls' });
      const partField = controls.createEl('label', { cls: 'pm-field', text: 'Part number' });
      const partInput = partField.createEl('input', {
        type: 'number',
        value: String(partNumbers.get(project.path) ?? ''),
        attr: { min: '1', step: '1', 'aria-label': `Part number for ${title}` }
      });
      partInput.addEventListener('input', () => partNumbers.set(project.path, Number(partInput.value)));
      const remove = controls.createEl('button', {
        cls: 'pm-button pm-button--secondary',
        text: 'Remove from Series',
        attr: { type: 'button' }
      });
      remove.addEventListener('click', () => {
        remove.setAttr('disabled', 'true');
        void this.removeProject(project, error).finally(() => remove.removeAttribute('disabled'));
      });
    }
    const actions = panel.createDiv({ cls: 'pm-action-row pm-series-project-card-actions' });
    const save = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Save Part numbers',
      attr: { type: 'button' }
    });
    save.addEventListener('click', () => {
      save.setAttr('disabled', 'true');
      void this.savePartNumbers(series, partNumbers, error).finally(() => save.removeAttribute('disabled'));
    });
  }

  /** Resolves a Project cover without making membership presentation depend on the Dashboard view. */
  private renderProjectCardCover(parent: HTMLElement, project: CatalogRecord, title: string): void {
    const path = project.fields.cover;
    const file = typeof path === 'string' ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) || !isCoverFile(file)) {
      parent.createDiv({ cls: 'pm-project-dashboard-card__placeholder', text: 'No cover' });
      return;
    }
    parent.createEl('img', { attr: { src: this.app.vault.getResourcePath(file), alt: `${title} cover art` } });
  }

  /** Persists all Part numbers as one validated Series-order operation, including direct swaps. */
  private async savePartNumbers(
    series: CatalogRecord,
    partNumbers: ReadonlyMap<VaultPath, number>,
    error: HTMLElement
  ): Promise<void> {
    try {
      await this.books.setSeriesPartNumbers(
        series.id,
        [...partNumbers].map(([path, partNumber]) => ({ path, partNumber }))
      );
      new Notice('Series Part numbers saved.');
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Part numbers could not be saved.');
      error.focus();
    }
  }

  /** Removes only the selected relationship; the Project remains intact and returns to the Dashboard. */
  private async removeProject(project: CatalogRecord, error: HTMLElement): Promise<void> {
    try {
      await this.books.removeSeries(project.path);
      new Notice(`Removed “${String(project.fields.title)}” from this Series.`);
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Project could not be removed from this Series.');
      error.focus();
    }
  }

  /** Writes a bounded 480×768 WebP derivative alongside the Series record, never replacing source art. */
  private async optimizeCover(series: CatalogRecord, source: File | TFile): Promise<string> {
    const type = source instanceof File ? source.type : mimeTypeForCover(source.extension);
    if (!type.startsWith('image/')) throw new Error('Choose an AVIF, GIF, JPEG, PNG, SVG, or WebP image.');
    const bytes = source instanceof File ? await source.arrayBuffer() : await this.app.vault.readBinary(source);
    const bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const scale = Math.min(1, 480 / bitmap.width, 768 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This device could not prepare the cover image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const webp = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error('Could not encode the cover image.')) : resolve(blob)),
        'image/webp',
        0.78
      )
    );
    const folder = `${series.path.slice(0, series.path.lastIndexOf('/'))}/Covers`;
    if (this.app.vault.getAbstractFileByPath(folder) === null) await this.app.vault.createFolder(folder);
    const target = `${folder}/${series.id}.webp`;
    const existing = this.app.vault.getAbstractFileByPath(target);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, await webp.arrayBuffer());
    else await this.app.vault.createBinary(target, await webp.arrayBuffer());
    return target;
  }

  private async openMarkdown(series: CatalogRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(series.path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice('The Series Markdown record is no longer available.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCoverFile(file: TFile): boolean {
  return /^(avif|gif|jpe?g|png|svg|webp)$/iu.test(file.extension);
}

function mimeTypeForCover(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === 'avif') return 'image/avif';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'svg') return 'image/svg+xml';
  return 'image/webp';
}
