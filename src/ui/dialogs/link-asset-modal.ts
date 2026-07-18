/** Native accessible forms for linking and relinking existing vault files by safe relative path. */
import { Modal, Notice, type App } from 'obsidian';
import type { AssetReferenceService } from '../../application/assets/asset-reference-service';
import { ASSET_ROLES, type AssetRole } from '../../domain/assets/asset-reference';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { VaultPath } from '../../domain/storage/vault-path';

export class LinkAssetModal extends Modal {
  public constructor(
    app: App,
    private readonly assets: AssetReferenceService,
    private readonly book: CatalogRecord,
    private readonly editions: readonly CatalogRecord[],
    private readonly formats: readonly CatalogRecord[],
    private readonly onLinked: () => void
  ) {
    super(app);
  }

  public override onOpen(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: 'Link existing production asset' });
    root.createEl('p', {
      text: 'Enter an existing vault-relative path. Publishing manager records the reference and metadata evidence; it does not copy or move the file.'
    });
    const form = root.createEl('form', { cls: 'pm-form' });
    const path = textField(form, 'Vault-relative file path', 'Production/Book/cover.psd');
    const roleLabel = form.createEl('label', { cls: 'pm-field' });
    roleLabel.createSpan({ text: 'Asset role' });
    const role = roleLabel.createEl('select');
    for (const value of ASSET_ROLES) role.createEl('option', { value, text: label(value) });
    const editionLabel = form.createEl('label', { cls: 'pm-field' });
    editionLabel.createSpan({ text: 'Edition (optional)' });
    const edition = editionLabel.createEl('select');
    edition.createEl('option', { value: '', text: 'Book-level asset' });
    for (const record of this.editions)
      edition.createEl('option', {
        value: record.id,
        text: `${String(record.fields.type)} · revision ${String(record.fields.revision)}`
      });
    const formatLabel = form.createEl('label', { cls: 'pm-field' });
    formatLabel.createSpan({ text: 'Format (optional)' });
    const format = formatLabel.createEl('select');
    const populateFormats = () => {
      format.empty();
      format.createEl('option', { value: '', text: 'No format link' });
      for (const record of this.formats.filter(
        (candidate) => candidate.fields['edition-id'] === edition.value
      ))
        format.createEl('option', {
          value: record.id,
          text: String(record.fields.label ?? record.fields.kind)
        });
    };
    edition.addEventListener('change', populateFormats);
    populateFormats();
    const sourceFingerprint = textField(form, 'Source fingerprint (optional)', 'compiler-source:…');
    const notes = textArea(form, 'Notes (optional)');
    const externalLabel = form.createEl('label', { cls: 'pm-checkbox-row' });
    const external = externalLabel.createEl('input', { type: 'checkbox' });
    externalLabel.createSpan({
      text: 'Externally managed — report evidence without claiming production currency'
    });
    const error = form.createDiv({
      cls: 'pm-inline-alert',
      attr: { role: 'alert', 'aria-live': 'polite' }
    });
    const actions = form.createDiv({ cls: 'pm-action-row' });
    const cancel = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Cancel',
      attr: { type: 'button' }
    });
    cancel.addEventListener('click', () => this.close());
    const submit = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Link existing file',
      attr: { type: 'submit' }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.empty();
      void this.assets
        .link({
          bookId: this.book.id,
          ...(edition.value === '' ? {} : { editionId: edition.value }),
          ...(format.value === '' ? {} : { formatId: format.value }),
          path: path.value,
          role: role.value as AssetRole,
          ...(sourceFingerprint.value.trim() === ''
            ? {}
            : { sourceFingerprint: sourceFingerprint.value.trim() }),
          ...(notes.value.trim() === '' ? {} : { notes: notes.value }),
          externallyManaged: external.checked
        })
        .then(() => {
          new Notice('Asset linked without copying the file.');
          this.onLinked();
          this.close();
        })
        .catch((cause: unknown) => {
          error.setText(cause instanceof Error ? cause.message : 'Asset could not be linked.');
          submit.disabled = false;
        });
    });
  }
}

export class RelinkAssetModal extends Modal {
  public constructor(
    app: App,
    private readonly assets: AssetReferenceService,
    private readonly recordPath: VaultPath,
    private readonly currentPath: string,
    private readonly onRelinked: () => void,
    private readonly proposedPath = currentPath
  ) {
    super(app);
  }
  public override onOpen(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl('h2', { text: 'Relink production asset' });
    root.createEl('p', { text: `Current reference: ${this.currentPath}` });
    const form = root.createEl('form', { cls: 'pm-form' });
    const path = textField(form, 'New existing vault-relative path', this.proposedPath);
    const error = form.createDiv({ cls: 'pm-inline-alert', attr: { role: 'alert' } });
    const submit = form.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Validate and relink',
      attr: { type: 'submit' }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit.disabled = true;
      void this.assets
        .relink(this.recordPath, path.value)
        .then(() => {
          new Notice('Asset reference relinked.');
          this.onRelinked();
          this.close();
        })
        .catch((cause: unknown) => {
          error.setText(cause instanceof Error ? cause.message : 'Relink failed.');
          submit.disabled = false;
        });
    });
  }
}

function textField(parent: HTMLElement, label: string, placeholder: string): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('input', { type: 'text', placeholder });
}
function textArea(parent: HTMLElement, label: string): HTMLTextAreaElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('textarea', { attr: { rows: '4' } });
}
function label(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
