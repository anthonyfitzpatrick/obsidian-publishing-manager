/** Provides a compact global-data directory and focused child pages for high-volume registries. */
import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import type { BookCatalog } from '../../application/catalog/book-catalog';
import type {
  IsbnImportPreview,
  IsbnProjectService
} from '../../application/isbn/isbn-project-service';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import { pageCollection, pagedCollectionWindow } from '../view-models/paged-collection';

export const GLOBAL_DATA_LIBRARY_VIEW_TYPE = 'publishing-manager-global-data-library';
export const ISBN_INVENTORY_VIEW_TYPE = 'publishing-manager-isbn-inventory';
type IsbnInventorySortField = 'isbn' | 'status' | 'assignment' | 'publisher';
type IsbnInventoryFilter = 'all' | 'free' | 'allocated';

/** Directory view: it intentionally offers routes, never high-volume tables or entry forms. */
export class GlobalDataLibraryView extends ItemView {
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly openIsbnInventory: () => Promise<void>
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
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager');
    root.createEl('p', { cls: 'pm-eyebrow', text: 'Shared publishing reference data' });
    root.createEl('h1', { text: 'Global data library' });
    root.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Open a registry to enter, review, and maintain its reusable publishing data.'
    });

    const registries = root.createDiv({ cls: 'pm-global-data-grid' });
    const isbn = registries.createEl('section', { cls: 'pm-panel pm-global-data-card' });
    const isbnAction = isbn.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Manage ISBNs',
      attr: { type: 'button' }
    });
    isbnAction.addEventListener('click', () => {
      void this.openIsbnInventory().catch(() =>
        new Notice('Publishing Manager could not open the ISBN inventory.')
      );
    });
    const locations = registries.createEl('section', { cls: 'pm-panel pm-global-data-card' });
    const locationAction = locations.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Manage publication locations',
      attr: { type: 'button' }
    });
    locationAction.addEventListener('click', () => {
      new Notice('Publication-location records are the next Global Data Library delivery.');
    });
  }
}

/** Focused ISBN child page for allocation entry and a paged review of canonical Markdown records. */
export class IsbnInventoryView extends ItemView {
  /** The draft stays in this view until the user deliberately applies a reviewed import. */
  private isbnImportText = '';
  private isbnImportPreview: IsbnImportPreview | undefined;
  private isbnImportOpen = false;
  /** Twenty rows is the readable default; users can deliberately choose a larger working view. */
  private isbnInventoryPageSize = 20;
  private isbnInventoryPage = 0;
  /** Sorting is disposable presentation state; no canonical ISBN Markdown is rewritten. */
  private isbnInventorySortField: IsbnInventorySortField = 'isbn';
  private isbnInventorySortDirection: 'asc' | 'desc' = 'asc';
  /** Free means available; allocated retains every state that must not be taken by another item. */
  private isbnInventoryFilter: IsbnInventoryFilter = 'all';

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly isbns: IsbnProjectService
  ) {
    super(leaf);
    this.icon = 'barcode';
    this.navigation = true;
  }
  public getViewType(): string {
    return ISBN_INVENTORY_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'ISBN inventory';
  }
  protected override async onOpen(): Promise<void> {
    this.render();
  }

  /** Rebuilds only this disposable page; canonical ISBN data remains in Markdown records. */
  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager');
    root.createEl('p', { cls: 'pm-eyebrow', text: 'Global data library' });
    const heading = root.createDiv({ cls: 'pm-page-header' });
    const title = heading.createDiv();
    title.createEl('h1', { text: 'ISBN inventory' });
    title.createEl('p', {
      cls: 'pm-page-subtitle',
      text: `${this.isbns.records().length} ISBN record(s) are stored in this vault.`
    });
    const add = heading.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: this.isbnImportOpen ? 'Close add ISBNs' : 'Add ISBNs',
      attr: { type: 'button' }
    });
    add.addEventListener('click', () => {
      this.isbnImportOpen = !this.isbnImportOpen;
      this.render();
    });
    if (this.isbnImportOpen) this.renderIsbnImport(root);
    this.renderIsbnInventory(root);
  }

  /** Shows a compact bulk-entry workflow that retains row-level review for invalid input. */
  private renderIsbnImport(parent: HTMLElement): void {
    const form = parent.createEl('section', { cls: 'pm-panel pm-global-data-import' });
    form.createEl('h2', { text: 'Add ISBN allocation' });
    form.createEl('p', {
      text: 'Paste one ISBN-10 or ISBN-13 per line. Spaces and hyphens are accepted. Nothing is saved until you preview and confirm the ready rows.'
    });
    const input = form.createEl('textarea', {
      text: this.isbnImportText,
      attr: {
        rows: '10',
        placeholder: '978-1-4028-9462-6\n0-306-40615-2',
        'aria-label': 'ISBNs to add, one per line'
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
    const clear = actions.createEl('button', {
      cls: 'pm-text-button',
      text: 'Clear entry',
      attr: { type: 'button' }
    });
    clear.addEventListener('click', () => {
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
    const duplicateRows = preview.rows.filter(
      (row) => row.status === 'duplicate-file' || row.status === 'duplicate-pool'
    );
    if (duplicateRows.length > 0) {
      parent.createEl('p', {
        cls: 'pm-muted',
        text: 'Duplicate ISBNs can never be added. This action removes only duplicate rows that the preview has already confirmed.'
      });
      if (duplicateRows.length !== preview.rejected) {
        const removeDuplicates = parent.createEl('button', {
          cls: 'pm-button pm-button--secondary',
          text: `Remove ${duplicateRows.length} duplicate row${duplicateRows.length === 1 ? '' : 's'}`,
          attr: { type: 'button' }
        });
        removeDuplicates.addEventListener('click', () => {
          this.isbnImportText = this.withoutDuplicateRows(duplicateRows);
          this.isbnImportPreview = this.isbns.previewImport(this.isbnImportText);
          this.render();
        });
        return;
      }
      const removeDuplicatesAndApply = parent.createEl('button', {
        cls: 'pm-button pm-button--primary',
        text: `Remove ${duplicateRows.length} duplicate row${duplicateRows.length === 1 ? '' : 's'} and add ${preview.ready} new ISBN${preview.ready === 1 ? '' : 's'}`,
        attr: { type: 'button' }
      });
      removeDuplicatesAndApply.addEventListener('click', () => {
        const cleaned = this.withoutDuplicateRows(duplicateRows);
        this.applyReviewedImport(cleaned, removeDuplicatesAndApply, duplicateRows.length);
      });
      return;
    }
    const apply = parent.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: `Add ${preview.ready} ISBN${preview.ready === 1 ? '' : 's'} to inventory`,
      attr: { type: 'button' }
    });
    apply.addEventListener('click', () => {
      this.applyReviewedImport(this.isbnImportText, apply);
    });
  }

  /** Removes only evidence-confirmed duplicate input lines; invalid non-duplicates remain visible. */
  private withoutDuplicateRows(rows: readonly { readonly row: number }[]): string {
    const duplicateLineNumbers = new Set(rows.map(({ row }) => row));
    return this.isbnImportText
      .split(/\r?\n/u)
      .filter((_, index) => !duplicateLineNumbers.has(index + 1))
      .join('\n');
  }

  /** Applies the previewed text through the service, which independently rejects every duplicate. */
  private applyReviewedImport(text: string, apply: HTMLButtonElement, removedDuplicates = 0): void {
    apply.disabled = true;
    void this.isbns
      .applyImport(text)
      .then((records) => {
        const duplicateNote =
          removedDuplicates === 0
            ? ''
            : ` ${removedDuplicates} duplicate row${removedDuplicates === 1 ? '' : 's'} removed.`;
        new Notice(
          `${records.length} ISBN${records.length === 1 ? '' : 's'} added to inventory.${duplicateNote}`
        );
        this.isbnImportText = '';
        this.isbnImportPreview = undefined;
        this.isbnImportOpen = false;
        this.render();
      })
      .catch((cause: unknown) => {
        new Notice(cause instanceof Error ? cause.message : 'Could not add the ISBNs.');
        apply.disabled = false;
      });
  }

  /** Lists canonical ISBN records without copying them into a competing data store. */
  private renderIsbnInventory(parent: HTMLElement): void {
    const inventory = parent.createEl('section', { cls: 'pm-panel pm-global-data-import' });
    const allRecords = [...this.isbns.records()];
    const records = allRecords
      .filter((record) => this.matchesInventoryFilter(record))
      .sort((left, right) => this.compareInventoryRows(left, right));
    inventory.createEl('h2', { text: 'ISBNs in this vault' });
    if (allRecords.length === 0) {
      inventory.createEl('p', {
        cls: 'pm-muted',
        text: 'No ISBNs have been added yet. Choose Add ISBNs to paste your allocation.'
      });
      return;
    }
    const listControls = inventory.createDiv({ cls: 'pm-global-data-list-controls' });
    const rowsLabel = listControls.createEl('label', { text: 'Rows per page' });
    const rows = rowsLabel.createEl('select', { attr: { 'aria-label': 'ISBN rows per page' } });
    for (const pageSize of [10, 20, 50, 100])
      rows.createEl('option', { value: String(pageSize), text: String(pageSize) });
    rows.value = String(this.isbnInventoryPageSize);
    rows.addEventListener('change', () => {
      const pageSize = Number.parseInt(rows.value, 10);
      this.isbnInventoryPageSize = [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
      this.isbnInventoryPage = 0;
      this.render();
    });
    const filterLabel = listControls.createEl('label', { text: 'Show' });
    const filter = filterLabel.createEl('select', {
      attr: { 'aria-label': 'ISBN inventory availability filter' }
    });
    for (const [value, label] of [
      ['all', 'All ISBNs'],
      ['free', 'Free ISBNs'],
      ['allocated', 'Allocated ISBNs']
    ] as const)
      filter.createEl('option', { value, text: label });
    filter.value = this.isbnInventoryFilter;
    filter.addEventListener('change', () => {
      this.isbnInventoryFilter = isIsbnInventoryFilter(filter.value) ? filter.value : 'all';
      this.isbnInventoryPage = 0;
      this.render();
    });
    const sortLabel = listControls.createEl('label', { text: 'Sort by' });
    const sort = sortLabel.createEl('select', { attr: { 'aria-label': 'ISBN inventory sort field' } });
    for (const [value, label] of [
      ['isbn', 'ISBN'],
      ['status', 'Status'],
      ['assignment', 'Assigned to'],
      ['publisher', 'Publisher / imprint']
    ] as const)
      sort.createEl('option', { value, text: label });
    sort.value = this.isbnInventorySortField;
    sort.addEventListener('change', () => {
      this.isbnInventorySortField = isIsbnInventorySortField(sort.value) ? sort.value : 'isbn';
      this.isbnInventoryPage = 0;
      this.render();
    });
    const direction = listControls.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: this.isbnInventorySortDirection === 'asc' ? 'A–Z' : 'Z–A',
      attr: {
        type: 'button',
        'aria-label':
          this.isbnInventorySortDirection === 'asc'
            ? 'Sorting ascending; switch to descending'
            : 'Sorting descending; switch to ascending'
      }
    });
    direction.addEventListener('click', () => {
      this.isbnInventorySortDirection =
        this.isbnInventorySortDirection === 'asc' ? 'desc' : 'asc';
      this.isbnInventoryPage = 0;
      this.render();
    });
    if (records.length === 0) {
      inventory.createEl('p', {
        cls: 'pm-muted',
        text:
          this.isbnInventoryFilter === 'free'
            ? 'No free ISBNs are currently available.'
            : 'No allocated ISBNs are currently recorded.'
      });
      return;
    }
    const window = pagedCollectionWindow(
      records.length,
      this.isbnInventoryPage,
      this.isbnInventoryPageSize
    );
    this.isbnInventoryPage = window.page;
    inventory.createEl('p', {
      cls: 'pm-muted',
      text: `Showing ISBNs ${window.offset + 1}–${window.end} of ${records.length}.`
    });
    const table = inventory.createEl('table', { cls: 'pm-mobile-table' });
    const header = table.createEl('thead').createEl('tr');
    for (const label of ['ISBN', 'Status', 'Assigned to', 'Publisher / imprint'])
      header.createEl('th', { text: label });
    const body = table.createEl('tbody');
    for (const record of pageCollection(records, window)) {
      const row = body.createEl('tr');
      const values = [
        ['ISBN', String(record.fields.value)],
        ['Status', readableStatus(record.fields.status)],
        ['Assigned to', this.assignmentLabel(record)],
        ['Publisher / imprint', publisherLabel(record)]
      ] as const;
      for (const [label, value] of values)
        row.createEl('td', { text: value, attr: { 'data-label': label } });
    }
    if (records.length > this.isbnInventoryPageSize)
      this.renderInventoryNavigation(inventory, window.offset, window.end, records.length);
  }

  /** Keeps the current page bounded while preserving the full canonical list in the catalog. */
  private renderInventoryNavigation(
    parent: HTMLElement,
    offset: number,
    end: number,
    total: number
  ): void {
    const navigation = parent.createDiv({ cls: 'pm-pagination' });
    const previous = navigation.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Previous ISBN page',
      attr: { type: 'button' }
    });
    previous.disabled = this.isbnInventoryPage === 0;
    previous.addEventListener('click', () => {
      this.isbnInventoryPage = Math.max(0, this.isbnInventoryPage - 1);
      this.render();
    });
    navigation.createSpan({ text: `ISBNs ${offset + 1}–${end} of ${total}` });
    const next = navigation.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Next ISBN page',
      attr: { type: 'button' }
    });
    next.disabled = end >= total;
    next.addEventListener('click', () => {
      this.isbnInventoryPage += 1;
      this.render();
    });
  }

  /** Resolves assignment IDs only for display; the ISBN Markdown record remains authoritative. */
  private assignmentLabel(record: CatalogRecord): string {
    const editionId = record.fields['edition-id'];
    if (typeof editionId !== 'string') return 'Unassigned';
    const edition = this.catalog.recordById(editionId);
    if (edition === undefined) return 'Assigned edition unavailable';
    const bookId = edition.fields['book-id'];
    const book = typeof bookId === 'string' ? this.catalog.recordById(bookId) : undefined;
    const formatId = record.fields['format-id'];
    const format = typeof formatId === 'string' ? this.catalog.recordById(formatId) : undefined;
    const editionLabel = `${String(edition.fields.type)} edition`;
    const bookLabel = typeof book?.fields.title === 'string' ? book.fields.title : 'Unnamed book';
    return `${bookLabel} · ${editionLabel}${format === undefined ? '' : ` · ${String(format.fields.kind)}`}`;
  }

  /** Uses locale-aware numeric collation so ISBN 978...100 sorts before ISBN 978...20. */
  private compareInventoryRows(left: CatalogRecord, right: CatalogRecord): number {
    const value = (record: CatalogRecord): string => {
      if (this.isbnInventorySortField === 'status') return readableStatus(record.fields.status);
      if (this.isbnInventorySortField === 'assignment') return this.assignmentLabel(record);
      if (this.isbnInventorySortField === 'publisher') return publisherLabel(record);
      return String(record.fields.value);
    };
    const comparison = value(left).localeCompare(value(right), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
    return this.isbnInventorySortDirection === 'asc' ? comparison : -comparison;
  }

  /** Filters only the rendered projection; it never alters ISBN status or primary-key history. */
  private matchesInventoryFilter(record: CatalogRecord): boolean {
    if (this.isbnInventoryFilter === 'all') return true;
    const isFree = record.fields.status === 'available';
    return this.isbnInventoryFilter === 'free' ? isFree : !isFree;
  }
}

/** Converts stored lifecycle tokens into a concise, readable inventory label. */
function readableStatus(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : 'Unknown';
}

/** Avoids a visually noisy empty column while retaining optional provenance when it exists. */
function publisherLabel(record: CatalogRecord): string {
  const parts = [record.fields.publisher, record.fields.imprint].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Keeps externally supplied select values from altering the fixed, reviewed sort options. */
function isIsbnInventorySortField(value: string): value is IsbnInventorySortField {
  return ['isbn', 'status', 'assignment', 'publisher'].includes(value);
}

/** Keeps externally supplied select values from widening the availability filter's meaning. */
function isIsbnInventoryFilter(value: string): value is IsbnInventoryFilter {
  return ['all', 'free', 'allocated'].includes(value);
}
