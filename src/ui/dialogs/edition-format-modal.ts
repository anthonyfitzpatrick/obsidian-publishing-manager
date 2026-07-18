/**
 * Captures one print, digital, or audio format record without reading or copying the referenced
 * vault file. Accessibility and format-specific metadata use explicit key/value lines so the
 * resulting Markdown remains human-readable and can be extended without a hidden binary model.
 */

import { Modal, type App } from 'obsidian';

import type { EditionProjectService } from '../../application/editions/edition-project-service';
import {
  FORMAT_CATEGORIES,
  isFormatCategory,
  mediumSupportsFormat,
  type EditionMedium,
  type FormatCategory
} from '../../domain/editions/edition-project';

/** Focused add-format workflow launched from one selected edition detail pane. */
export class EditionFormatModal extends Modal {
  public constructor(
    app: App,
    private readonly service: EditionProjectService,
    private readonly editionId: string,
    private readonly editionMedium: EditionMedium,
    private readonly onSaved: () => void
  ) {
    super(app);
  }

  /** Renders compatible categories only and keeps every field keyboard reachable. */
  public override onOpen(): void {
    this.setTitle('Add edition format');
    const content = this.contentEl;
    content.addClass('publishing-manager', 'pm-edition-modal');
    const form = content.createEl('form', { cls: 'pm-form-grid' });
    const category = createSelect(
      form,
      'Format category',
      FORMAT_CATEGORIES.filter((value) => mediumSupportsFormat(this.editionMedium, value))
    );
    const kind = createInput(form, 'Stable format kind', 'epub');
    const label = createInput(form, 'Display label', 'Accessible EPUB');
    const filePath = createInput(form, 'Vault file path', 'Publishing Assets/book.epub');
    const accessibility = createArea(
      form,
      'Accessibility metadata',
      'One “label = value” entry per line, such as conforms-to = EPUB Accessibility 1.1.'
    );
    const metadata = createArea(
      form,
      'Format metadata',
      'One “label = value” entry per line, such as profile = reflowable.'
    );
    const error = form.createDiv({
      cls: 'publishing-manager-form-error pm-field--wide',
      attr: { role: 'alert', 'aria-live': 'polite' }
    });
    const actions = form.createDiv({ cls: 'pm-action-row pm-field--wide' });
    const cancel = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Cancel',
      attr: { type: 'button' }
    });
    const save = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Add format',
      attr: { type: 'submit' }
    });
    cancel.addEventListener('click', () => this.close());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      error.empty();
      save.disabled = true;
      void this.submit(
        category.value,
        kind.value,
        label.value,
        filePath.value,
        accessibility.value,
        metadata.value
      ).catch((failure: unknown) => {
        error.setText(failure instanceof Error ? failure.message : 'Format could not be added.');
        save.disabled = false;
      });
    });
    window.setTimeout(() => kind.focus(), 0);
  }

  /** Removes generated controls after close while leaving canonical records untouched. */
  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Parses maps and persists one format only after native control values are valid. */
  private async submit(
    category: string,
    kind: string,
    label: string,
    filePath: string,
    accessibility: string,
    metadata: string
  ): Promise<void> {
    if (!isFormatCategory(category)) throw new Error('Choose a valid format category.');
    await this.service.createFormat({
      editionId: this.editionId,
      category,
      kind,
      ...(label.length === 0 ? {} : { label }),
      ...(filePath.length === 0 ? {} : { filePath }),
      accessibility: parseMap(accessibility),
      metadata: parseMap(metadata)
    });
    this.onSaved();
    this.close();
  }
}

/** Creates one labelled text input with example-only placeholder content. */
function createInput(parent: HTMLElement, label: string, placeholder: string): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('input', { type: 'text', attr: { placeholder } });
}

/** Creates the category selector from the edition-compatible subset. */
function createSelect(
  parent: HTMLElement,
  label: string,
  values: readonly FormatCategory[]
): HTMLSelectElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  const select = wrapper.createEl('select');
  for (const value of values) select.createEl('option', { value, text: capitalize(value) });
  return select;
}

/** Creates one full-width key/value textarea with visible parsing instructions. */
function createArea(parent: HTMLElement, label: string, description: string): HTMLTextAreaElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field pm-field--wide' });
  wrapper.createSpan({ text: label });
  const area = wrapper.createEl('textarea', { attr: { rows: '4' } });
  wrapper.createEl('small', { text: description });
  return area;
}

/** Parses deterministic key/value lines and refuses ambiguous or duplicate keys. */
function parseMap(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [index, raw] of value.split('\n').entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Line ${index + 1} must use “label = value”.`);
    const key = line.slice(0, separator).trim();
    const entry = line.slice(separator + 1).trim();
    if (key.length === 0 || entry.length === 0) {
      throw new Error(`Line ${index + 1} needs both a label and value.`);
    }
    if (result[key] !== undefined) throw new Error(`Label “${key}” appears more than once.`);
    result[key] = entry;
  }
  return result;
}

/** Capitalizes a stable one-word category for display only. */
function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}
