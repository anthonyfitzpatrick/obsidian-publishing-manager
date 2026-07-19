/** Native TPL-001–TPL-005 library for safe copies, variable previews, imports, and exports. */
import { ItemView, Notice, TFile, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { TemplateProjectService } from '../../application/templates/template-project-service';
import type { BookCatalog, BookCatalogSubscriber } from '../../application/catalog/book-catalog';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type {
  PublishingTemplate,
  TemplateResolutionPreview
} from '../../domain/templates/publishing-template';

export const TEMPLATE_LIBRARY_VIEW_TYPE = 'publishing-manager-template-library';

export class TemplateLibraryView extends ItemView {
  private unsubscribe?: () => void;
  private importSource = '';
  private readonly supplied = new Map<string, Record<string, unknown>>();
  private readonly previews = new Map<string, TemplateResolutionPreview>();
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly templates: TemplateProjectService
  ) {
    super(leaf);
    this.icon = 'layout-template';
    this.navigation = true;
  }
  public getViewType(): string {
    return TEMPLATE_LIBRARY_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'Publishing templates';
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
    root.addClass('publishing-manager', 'pm-template-library');
    const heading = root.createDiv({ cls: 'pm-section-heading' });
    const title = heading.createDiv();
    title.createEl('p', { cls: 'pm-eyebrow', text: 'Versioned · local · inert data' });
    title.createEl('h2', { text: 'Publishing templates' });
    title.createEl('p', {
      text: 'Copy bundled templates before editing. Preview resolves data variables only; templates cannot run scripts, commands, requests, or network actions.'
    });
    this.renderImport(root);
    this.renderBundled(root);
    this.renderInstalled(root);
  }

  private renderImport(parent: HTMLElement): void {
    const details = parent.createEl('details', { cls: 'pm-panel' });
    details.createEl('summary', { text: 'Import portable template JSON' });
    details.createEl('p', {
      text: 'Import is limited to 256 KiB, validates schema and limits, rejects executable fields, and excludes private instance content.'
    });
    const label = details.createEl('label', { cls: 'pm-field' });
    label.createSpan({ text: 'Portable template JSON' });
    const input = label.createEl('textarea', {
      value: this.importSource,
      attr: { rows: '10', spellcheck: 'false' }
    });
    input.addEventListener('change', () => {
      this.importSource = input.value;
    });
    const button = details.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Validate and import',
      attr: { type: 'button' }
    });
    button.addEventListener('click', () => {
      this.importSource = input.value;
      void this.templates
        .importJson(this.importSource)
        .then(({ record, excludedPrivateFields }) => {
          this.importSource = '';
          new Notice(
            excludedPrivateFields.length === 0
              ? `Imported ${String(record.fields.name)}.`
              : `Imported after excluding private fields: ${excludedPrivateFields.join(', ')}.`
          );
        })
        .catch((cause: unknown) => new Notice(message(cause)));
    });
  }

  private renderBundled(parent: HTMLElement): void {
    const section = parent.createEl('section', { cls: 'pm-panel' });
    section.createEl('h3', { text: `Bundled starters · ${this.templates.bundled.length}` });
    section.createEl('p', {
      text: 'Bundled definitions are read-only. Copying creates an ordinary user-owned Markdown template under Publishing Manager/Templates.'
    });
    const list = section.createEl('ul');
    for (const template of this.templates.bundled) {
      const item = list.createEl('li', { cls: 'pm-panel' });
      item.createEl('strong', {
        text: `${template.kind} · ${template.name} · v${template.version}`
      });
      if (template.description !== undefined) item.createEl('p', { text: template.description });
      const copy = item.createEl('button', {
        cls: 'pm-button pm-button--quiet',
        text: 'Copy into vault',
        attr: { type: 'button' }
      });
      copy.addEventListener('click', () => {
        void this.templates
          .copyBundled(template.templateId)
          .then(() => new Notice('Editable template copy created.'))
          .catch((cause: unknown) => new Notice(message(cause)));
      });
    }
  }

  private renderInstalled(parent: HTMLElement): void {
    const records = this.templates.installed();
    const section = parent.createEl('section', { cls: 'pm-panel' });
    section.createEl('h3', { text: `Installed templates · ${records.length}` });
    if (records.length === 0) {
      section.createEl('p', {
        cls: 'pm-muted',
        text: 'No editable templates. Copy or import one.'
      });
      return;
    }
    const list = section.createEl('ol');
    for (const record of records) {
      try {
        this.renderInstalledTemplate(list, record);
      } catch (cause) {
        const item = list.createEl('li', { cls: 'pm-panel' });
        item.createEl('strong', { text: 'Invalid template record' });
        item.createEl('p', { text: message(cause), attr: { role: 'alert' } });
        const open = button(item, 'Open Markdown to repair');
        open.addEventListener('click', () => {
          void this.openNote(record).catch((error: unknown) => new Notice(message(error)));
        });
      }
    }
  }

  private renderInstalledTemplate(parent: HTMLElement, record: CatalogRecord): void {
    const template = this.templates.template(record.id);
    const item = parent.createEl('li', { cls: 'pm-panel' });
    item.createEl('strong', { text: `${template.kind} · ${template.name} · v${template.version}` });
    item.createEl('p', {
      text: `Source: ${String(record.fields.source)} · Required fields: ${template.requiredFields.join(', ')}`
    });
    const actions = item.createDiv({ cls: 'pm-action-row' });
    const open = button(actions, 'Open editable Markdown');
    open.addEventListener('click', () => {
      void this.openNote(record).catch((cause: unknown) => new Notice(message(cause)));
    });
    const exportButton = button(actions, 'Export portable JSON');
    exportButton.addEventListener('click', () => {
      void this.templates
        .exportJson(record.id)
        .then(
          ({ path, excludedPrivateFields }) =>
            new Notice(
              excludedPrivateFields.length === 0
                ? `Exported ${path}.`
                : `Exported ${path}; excluded ${excludedPrivateFields.join(', ')}.`
            )
        )
        .catch((cause: unknown) => new Notice(message(cause)));
    });
    this.renderPreview(item, record, template);
  }

  private renderPreview(
    parent: HTMLElement,
    record: CatalogRecord,
    template: PublishingTemplate
  ): void {
    const details = parent.createEl('details');
    details.open = this.previews.has(record.id);
    details.createEl('summary', { text: 'Resolve variables and preview data' });
    details.createEl('p', {
      text: 'Only unresolved variables are requested. Preview creates no book, edition, task, target, metadata, launch, price, or checklist record.'
    });
    const values = this.supplied.get(record.id) ?? {};
    this.supplied.set(record.id, values);
    const grid = details.createDiv({ cls: 'pm-form-grid' });
    const unresolvedRequired = template.variables.filter(
      ({ required, default: defaultValue }) => required && defaultValue === undefined
    );
    for (const variable of unresolvedRequired) renderVariableControl(grid, variable, values, true);
    const overrides = template.variables.filter(
      ({ required, default: defaultValue }) => !required || defaultValue !== undefined
    );
    if (overrides.length > 0) {
      const optional = details.createEl('details');
      optional.createEl('summary', { text: 'Optional and default-value overrides' });
      const optionalGrid = optional.createDiv({ cls: 'pm-form-grid' });
      for (const variable of overrides)
        renderVariableControl(optionalGrid, variable, values, false);
    }
    const previewButton = button(details, 'Preview resolved data', true);
    previewButton.addEventListener('click', () => {
      try {
        this.previews.set(record.id, this.templates.preview(record.id, values));
        this.render();
      } catch (cause) {
        new Notice(message(cause));
      }
    });
    const preview = this.previews.get(record.id);
    if (preview === undefined) return;
    const result = details.createDiv({ attr: { 'aria-live': 'polite' } });
    result.createEl('p', {
      text: preview.canApply
        ? 'Preview complete. Responsible creation workflows may consume these resolved values.'
        : `Preview incomplete. Unresolved: ${[...preview.unresolvedVariables, ...preview.missingRequiredFields].join(', ') || 'invalid value'}.`
    });
    for (const warning of preview.warnings) result.createEl('p', { text: `Warning: ${warning}` });
    result.createEl('pre', { text: JSON.stringify(preview.resolvedDefaults, null, 2) });
  }

  private async openNote(record: CatalogRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile)) throw new Error('Template note is unavailable.');
    await this.app.workspace.getLeaf(true).openFile(file);
  }
}

/** Registers one reusable library leaf plus explicit ribbon and command entry points. */
export function registerTemplateLibraryView(
  plugin: Plugin,
  catalog: BookCatalog,
  templates: TemplateProjectService
): void {
  plugin.registerView(
    TEMPLATE_LIBRARY_VIEW_TYPE,
    (leaf) => new TemplateLibraryView(leaf, catalog, templates)
  );
  const open = async () => {
    const leaf =
      plugin.app.workspace.getLeavesOfType(TEMPLATE_LIBRARY_VIEW_TYPE)[0] ??
      plugin.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: TEMPLATE_LIBRARY_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  plugin.addRibbonIcon('layout-template', 'Open publishing templates', () => void open());
  plugin.addCommand({
    id: 'open-template-library',
    name: 'Open template library',
    callback: () => void open()
  });
  plugin.register(() => plugin.app.workspace.detachLeavesOfType(TEMPLATE_LIBRARY_VIEW_TYPE));
}

function button(parent: HTMLElement, text: string, primary = false): HTMLButtonElement {
  return parent.createEl('button', {
    cls: `pm-button ${primary ? 'pm-button--primary' : 'pm-button--quiet'}`,
    text,
    attr: { type: 'button' }
  });
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Template operation failed.';
}
function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : 'Structured value';
}
function renderVariableControl(
  parent: HTMLElement,
  variable: PublishingTemplate['variables'][number],
  values: Record<string, unknown>,
  required: boolean
): void {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: `${variable.label}${required ? ' · required' : ''}` });
  const control = label.createEl('input', {
    value: values[variable.name] === undefined ? '' : scalarText(values[variable.name]),
    attr: {
      type:
        variable.type === 'date'
          ? 'date'
          : variable.type === 'integer' || variable.type === 'number'
            ? 'number'
            : 'text',
      placeholder:
        variable.default === undefined ? 'Optional' : `Default: ${scalarText(variable.default)}`
    }
  });
  control.addEventListener('change', () => {
    if (control.value) values[variable.name] = control.value;
    else delete values[variable.name];
  });
}
