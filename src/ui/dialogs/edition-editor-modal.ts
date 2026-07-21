/**
 * Renders the focused create/edit edition workflow with conditional print and audio controls. The
 * modal keeps stable type/media identity read-only during edits, validates through the application
 * service, and displays all failure text inside the dialog without discarding entered values.
 */

import { Modal, type App } from 'obsidian';

import type {
  CreateEditionInput,
  EditEditionInput,
  EditionProjectService
} from '../../application/editions/edition-project-service';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import {
  EDITION_MEDIA,
  EDITION_STATUSES,
  EDITION_TYPES,
  defaultMediumFor,
  isEditionMedium,
  isEditionStatus,
  isEditionType,
  type EditionMedium
} from '../../domain/editions/edition-project';

interface ConditionalControls {
  readonly trimWidth?: HTMLInputElement;
  readonly trimHeight?: HTMLInputElement;
  readonly trimUnit?: HTMLSelectElement;
  readonly pageCount?: HTMLInputElement;
  readonly narrator?: HTMLInputElement;
  readonly duration?: HTMLInputElement;
  readonly audioMetadata?: HTMLTextAreaElement;
}

/** Native modal used by the Project publishing-item master/detail actions. */
export class EditionEditorModal extends Modal {
  public constructor(
    app: App,
    private readonly service: EditionProjectService,
    private readonly bookId: string,
    private readonly existing: CatalogRecord | undefined,
    private readonly onSaved: (editionId: string) => void
  ) {
    super(app);
  }

  /** Builds one labelled form and focuses the first editable field. */
  public override onOpen(): void {
    this.setTitle(this.existing === undefined ? 'Add publishing item' : 'Edit publishing item');
    const content = this.contentEl;
    content.addClass('publishing-manager', 'pm-edition-modal');
    const form = content.createEl('form', { cls: 'pm-form-grid' });
    const type = createSelect(
      form,
      'Publishing item type',
      EDITION_TYPES,
      currentString(this.existing, 'type', 'paperback')
    );
    const customType = createText(
      form,
      'Custom type name',
      currentString(this.existing, 'custom-type')
    );
    const medium = createSelect(
      form,
      'Media category',
      EDITION_MEDIA,
      currentString(this.existing, 'medium', 'print')
    );
    if (this.existing !== undefined) {
      type.disabled = true;
      medium.disabled = true;
    }
    const status = createSelect(
      form,
      'Status',
      EDITION_STATUSES,
      currentString(this.existing, 'status', 'planned')
    );
    const publicationDate = createInput(
      form,
      'Publication date',
      'date',
      currentString(this.existing, 'publication-date')
    );
    const cover = createText(form, 'Cover vault path', currentString(this.existing, 'cover'));
    const retailLinks = createArea(
      form,
      'Retail links',
      mapToLines(currentMap(this.existing, 'retail-links')),
      'One “label = URL” entry per line.'
    );
    const notes = createArea(
      form,
      'Publishing item notes',
      currentString(this.existing, 'notes'),
      'Up to 8,000 characters.'
    );
    const conditional = form.createDiv({ cls: 'pm-form-grid pm-field--wide' });
    let conditionalControls = renderConditional(
      conditional,
      currentMedium(medium.value),
      this.existing
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
      text: this.existing === undefined ? 'Create publishing item' : 'Save publishing item',
      attr: { type: 'submit' }
    });

    const updateType = () => {
      if (!isEditionType(type.value)) return;
      const preset = defaultMediumFor(type.value);
      medium.disabled = this.existing !== undefined || preset !== undefined;
      if (preset !== undefined) medium.value = preset;
      customType
        .closest<HTMLElement>('.pm-field')
        ?.toggleClass('is-hidden', type.value !== 'custom');
      conditional.empty();
      conditionalControls = renderConditional(conditional, currentMedium(medium.value), undefined);
    };
    type.addEventListener('change', updateType);
    medium.addEventListener('change', () => {
      conditional.empty();
      conditionalControls = renderConditional(conditional, currentMedium(medium.value), undefined);
    });
    updateType();
    if (this.existing !== undefined) {
      conditional.empty();
      conditionalControls = renderConditional(
        conditional,
        currentMedium(medium.value),
        this.existing
      );
    }

    cancel.addEventListener('click', () => this.close());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      error.empty();
      save.disabled = true;
      void this.submit({
        type,
        customType,
        medium,
        status,
        publicationDate,
        cover,
        retailLinks,
        notes,
        conditional: conditionalControls
      }).catch((failure: unknown) => {
        error.setText(failure instanceof Error ? failure.message : 'Edition could not be saved.');
        save.disabled = false;
      });
    });
    window.setTimeout(() => (this.existing === undefined ? type : status).focus(), 0);
  }

  /** Clears generated controls so reopening always starts from canonical state. */
  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Converts native controls to typed application input and closes only after persistence succeeds. */
  private async submit(controls: {
    readonly type: HTMLSelectElement;
    readonly customType: HTMLInputElement;
    readonly medium: HTMLSelectElement;
    readonly status: HTMLSelectElement;
    readonly publicationDate: HTMLInputElement;
    readonly cover: HTMLInputElement;
    readonly retailLinks: HTMLTextAreaElement;
    readonly notes: HTMLTextAreaElement;
    readonly conditional: ConditionalControls;
  }): Promise<void> {
    if (
      !isEditionType(controls.type.value) ||
      !isEditionMedium(controls.medium.value) ||
      !isEditionStatus(controls.status.value)
    ) {
      throw new Error('Choose a valid edition type, media category, and status.');
    }
    const shared = {
      customType: optionalText(controls.customType.value),
      status: controls.status.value,
      publicationDate: optionalText(controls.publicationDate.value),
      cover: optionalText(controls.cover.value),
      retailLinks: linesToMap(controls.retailLinks.value),
      notes: optionalText(controls.notes.value),
      trimWidth: optionalText(controls.conditional.trimWidth?.value ?? ''),
      trimHeight: optionalText(controls.conditional.trimHeight?.value ?? ''),
      trimUnit: optionalTrimUnit(controls.conditional.trimUnit?.value),
      pageCount: optionalPositiveInteger(controls.conditional.pageCount?.value),
      narrator: optionalText(controls.conditional.narrator?.value ?? ''),
      durationMinutes: optionalPositiveInteger(controls.conditional.duration?.value),
      audioMetadata: linesToMap(controls.conditional.audioMetadata?.value ?? '')
    };
    let editionId: string;
    if (this.existing === undefined) {
      const input: CreateEditionInput = {
        bookId: this.bookId,
        type: controls.type.value,
        medium: controls.medium.value,
        status: shared.status,
        retailLinks: shared.retailLinks,
        audioMetadata: shared.audioMetadata,
        ...(shared.customType === undefined ? {} : { customType: shared.customType }),
        ...(shared.publicationDate === undefined
          ? {}
          : { publicationDate: shared.publicationDate }),
        ...(shared.cover === undefined ? {} : { cover: shared.cover }),
        ...(shared.notes === undefined ? {} : { notes: shared.notes }),
        ...(shared.trimWidth === undefined ? {} : { trimWidth: shared.trimWidth }),
        ...(shared.trimHeight === undefined ? {} : { trimHeight: shared.trimHeight }),
        ...(shared.trimUnit === undefined ? {} : { trimUnit: shared.trimUnit }),
        ...(shared.pageCount === undefined ? {} : { pageCount: shared.pageCount }),
        ...(shared.narrator === undefined ? {} : { narrator: shared.narrator }),
        ...(shared.durationMinutes === undefined ? {} : { durationMinutes: shared.durationMinutes })
      };
      editionId = (await this.service.create(input)).edition.id;
    } else {
      const input: EditEditionInput = {
        ...shared,
        customType: shared.customType,
        publicationDate: shared.publicationDate,
        cover: shared.cover,
        notes: shared.notes,
        trimWidth: shared.trimWidth,
        trimHeight: shared.trimHeight,
        trimUnit: shared.trimUnit,
        pageCount: shared.pageCount,
        narrator: shared.narrator,
        durationMinutes: shared.durationMinutes
      };
      editionId = (await this.service.edit(this.existing.path, input)).edition.id;
    }
    this.onSaved(editionId);
    this.close();
  }
}

/** Renders only fields meaningful to the selected stable media category. */
function renderConditional(
  parent: HTMLElement,
  medium: EditionMedium,
  existing: CatalogRecord | undefined
): ConditionalControls {
  const print = medium === 'print' || medium === 'mixed';
  const audio = medium === 'audio' || medium === 'mixed';
  const controls: {
    trimWidth?: HTMLInputElement;
    trimHeight?: HTMLInputElement;
    trimUnit?: HTMLSelectElement;
    pageCount?: HTMLInputElement;
    narrator?: HTMLInputElement;
    duration?: HTMLInputElement;
    audioMetadata?: HTMLTextAreaElement;
  } = {};
  if (print) {
    parent.createEl('h3', { cls: 'pm-field--wide', text: 'Print details' });
    controls.trimWidth = createInput(
      parent,
      'Trim width',
      'text',
      currentString(existing, 'trim-width')
    );
    controls.trimHeight = createInput(
      parent,
      'Trim height',
      'text',
      currentString(existing, 'trim-height')
    );
    controls.trimUnit = createSelect(
      parent,
      'Trim unit',
      ['mm', 'in'] as const,
      currentString(existing, 'trim-unit', 'mm')
    );
    controls.pageCount = createInput(
      parent,
      'Page count',
      'number',
      currentNumber(existing, 'page-count')
    );
  }
  if (audio) {
    parent.createEl('h3', { cls: 'pm-field--wide', text: 'Audio details' });
    controls.narrator = createText(parent, 'Narrator', currentString(existing, 'narrator'));
    controls.duration = createInput(
      parent,
      'Duration in minutes',
      'number',
      currentNumber(existing, 'duration-minutes')
    );
    controls.audioMetadata = createArea(
      parent,
      'Audio metadata',
      mapToLines(currentMap(existing, 'audio-metadata')),
      'One “label = value” entry per line.'
    );
  }
  if (medium === 'digital' || medium === 'mixed') {
    const message = parent.createDiv({ cls: 'pm-validation-summary pm-field--wide' });
    message.createEl('strong', { text: 'Digital production details' });
    message.createEl('p', {
      text: 'Add each epub, PDF, HTML, or other digital output as a format record with its own accessibility metadata.'
    });
  }
  return controls;
}

/** Creates one labelled text field with native browser semantics. */
function createText(parent: HTMLElement, label: string, value = ''): HTMLInputElement {
  return createInput(parent, label, 'text', value);
}

/** Creates one labelled input and returns the native control for submission/focus. */
function createInput(
  parent: HTMLElement,
  label: string,
  type: 'date' | 'number' | 'text',
  value = ''
): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('input', { type, value });
}

/** Creates one labelled stable-vocabulary selector. */
function createSelect<T extends string>(
  parent: HTMLElement,
  label: string,
  values: readonly T[],
  selected: string
): HTMLSelectElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  const select = wrapper.createEl('select');
  for (const value of values) {
    select.createEl('option', {
      value,
      text: value
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      attr: value === selected ? { selected: 'true' } : {}
    });
  }
  return select;
}

/** Creates one full-width labelled textarea plus concise parsing guidance. */
function createArea(
  parent: HTMLElement,
  label: string,
  value: string,
  description: string
): HTMLTextAreaElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field pm-field--wide' });
  wrapper.createSpan({ text: label });
  const area = wrapper.createEl('textarea', { text: value, attr: { rows: '4' } });
  wrapper.createEl('small', { text: description });
  return area;
}

/** Reads a string projection without trusting malformed external field types. */
function currentString(record: CatalogRecord | undefined, field: string, fallback = ''): string {
  const value = record?.fields[field];
  return typeof value === 'string' ? value : fallback;
}

/** Reads a numeric projection as form text without coercing invalid external values. */
function currentNumber(record: CatalogRecord | undefined, field: string): string {
  const value = record?.fields[field];
  return typeof value === 'number' ? String(value) : '';
}

/** Reads only human-readable object maps from a catalog projection. */
function currentMap(
  record: CatalogRecord | undefined,
  field: string
): Readonly<Record<string, string>> {
  const value = record?.fields[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

/** Narrows the selected medium and falls back only for an impossible native selector state. */
function currentMedium(value: string): EditionMedium {
  return isEditionMedium(value) ? value : 'print';
}

/** Converts deterministic maps to editable `key = value` lines. */
function mapToLines(map: Readonly<Record<string, string>>): string {
  return Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');
}

/** Parses human-readable lines and rejects duplicates or ambiguous missing separators. */
function linesToMap(value: string): Readonly<Record<string, string>> {
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

/** Converts blank optional controls to absence while preserving intentional internal spaces. */
function optionalText(value: string): string | undefined {
  return value.length === 0 ? undefined : value;
}

/** Parses optional positive whole numbers without accepting decimal or negative values. */
function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error('Number fields must be positive whole numbers.');
  return parsed;
}

/** Narrows the native trim selector without trusting arbitrary DOM mutation. */
function optionalTrimUnit(value: string | undefined): 'in' | 'mm' | undefined {
  return value === 'in' || value === 'mm' ? value : undefined;
}
