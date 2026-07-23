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
import type { IsbnProjectService } from '../../application/isbn/isbn-project-service';
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
import { COUNTRY_OPTIONS, countrySearchLabel } from '../country-options';

interface ConditionalControls {
  readonly trimWidth?: HTMLInputElement;
  readonly trimHeight?: HTMLInputElement;
  readonly trimUnit?: HTMLInputElement;
  readonly pageCount?: HTMLInputElement;
  readonly narrator?: HTMLInputElement;
  readonly duration?: HTMLInputElement;
  readonly audioMetadata?: HTMLTextAreaElement;
}

interface RetailLinksEditor {
  readonly read: () => Readonly<Record<string, string>>;
}

/** Native modal used by the Project publishing-item master/detail actions. */
export class EditionEditorModal extends Modal {
  public constructor(
    app: App,
    private readonly service: EditionProjectService,
    private readonly bookId: string,
    private readonly projectPath: string,
    private readonly projectCover: string | undefined,
    private readonly isbns: IsbnProjectService,
    private readonly isbnRecords: readonly CatalogRecord[],
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
    const countryVariant = form.createEl('label', { cls: 'pm-field' });
    countryVariant.createSpan({ text: 'Country variant' });
    const countryVariantSelect = countryVariant.createEl('select', { attr: { 'aria-label': 'Country variant' } });
    const currentCountryVariant = currentString(this.existing, 'country-variant', 'GLOBAL');
    for (const option of COUNTRY_OPTIONS) countryVariantSelect.createEl('option', {
      value: option.code,
      text: countrySearchLabel(option.code),
      attr: option.code === currentCountryVariant ? { selected: 'true' } : {}
    });
    const publicationDate = createInput(
      form,
      'Publication date',
      'date',
      currentString(this.existing, 'publication-date')
    );
    const updatePublicationDate = () => {
      const published = status.value === 'published';
      publicationDate.disabled = !published;
      publicationDate.closest<HTMLElement>('.pm-field')?.toggleClass('is-disabled', !published);
      publicationDate.setAttribute(
        'aria-describedby',
        published ? 'pm-publication-date-ready' : 'pm-publication-date-locked'
      );
    };
    const publicationDateHelp = form.createEl('small', {
      cls: 'pm-muted pm-field--wide',
      attr: { id: 'pm-publication-date-locked' },
      text: 'Publication date becomes available only when status is Published.'
    });
    const publicationDateReadyHelp = form.createEl('small', {
      cls: 'pm-muted pm-field--wide is-hidden',
      attr: { id: 'pm-publication-date-ready' },
      text: 'Record the confirmed publication date for this published item.'
    });
    const syncPublicationDateHelp = () => {
      updatePublicationDate();
      const published = status.value === 'published';
      publicationDateHelp.toggleClass('is-hidden', published);
      publicationDateReadyHelp.toggleClass('is-hidden', !published);
    };
    status.addEventListener('change', syncPublicationDateHelp);
    syncPublicationDateHelp();
    const currentIsbn = this.existing === undefined
      ? undefined
      : this.isbnRecords.find((record) => record.fields['edition-id'] === this.existing?.id);
    const isbn = createIsbnSelect(form, this.isbnRecords, currentIsbn?.id);
    const isbnGuidance = form.createEl('p', {
      cls: 'pm-muted pm-field--wide',
      text: currentIsbn === undefined
        ? 'Selecting an ISBN assigns it to this Publishing Item when it is saved. It then becomes unavailable to every other item.'
        : `This item is already assigned ISBN ${String(currentIsbn.fields.value)}. Use the guarded ISBN workflow to correct an assignment.`
    });
    isbn.disabled = currentIsbn !== undefined;
    let coverPath = currentString(this.existing, 'cover');
    const coverChoices = form.createEl('section', { cls: 'pm-cover-choices pm-field--wide' });
    coverChoices.createEl('h3', { text: 'Cover art' });
    coverChoices.createEl('p', {
      text: 'Choose the Project cover art or upload a separate cover for this Publishing Item.'
    });
    const coverActions = coverChoices.createDiv({ cls: 'pm-action-row' });
    const useProjectCover = coverActions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Use Project cover art',
      attr: { type: 'button' }
    });
    useProjectCover.disabled = this.projectCover === undefined;
    const uploadCover = coverActions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Upload new artwork',
      attr: { type: 'button' }
    });
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    picker.hidden = true;
    coverChoices.appendChild(picker);
    const coverState = coverChoices.createEl('p', {
      cls: 'pm-muted',
      attr: { 'aria-live': 'polite' }
    });
    const showCoverState = () => {
      if (coverPath.length === 0) coverState.setText('No cover selected.');
      else if (coverPath === this.projectCover) coverState.setText('Using the current Project cover art.');
      else coverState.setText('Using separately uploaded Publishing Item artwork.');
    };
    useProjectCover.addEventListener('click', () => {
      if (this.projectCover === undefined) return;
      coverPath = this.projectCover;
      showCoverState();
    });
    uploadCover.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
      const source = picker.files?.[0];
      if (source === undefined) return;
      uploadCover.disabled = true;
      coverState.setText('Preparing local cover artwork…');
      void this.storeLocalFile(source, 'item-cover')
        .then((path) => {
          coverPath = path;
          showCoverState();
        })
        .catch((cause: unknown) =>
          coverState.setText(cause instanceof Error ? cause.message : 'Could not prepare the cover artwork.')
        )
        .finally(() => {
          uploadCover.disabled = false;
          picker.value = '';
        });
    });
    showCoverState();
    let fullCoverPath = currentString(this.existing, 'full-cover');
    const fullCoverChoices = form.createEl('section', { cls: 'pm-cover-choices pm-field--wide' });
    fullCoverChoices.createEl('h3', { text: 'Full-wrap print cover' });
    fullCoverChoices.createEl('p', {
      text: 'Optional front, spine, and back artwork for paperback or hardcover production. This original file is kept separately from the front cover image.'
    });
    const uploadFullCover = fullCoverChoices.createEl('button', {
      cls: 'pm-button pm-button--secondary', text: 'Upload full-wrap cover', attr: { type: 'button' }
    });
    const fullCoverPicker = document.createElement('input');
    fullCoverPicker.type = 'file';
    fullCoverPicker.accept = 'application/pdf,image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    fullCoverPicker.hidden = true;
    fullCoverChoices.appendChild(fullCoverPicker);
    const fullCoverState = fullCoverChoices.createEl('p', { cls: 'pm-muted', attr: { 'aria-live': 'polite' } });
    const showFullCoverState = () => fullCoverState.setText(
      fullCoverPath.length === 0 ? 'No full-wrap cover selected.' : 'Full-wrap cover file ready for this Publishing Item.'
    );
    uploadFullCover.addEventListener('click', () => fullCoverPicker.click());
    fullCoverPicker.addEventListener('change', () => {
      const source = fullCoverPicker.files?.[0];
      if (source === undefined) return;
      uploadFullCover.disabled = true;
      fullCoverState.setText('Saving full-wrap cover locally…');
      void this.storeOriginalFile(source, 'item-full-cover')
        .then((path) => { fullCoverPath = path; showFullCoverState(); })
        .catch((cause: unknown) => fullCoverState.setText(cause instanceof Error ? cause.message : 'Could not save the full-wrap cover.'))
        .finally(() => { uploadFullCover.disabled = false; fullCoverPicker.value = ''; });
    });
    const updateFullCoverVisibility = () =>
      fullCoverChoices.toggleClass('is-hidden', !['paperback', 'hardcover'].includes(type.value));
    showFullCoverState();
    const retailLinks = createRetailLinksEditor(form, currentMap(this.existing, 'retail-links'));
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
      updateFullCoverVisibility();
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
        countryVariant: countryVariantSelect,
        publicationDate,
        isbn,
        coverPath: () => coverPath,
        fullCoverPath: () => fullCoverPath,
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
    readonly countryVariant: HTMLSelectElement;
    readonly publicationDate: HTMLInputElement;
    readonly isbn: HTMLSelectElement;
    readonly coverPath: () => string;
    readonly fullCoverPath: () => string;
    readonly retailLinks: RetailLinksEditor;
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
      countryVariant: controls.countryVariant.value,
      publicationDate: optionalText(controls.publicationDate.value),
      cover: optionalText(controls.coverPath()),
      fullCover: optionalText(controls.fullCoverPath()),
      retailLinks: controls.retailLinks.read(),
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
        countryVariant: shared.countryVariant,
        retailLinks: shared.retailLinks,
        audioMetadata: shared.audioMetadata,
        ...(shared.customType === undefined ? {} : { customType: shared.customType }),
        ...(shared.publicationDate === undefined
          ? {}
          : { publicationDate: shared.publicationDate }),
        ...(shared.cover === undefined ? {} : { cover: shared.cover }),
        ...(shared.fullCover === undefined ? {} : { fullCover: shared.fullCover }),
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
        fullCover: shared.fullCover,
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
    const selectedIsbn = this.isbnRecords.find((record) => record.id === controls.isbn.value);
    // Editing must not replay an already-complete assignment. The existing global record is the
    // source of truth; only an identifier not already linked to this Publishing Item is assigned.
    if (selectedIsbn !== undefined && selectedIsbn.fields['edition-id'] !== editionId) {
      const preview = this.isbns.previewTransaction({
        recordId: selectedIsbn.id,
        action: 'assign',
        editionId
      });
      await this.isbns.applyTransaction(preview);
    }
    this.onSaved(editionId);
    this.close();
  }

  /** Encodes local item artwork as a bounded derivative so raw vault paths stay out of the form. */
  private async storeLocalFile(source: File, prefix: string): Promise<string> {
    if (!source.type.startsWith('image/')) {
      throw new Error('Choose an AVIF, GIF, JPEG, PNG, SVG, or WebP image.');
    }
    const bitmap = await createImageBitmap(new Blob([await source.arrayBuffer()], { type: source.type }));
    const scale = Math.min(1, 480 / bitmap.width, 768 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This device could not prepare the cover image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const artwork = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error('Could not encode the cover image.')) : resolve(blob)),
        'image/webp',
        0.78
      )
    );
    const folder = `${this.projectPath.slice(0, this.projectPath.lastIndexOf('/'))}/Covers`;
    if (this.app.vault.getAbstractFileByPath(folder) === null) await this.app.vault.createFolder(folder);
    const target = `${folder}/${prefix}-${Date.now()}.webp`;
    await this.app.vault.createBinary(target, await artwork.arrayBuffer());
    return target;
  }

  /** Keeps production wrap artwork at original dimensions; only card/front covers are compressed. */
  private async storeOriginalFile(source: File, prefix: string): Promise<string> {
    if (!source.type.startsWith('image/') && source.type !== 'application/pdf') {
      throw new Error('Choose an image or PDF full-wrap cover.');
    }
    const folder = `${this.projectPath.slice(0, this.projectPath.lastIndexOf('/'))}/Covers`;
    if (this.app.vault.getAbstractFileByPath(folder) === null) await this.app.vault.createFolder(folder);
    const extension = source.name.split('.').pop()?.replace(/[^a-z0-9]/giu, '').toLowerCase() || 'bin';
    const target = `${folder}/${prefix}-${Date.now()}.${extension}`;
    await this.app.vault.createBinary(target, await source.arrayBuffer());
    return target;
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
    trimUnit?: HTMLInputElement;
    pageCount?: HTMLInputElement;
    narrator?: HTMLInputElement;
    duration?: HTMLInputElement;
    audioMetadata?: HTMLTextAreaElement;
  } = {};
  if (print) {
    const printHeading = parent.createDiv({ cls: 'pm-print-details-heading pm-field--wide' });
    printHeading.createEl('h3', { text: 'Print details' });
    controls.trimWidth = createNumber(parent, 'Trim width', currentString(existing, 'trim-width'));
    controls.trimHeight = createNumber(parent, 'Trim height', currentString(existing, 'trim-height'));
    controls.trimUnit = createTrimUnitRocker(
      printHeading,
      currentString(existing, 'trim-unit', 'mm'),
      controls.trimWidth,
      controls.trimHeight
    );
    controls.pageCount = createNumber(parent, 'Page count', currentNumber(existing, 'page-count'), '1');
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

/** Creates a decimal-capable numeric control so trim values cannot contain arbitrary text. */
function createNumber(parent: HTMLElement, label: string, value = '', step = '0.001'): HTMLInputElement {
  const input = createInput(parent, label, 'number', value);
  input.min = '0';
  input.step = step;
  input.inputMode = 'decimal';
  return input;
}

/** Stores a unit token in a hidden input while the two visible buttons form a true unit rocker. */
function createTrimUnitRocker(
  parent: HTMLElement,
  initial: string,
  width: HTMLInputElement,
  height: HTMLInputElement
): HTMLInputElement {
  const wrapper = parent.createDiv({ cls: 'pm-trim-unit-rocker' });
  const group = wrapper.createDiv({ cls: 'pm-rocker', attr: { role: 'group', 'aria-label': 'Trim unit' } });
  const metric = group.createEl('button', {
    cls: 'pm-rocker__option', text: 'Metric (mm)', attr: { type: 'button' }
  });
  const imperial = group.createEl('button', {
    cls: 'pm-rocker__option', text: 'Imperial (in)', attr: { type: 'button' }
  });
  const unit = wrapper.createEl('input', { type: 'hidden', value: initial === 'in' ? 'in' : 'mm' });
  const setUnit = (next: 'mm' | 'in', convert: boolean) => {
    const previous = unit.value === 'in' ? 'in' : 'mm';
    if (convert && previous !== next) {
      for (const input of [width, height]) {
        const value = Number(input.value);
        if (input.value.trim().length > 0 && Number.isFinite(value)) {
          input.value = formatTrimDimension(next === 'in' ? value / 25.4 : value * 25.4);
        }
      }
    }
    unit.value = next;
    metric.toggleClass('is-active', next === 'mm');
    imperial.toggleClass('is-active', next === 'in');
    metric.setAttribute('aria-pressed', String(next === 'mm'));
    imperial.setAttribute('aria-pressed', String(next === 'in'));
  };
  metric.addEventListener('click', () => setUnit('mm', true));
  imperial.addEventListener('click', () => setUnit('in', true));
  setUnit(unit.value === 'in' ? 'in' : 'mm', false);
  return unit;
}

/** Rounds converted millimetre/inch values without leaving display-only trailing zeroes. */
function formatTrimDimension(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
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

/** Lists only globally available identifiers, plus this item's existing immutable assignment. */
function createIsbnSelect(
  parent: HTMLElement,
  records: readonly CatalogRecord[],
  currentId: string | undefined
): HTMLSelectElement {
  const wrapper = parent.createDiv({ cls: 'pm-field' });
  wrapper.createEl('label', { text: 'Find ISBN', attr: { for: 'pm-isbn-search' } });
  const search = wrapper.createEl('input', {
    type: 'search',
    attr: {
      id: 'pm-isbn-search',
      placeholder: 'Type ISBN digits or publisher',
      autocomplete: 'off'
    }
  });
  const selectLabel = wrapper.createEl('label', { text: 'ISBN', attr: { for: 'pm-isbn-select' } });
  const select = wrapper.createEl('select', { attr: { id: 'pm-isbn-select' } });
  const available = records
    .filter((candidate) => candidate.id === currentId || String(candidate.fields.status) === 'available')
    .sort((left, right) => String(left.fields.value).localeCompare(String(right.fields.value)));
  const result = wrapper.createEl('small', { cls: 'pm-muted', attr: { 'aria-live': 'polite' } });
  const render = () => {
    const previous = select.value || currentId || '';
    const query = search.value.trim().toLowerCase();
    const normalizedQuery = query.replace(/[^a-z0-9]/gu, '');
    const matching = available.filter((record) => {
      if (record.id === currentId) return true;
      const value = String(record.fields.value).toLowerCase();
      const searchable = [value, String(record.fields.publisher ?? '')]
        .join(' ')
        .toLowerCase();
      return query.length === 0 || searchable.includes(query) || value.replace(/[^a-z0-9]/gu, '').includes(normalizedQuery);
    });
    select.empty();
    select.createEl('option', { value: '', text: 'No ISBN assigned yet' });
    for (const record of matching) {
      select.createEl('option', {
        value: record.id,
        text: record.id === currentId ? `${String(record.fields.value)} (assigned to this item)` : String(record.fields.value),
        attr: record.id === previous ? { selected: 'true' } : {}
      });
    }
    const availableShown = matching.filter((record) => record.id !== currentId).length;
    result.setText(`${availableShown} available ISBN${availableShown === 1 ? '' : 's'} shown.`);
  };
  search.addEventListener('input', render);
  render();
  return select;
}

/** Offers retailer-aware rows while preserving the canonical `label → URL` map on save. */
function createRetailLinksEditor(
  parent: HTMLElement,
  existing: Readonly<Record<string, string>>
): RetailLinksEditor {
  const section = parent.createEl('section', { cls: 'pm-retail-links pm-field--wide' });
  const heading = section.createDiv({ cls: 'pm-section-heading' });
  heading.createEl('h3', { text: 'Retail links' });
  const add = heading.createEl('button', {
    cls: 'pm-button pm-button--secondary', text: 'Add retailer link', attr: { type: 'button' }
  });
  section.createEl('p', {
    cls: 'pm-muted',
    text: 'Choose a retailer and paste its public product page. Add as many retailer links as needed.'
  });
  const rows = section.createDiv({ cls: 'pm-retail-links__rows' });
  const editors: { retailer: HTMLSelectElement; custom: HTMLInputElement; url: HTMLInputElement }[] = [];
  const addRow = (label = '', url = '') => {
    const row = rows.createDiv({ cls: 'pm-retail-links__row' });
    const retailer = row.createEl('select', { attr: { 'aria-label': 'Retailer' } });
    for (const value of RETAILER_LABELS) retailer.createEl('option', { value, text: value });
    const known = RETAILER_LABELS.includes(label as (typeof RETAILER_LABELS)[number]);
    retailer.value = known ? label : 'Custom retailer';
    const custom = row.createEl('input', {
      type: 'text', value: known ? '' : label,
      attr: { placeholder: 'Retailer name', 'aria-label': 'Custom retailer name' }
    });
    custom.toggleClass('is-hidden', known);
    const link = row.createEl('input', {
      type: 'url', value: url,
      attr: { placeholder: 'https://…', 'aria-label': 'Retailer product URL' }
    });
    const remove = row.createEl('button', {
      cls: 'pm-button pm-button--secondary', text: 'Remove', attr: { type: 'button' }
    });
    const editor = { retailer, custom, url: link };
    editors.push(editor);
    retailer.addEventListener('change', () => custom.toggleClass('is-hidden', retailer.value !== 'Custom retailer'));
    remove.addEventListener('click', () => {
      const index = editors.indexOf(editor);
      if (index >= 0) editors.splice(index, 1);
      row.remove();
    });
  };
  const entries = Object.entries(existing).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) addRow();
  else for (const [label, url] of entries) addRow(label, url);
  add.addEventListener('click', () => addRow());
  return {
    read: () => {
      const result: Record<string, string> = {};
      for (const editor of editors) {
        const label = (editor.retailer.value === 'Custom retailer' ? editor.custom.value : editor.retailer.value).trim();
        const url = editor.url.value.trim();
        if (label.length === 0 && url.length === 0) continue;
        if (label.length === 0 || url.length === 0) throw new Error('Each retailer link needs both a retailer and a URL.');
        if (result[label] !== undefined) throw new Error(`Retailer “${label}” appears more than once.`);
        result[label] = url;
      }
      return result;
    }
  };
}

const RETAILER_LABELS = [
  'Amazon',
  'Apple Books',
  'Barnes & Noble',
  'Google Play Books',
  'Kobo',
  'Audible',
  'Bookshop.org',
  'Publisher store',
  'Custom retailer'
] as const;

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
