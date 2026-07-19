/**
 * Native EXP-001–EXP-008 Export Center. Every control leads to a complete text preview before the
 * single local create action; no control can overwrite a file or read a linked binary asset.
 */
import { ItemView, Notice, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { BookCatalog, BookCatalogSubscriber } from '../../application/catalog/book-catalog';
import type {
  PublishingExportPreview,
  PublishingExportRequest,
  PublishingExportService
} from '../../application/exports/publishing-export-service';
import type {
  PublishingCsvDataset,
  PublishingExportFormat
} from '../../domain/exports/publishing-export';

export const PUBLISHING_EXPORT_VIEW_TYPE = 'publishing-manager-export-center';

interface ExportViewState {
  bookId: string;
  format: PublishingExportFormat;
  csvDataset: PublishingCsvDataset;
  includeSensitive: boolean;
  preview?: PublishingExportPreview;
  working: boolean;
}

export class PublishingExportView extends ItemView {
  private unsubscribe?: () => void;
  private readonly state: ExportViewState = {
    bookId: '',
    format: 'markdown',
    csvDataset: 'tasks',
    includeSensitive: false,
    working: false
  };

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly exports: PublishingExportService
  ) {
    super(leaf);
    this.icon = 'file-output';
    this.navigation = true;
  }

  public getViewType(): string {
    return PUBLISHING_EXPORT_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return 'Publishing exports';
  }

  public override async onOpen(): Promise<void> {
    const subscriber: BookCatalogSubscriber = () => this.render();
    this.unsubscribe = this.catalog.subscribe(subscriber);
    this.render();
  }

  public override async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-export-center');
    const heading = root.createDiv({ cls: 'pm-section-heading' }).createDiv();
    heading.createEl('p', { cls: 'pm-eyebrow', text: 'Previewed · deterministic · local' });
    heading.createEl('h2', { text: 'Publishing exports' });
    heading.createEl('p', {
      text: 'Create portable text snapshots without changing canonical notes. Every target, warning, sensitive field, unresolved relationship, collision, and linked binary reference is shown before export.'
    });
    this.renderPlanner(root);
    if (this.state.preview !== undefined) this.renderPreview(root, this.state.preview);
  }

  private renderPlanner(parent: HTMLElement): void {
    const section = parent.createEl('section', { cls: 'pm-panel' });
    section.createEl('h3', { text: 'Plan one export file' });
    const form = section.createEl('form', { cls: 'pm-form-grid' });
    const books = this.catalog.orderedBooks().filter(({ archived }) => !archived);
    const book = labelledSelect(
      form,
      'Book scope',
      books.map((record) => ({ value: record.id, label: String(record.fields.title) })),
      this.state.bookId,
      'Choose a book'
    );
    book.addEventListener('change', () => {
      this.state.bookId = book.value;
      delete this.state.preview;
    });
    const format = labelledSelect(
      form,
      'Export format',
      [
        { value: 'markdown', label: 'Markdown dossier and readiness' },
        { value: 'csv', label: 'CSV table' },
        { value: 'json', label: 'Versioned JSON project graph' },
        { value: 'ics', label: 'Local ICS schedule' }
      ],
      this.state.format
    );
    format.addEventListener('change', () => {
      this.state.format = format.value as PublishingExportFormat;
      delete this.state.preview;
      this.render();
    });
    if (this.state.format === 'csv') {
      const dataset = labelledSelect(
        form,
        'CSV table',
        this.exports.csvDatasets.map((value) => ({ value, label: csvLabel(value) })),
        this.state.csvDataset
      );
      dataset.addEventListener('change', () => {
        this.state.csvDataset = dataset.value as PublishingCsvDataset;
        delete this.state.preview;
      });
    }
    const sensitiveLabel = form.createEl('label', { cls: 'pm-field' });
    const sensitive = sensitiveLabel.createEl('input', { attr: { type: 'checkbox' } });
    sensitive.checked = this.state.includeSensitive;
    sensitiveLabel.appendText(' Include sensitive note fields in this export');
    sensitiveLabel.createEl('small', {
      text: 'Off by default. The preview always names fields that will be included or excluded.'
    });
    sensitive.addEventListener('change', () => {
      this.state.includeSensitive = sensitive.checked;
      delete this.state.preview;
    });
    const preview = form.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: this.state.working ? 'Building preview…' : 'Build exact preview',
      attr: { type: 'submit' }
    });
    preview.disabled = this.state.working || books.length === 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.buildPreview();
    });
    if (books.length === 0)
      section.createEl('p', { cls: 'pm-muted', text: 'Create an active book before exporting.' });
  }

  private renderPreview(parent: HTMLElement, preview: PublishingExportPreview): void {
    const section = parent.createEl('section', { cls: 'pm-panel' });
    section.createEl('h3', { text: 'Exact export preview' });
    const facts = section.createEl('dl', { cls: 'pm-export-facts' });
    fact(facts, 'Target', preview.target);
    fact(facts, 'Media type', preview.mediaType);
    fact(facts, 'Size', `${preview.byteLength.toLocaleString()} bytes`);
    fact(facts, 'Overwrite behavior', 'Never');
    fact(
      facts,
      'Existing-name collision',
      preview.collisionDetected ? 'Yes — suffixed target selected' : 'No'
    );
    fact(facts, 'Sensitive paths', String(preview.sensitiveFields.length));
    fact(facts, 'Unresolved relationships', String(preview.unresolvedReferences.length));
    fact(facts, 'Linked binary references', String(preview.linkedBinaryAssets.length));
    this.renderReport(section, 'Warnings', preview.warnings, 'No warnings.');
    this.renderReport(
      section,
      this.state.includeSensitive ? 'Sensitive fields included' : 'Sensitive fields excluded',
      preview.sensitiveFields,
      'No sensitive fields detected.'
    );
    this.renderReport(
      section,
      'Unresolved relationships',
      preview.unresolvedReferences,
      'All exported relationships resolve inside the snapshot.'
    );
    this.renderReport(
      section,
      'Linked binary assets',
      preview.linkedBinaryAssets,
      'No linked binary asset references.'
    );
    const content = section.createEl('details');
    content.open = true;
    content.createEl('summary', { text: 'Preview exact file content' });
    content.createEl('pre', { text: preview.content });
    const actions = section.createDiv({ cls: 'pm-action-row' });
    const apply = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: this.state.working ? 'Exporting…' : 'Create this local export',
      attr: { type: 'button' }
    });
    apply.disabled = this.state.working;
    apply.addEventListener('click', () => void this.applyPreview(preview));
    actions
      .createEl('button', {
        cls: 'pm-button pm-button--quiet',
        text: 'Discard preview',
        attr: { type: 'button' }
      })
      .addEventListener('click', () => {
        delete this.state.preview;
        this.render();
      });
  }

  private renderReport(
    parent: HTMLElement,
    title: string,
    values: readonly string[],
    empty: string
  ): void {
    const details = parent.createEl('details');
    details.createEl('summary', { text: `${title} · ${values.length}` });
    if (values.length === 0) details.createEl('p', { cls: 'pm-muted', text: empty });
    else {
      const list = details.createEl('ul');
      for (const value of values) list.createEl('li', { text: value });
    }
  }

  private async buildPreview(): Promise<void> {
    if (!this.state.bookId) {
      new Notice('Choose one book to export.');
      return;
    }
    this.state.working = true;
    this.render();
    const request: PublishingExportRequest = {
      bookId: this.state.bookId,
      format: this.state.format,
      ...(this.state.format === 'csv' ? { csvDataset: this.state.csvDataset } : {}),
      includeSensitive: this.state.includeSensitive
    };
    try {
      this.state.preview = await this.exports.preview(request);
    } catch (cause) {
      new Notice(message(cause));
      delete this.state.preview;
    } finally {
      this.state.working = false;
      this.render();
    }
  }

  private async applyPreview(preview: PublishingExportPreview): Promise<void> {
    this.state.working = true;
    this.render();
    try {
      const path = await this.exports.apply(preview);
      new Notice(`Created ${path}.`);
      delete this.state.preview;
    } catch (cause) {
      new Notice(message(cause));
    } finally {
      this.state.working = false;
      this.render();
    }
  }
}

export function registerPublishingExportView(
  plugin: Plugin,
  catalog: BookCatalog,
  exports: PublishingExportService
): void {
  plugin.registerView(
    PUBLISHING_EXPORT_VIEW_TYPE,
    (leaf) => new PublishingExportView(leaf, catalog, exports)
  );
  const open = async () => {
    const leaf =
      plugin.app.workspace.getLeavesOfType(PUBLISHING_EXPORT_VIEW_TYPE)[0] ??
      plugin.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PUBLISHING_EXPORT_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  plugin.addRibbonIcon('file-output', 'Open publishing exports', () => void open());
  plugin.addCommand({
    id: 'open-export-center',
    name: 'Open export center',
    callback: () => void open()
  });
  plugin.register(() => plugin.app.workspace.detachLeavesOfType(PUBLISHING_EXPORT_VIEW_TYPE));
}

function labelledSelect(
  parent: HTMLElement,
  labelText: string,
  options: readonly { readonly value: string; readonly label: string }[],
  selected: string,
  placeholder?: string
): HTMLSelectElement {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  const select = label.createEl('select');
  if (placeholder !== undefined) select.createEl('option', { value: '', text: placeholder });
  for (const option of options) {
    const element = select.createEl('option', { value: option.value, text: option.label });
    element.selected = option.value === selected;
  }
  return select;
}

function fact(parent: HTMLElement, label: string, value: string): void {
  parent.createEl('dt', { text: label });
  parent.createEl('dd', { text: value });
}

function csvLabel(value: PublishingCsvDataset): string {
  return value.replaceAll('-', ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Publishing export failed.';
}
