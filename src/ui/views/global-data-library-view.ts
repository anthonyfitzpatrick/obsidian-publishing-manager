/** Native home for reusable publishing data that exists before and beyond any individual book. */
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type {
  IsbnImportPreview,
  IsbnProjectService
} from '../../application/isbn/isbn-project-service';

export const GLOBAL_DATA_LIBRARY_VIEW_TYPE = 'publishing-manager-global-data-library';

export class GlobalDataLibraryView extends ItemView {
  /** The draft stays in this view until the user deliberately applies a reviewed import. */
  private isbnImportText = '';
  private isbnImportPreview: IsbnImportPreview | undefined;
  private isbnImportOpen = false;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly isbns: IsbnProjectService
  ) {
    super(leaf);
    this.icon = 'database';
    this.navigation = true;
  }
  public getViewType(): string {
    return GLOBAL_DATA_LIBRARY_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'Global data library';
  }
  protected override async onOpen(): Promise<void> {
    this.render();
  }

  /** Rebuilds only this disposable view; canonical data remains in Markdown records. */
  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager');
    root.createEl('p', { cls: 'pm-eyebrow', text: 'Shared publishing reference data' });
    root.createEl('h1', { text: 'Global data library' });
    root.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Manage reusable publishing data once, then select it throughout Publishing Manager.'
    });
    const isbn = root.createEl('section', { cls: 'pm-panel pm-global-data-card' });
    const isbnHeading = isbn.createDiv({ cls: 'pm-section-heading' });
    isbnHeading.createEl('h2', { text: 'ISBN inventory' });
    const isbnAction = isbnHeading.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: this.isbnImportOpen ? 'Close import' : 'Import ISBNs',
      attr: { type: 'button' }
    });
    isbnAction.addEventListener('click', () => {
      this.isbnImportOpen = !this.isbnImportOpen;
      this.render();
    });
    isbn.createEl('p', {
      text: `${this.catalog.recordsOfType('isbn').length} ISBN record(s) are available across this vault. Add a whole allocation at once, then assign individual ISBNs from the relevant book workspace.`
    });
    if (this.isbnImportOpen) this.renderIsbnImport(isbn);

    const locations = root.createEl('section', { cls: 'pm-panel pm-global-data-card' });
    const locationHeading = locations.createDiv({ cls: 'pm-section-heading' });
    locationHeading.createEl('h2', { text: 'Publication locations' });
    const locationAction = locationHeading.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Add publication location',
      attr: { type: 'button' }
    });
    locationAction.addEventListener('click', () => {
      new Notice(
        'Publication-location records are the next Global Data Library data-entry area. ISBN imports are ready now.'
      );
    });
    locations.createEl('p', {
      text: 'Store retailers, distributors, storefronts, and physical locations once. They will then be selectable for distribution and sales, avoiding duplicate entry.'
    });
  }

  /** Shows a compact bulk-entry workflow that retains row-level review for invalid input. */
  private renderIsbnImport(parent: HTMLElement): void {
    const form = parent.createDiv({ cls: 'pm-global-data-import' });
    form.createEl('h3', { text: 'Add ISBN allocation' });
    form.createEl('p', {
      text: 'Paste one ISBN-10 or ISBN-13 per line. Spaces and hyphens are accepted. Nothing is saved until you preview and confirm the ready rows.'
    });
    const input = form.createEl('textarea', {
      text: this.isbnImportText,
      attr: {
        rows: '10',
        placeholder: '978-1-4028-9462-6\n0-306-40615-2',
        'aria-label': 'ISBNs to import, one per line'
      }
    });
    input.addEventListener('input', () => {
      this.isbnImportText = input.value;
      this.isbnImportPreview = undefined;
    });
    const actions = form.createDiv({ cls: 'pm-action-row' });
    const preview = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Preview ISBN import',
      attr: { type: 'button' }
    });
    preview.addEventListener('click', () => {
      this.isbnImportText = input.value;
      this.isbnImportPreview = this.isbns.previewImport(this.isbnImportText);
      this.render();
    });
    const cancel = actions.createEl('button', {
      cls: 'pm-text-button',
      text: 'Clear entry',
      attr: { type: 'button' }
    });
    cancel.addEventListener('click', () => {
      this.isbnImportText = '';
      this.isbnImportPreview = undefined;
      this.render();
    });
    if (this.isbnImportPreview !== undefined) this.renderImportPreview(form);
  }

  /** Presents the exact count first and detailed rejection evidence only when attention is needed. */
  private renderImportPreview(parent: HTMLElement): void {
    const preview = this.isbnImportPreview!;
    const summary = parent.createDiv({ cls: 'pm-inline-alert' });
    summary.createEl('strong', {
      text: `${preview.ready} ready to add · ${preview.rejected} need attention`
    });
    summary.createEl('p', {
      text:
        preview.rejected === 0
          ? 'Every entered ISBN is valid and new to this vault.'
          : 'Correct or remove the rows below before adding the ready ISBNs.'
    });
    const rejected = preview.rows.filter((row) => row.status !== 'ready').slice(0, 25);
    if (rejected.length > 0) {
      const list = parent.createEl('ul', { cls: 'pm-global-data-errors' });
      for (const row of rejected)
        list.createEl('li', { text: `Line ${row.row}: ${row.input} — ${row.message}` });
      if (preview.rejected > rejected.length)
        parent.createEl('p', {
          cls: 'pm-muted',
          text: `Showing the first ${rejected.length} of ${preview.rejected} rows that need attention.`
        });
    }
    if (preview.ready === 0) return;
    const apply = parent.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: `Add ${preview.ready} ISBN${preview.ready === 1 ? '' : 's'} to inventory`,
      attr: { type: 'button' }
    });
    apply.addEventListener('click', () => {
      apply.disabled = true;
      void this.isbns
        .applyImport(this.isbnImportText)
        .then((records) => {
          new Notice(`${records.length} ISBN${records.length === 1 ? '' : 's'} added to inventory.`);
          this.isbnImportText = '';
          this.isbnImportPreview = undefined;
          this.isbnImportOpen = false;
          this.render();
        })
        .catch((cause: unknown) => {
          new Notice(cause instanceof Error ? cause.message : 'Could not add the ISBNs.');
          apply.disabled = false;
        });
    });
  }
}
