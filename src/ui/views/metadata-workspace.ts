/**
 * Renders MET-001–MET-007 book metadata and edition overrides in grouped, accessible sections.
 * Effective values and provenance are derived from canonical metadata-set records on every render.
 * Markdown remains the description source; plain text is a visible deterministic preview. This
 * surface contains no network lookup and accurately identifies the BISAC licensing limitation.
 */

import { Notice, type App } from 'obsidian';

import type { MetadataProjectService } from '../../application/metadata/metadata-project-service';
import { METADATA_CLASSIFICATION_VERSIONS } from '../../application/metadata/metadata-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import { createConfirmedExternalLink } from '../security/confirmed-external-link';
import {
  METADATA_COMPLETENESS_PROFILES,
  METADATA_FIELD_KEYS,
  CLASSIFICATION_OFFICIAL_SOURCES,
  REGIONAL_SUBJECT_SCHEMES,
  validateMetadataValues,
  type EffectiveMetadata,
  type MetadataFieldKey,
  type MetadataValues,
  type RegionalSubjectCodeAssignment
} from '../../domain/metadata/metadata-set';

/** Runtime selection is disposable; profile choice never becomes false canonical platform truth. */
export interface MetadataWorkspaceState {
  profileId: string;
}

/** Starts with the generic profile until a user deliberately chooses format-specific coverage. */
export function createMetadataWorkspaceState(): MetadataWorkspaceState {
  return { profileId: 'core-book' };
}

/** Complete renderer input keeps storage and Obsidian services outside this presentation module. */
export interface MetadataWorkspaceContext {
  readonly app: App;
  readonly parent: HTMLElement;
  readonly book: CatalogRecord;
  readonly selectedEditionId?: string;
  readonly snapshot: BookCatalogSnapshot;
  readonly metadata: MetadataProjectService;
  readonly state: MetadataWorkspaceState;
  readonly rerender: () => void;
}

/** Renders coverage, effective provenance, book defaults, edition overrides, and export evidence. */
export function renderMetadataWorkspace(context: MetadataWorkspaceContext): void {
  const editions = context.snapshot.editions.filter(
    (edition) => edition.fields['book-id'] === context.book.id
  );
  const selectedEdition = editions.find(({ id }) => id === context.selectedEditionId);
  const project = context.metadata.resolve(
    context.book.id,
    selectedEdition?.id,
    context.state.profileId
  );
  const page = context.parent.createEl('section', { cls: 'pm-metadata-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Inherited publication metadata' });
  title.createEl('h2', { text: 'Metadata workspace' });
  title.createEl('p', {
    text:
      selectedEdition === undefined
        ? 'Showing book values. Select an edition in the persistent header to edit explicit overrides.'
        : `Showing effective values for ${editionLabel(selectedEdition)} with book inheritance.`
  });
  renderCoverage(heading, context, project.coverage.percent, project.coverage.explanation);
  renderEffectiveGroups(page, context, project.effective, selectedEdition);
  renderMetadataEditor(page, context, 'book', project.bookRecord, context.book.id);
  if (selectedEdition !== undefined)
    renderMetadataEditor(page, context, 'edition', project.editionRecord, selectedEdition.id);
  renderDescriptionExport(page, context, selectedEdition?.id, project.effective);
  renderClassificationBoundary(page, context.app);
}

/** Profile selector and text-equivalent coverage indicator avoid claiming universal completeness. */
function renderCoverage(
  parent: HTMLElement,
  context: MetadataWorkspaceContext,
  percent: number,
  explanation: string
): void {
  const card = parent.createEl('aside', { cls: 'pm-metadata-coverage' });
  card.createEl('strong', { text: `Coverage ${percent}%` });
  card.createEl('p', { text: explanation });
  const label = card.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: 'Completeness profile' });
  const select = label.createEl('select');
  for (const profile of METADATA_COMPLETENESS_PROFILES)
    select.createEl('option', {
      value: profile.id,
      text: `${profile.label} · v${profile.version}`,
      attr: profile.id === context.state.profileId ? { selected: 'true' } : {}
    });
  select.addEventListener('change', () => {
    context.state.profileId = select.value;
    context.rerender();
  });
}

/** Grouped effective rows always name source, validation state, and readable current value. */
function renderEffectiveGroups(
  parent: HTMLElement,
  context: MetadataWorkspaceContext,
  effective: EffectiveMetadata,
  edition?: CatalogRecord
): void {
  const groups: readonly { label: string; fields: readonly MetadataFieldKey[] }[] = [
    {
      label: 'Identity',
      fields: [
        'title',
        'subtitle',
        'series-title',
        'series-number',
        'edition-statement',
        'language'
      ]
    },
    {
      label: 'Discoverability',
      fields: ['long-description-markdown', 'short-description-markdown', 'keywords']
    },
    {
      label: 'Classification',
      fields: ['bisac-codes', 'thema-codes', 'regional-subject-codes', 'audience']
    },
    {
      label: 'Publisher and rights',
      fields: ['publisher', 'imprint', 'copyright', 'contributors']
    },
    { label: 'Reading age', fields: ['reading-age-min', 'reading-age-max'] }
  ];
  for (const group of groups) {
    const section = parent.createEl('section', { cls: 'pm-panel pm-metadata-group' });
    section.createEl('h3', { text: group.label });
    const list = section.createEl('dl', { cls: 'pm-metadata-effective' });
    for (const key of group.fields) {
      const field = effective.fields[key];
      const row = list.createDiv({ cls: 'pm-metadata-row' });
      row.createEl('dt', { text: fieldLabel(key) });
      row.createEl('dd', { text: displayValue(field.value) });
      const source = row.createEl('dd', {
        text: `Source: ${field.source} · ${field.value === undefined ? 'Missing' : 'Valid effective value'}`
      });
      if (edition !== undefined && field.source === 'edition') {
        const restore = source.createEl('button', {
          cls: 'pm-text-button',
          text: 'Restore inheritance',
          attr: { type: 'button' }
        });
        restore.addEventListener('click', () => {
          restore.disabled = true;
          void context.metadata
            .clearEditionOverride(edition.id, key)
            .then(() => new Notice(`${fieldLabel(key)} now inherits the book value.`))
            .catch((cause: unknown) => {
              new Notice(errorMessage(cause, 'Override could not be cleared.'));
              restore.disabled = false;
            });
        });
      }
    }
  }
}

/** Book and edition forms write only their own canonical scope; blank edition controls mean inherit. */
function renderMetadataEditor(
  parent: HTMLElement,
  context: MetadataWorkspaceContext,
  scope: 'book' | 'edition',
  record: CatalogRecord | undefined,
  identity: string
): void {
  const details = parent.createEl('details', { cls: 'pm-panel pm-metadata-editor' });
  details.createEl('summary', {
    text: scope === 'book' ? 'Edit book metadata defaults' : 'Edit explicit edition overrides'
  });
  details.createEl('p', {
    text:
      scope === 'book'
        ? 'Book values become defaults for every edition.'
        : 'Leave a field blank to inherit. Saving replaces only this edition’s explicit override set.'
  });
  const values = asValues(record?.fields.values);
  const form = details.createDiv({ cls: 'pm-form-grid' });
  const inputs = new Map<MetadataFieldKey, HTMLInputElement | HTMLTextAreaElement>();
  for (const key of METADATA_FIELD_KEYS) {
    if (key === 'contributors') {
      inputs.set(key, textarea(form, fieldLabel(key), contributorsText(values[key])));
    } else if (key.includes('description')) {
      inputs.set(key, textarea(form, fieldLabel(key), textValue(values[key])));
    } else if (key === 'regional-subject-codes') {
      renderRegionalCodeExplainer(form, context.app);
      inputs.set(
        key,
        textarea(
          form,
          'Regional subject codes · TERRITORY | scheme | CODE | primary/secondary | optional label',
          regionalAssignmentsText(values[key])
        )
      );
    } else if (['keywords', 'bisac-codes', 'thema-codes'].includes(key)) {
      inputs.set(key, textarea(form, `${fieldLabel(key)} · one per line`, listText(values[key])));
    } else {
      inputs.set(
        key,
        input(
          form,
          fieldLabel(key),
          key.startsWith('reading-age-') ? 'number' : 'text',
          textValue(values[key])
        )
      );
    }
  }
  const errors = details.createDiv({
    cls: 'pm-validation-summary',
    attr: { 'aria-live': 'polite' }
  });
  const save = details.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: scope === 'book' ? 'Save book metadata' : 'Save edition overrides',
    attr: { type: 'button' }
  });
  save.addEventListener('click', () => {
    const next = valuesFromInputs(inputs);
    const diagnostics = validateMetadataValues(next);
    if (diagnostics.length > 0) {
      errors.setText(diagnostics.map(({ message }) => message).join(' '));
      return;
    }
    save.disabled = true;
    errors.empty();
    const operation =
      scope === 'book'
        ? context.metadata.saveBookValues(identity, next)
        : context.metadata.saveEditionOverrides(identity, next);
    void operation
      .then(
        () => new Notice(scope === 'book' ? 'Book metadata saved.' : 'Edition overrides saved.')
      )
      .catch((cause: unknown) => {
        errors.setText(errorMessage(cause, 'Metadata could not be saved.'));
        save.disabled = false;
      });
  });
}

/**
 * Places purpose and workflow beside the input so a user never has to infer why trade subject
 * codes exist or how an externally selected code returns to their canonical local metadata.
 */
function renderRegionalCodeExplainer(parent: HTMLElement, app: App): void {
  const explainer = parent.createEl('aside', { cls: 'pm-field--wide pm-classification-explainer' });
  explainer.createEl('strong', { text: 'Why subject codes matter' });
  explainer.createEl('p', {
    text: 'Bookshops, distributors, libraries, and online stores use subject codes to place a publication in the right catalogue categories and help readers discover it. Different markets request different schemes, so each saved code keeps its territory, scheme, version, priority, label, and manual source.'
  });
  const steps = explainer.createEl('ol');
  steps.createEl('li', {
    text: 'Open an official source below and find the most specific appropriate code.'
  });
  steps.createEl('li', {
    text: 'Return here and log one code per line using the displayed format.'
  });
  steps.createEl('li', { text: 'Mark the main code primary and any additional codes secondary.' });
  explainer.createEl('p', {
    text: 'Saving records the code against this book or edition. Publishing Manager validates the structure and market pairing, but it does not copy or certify the third-party heading.'
  });
  const sources = explainer.createEl('ul');
  for (const source of CLASSIFICATION_OFFICIAL_SOURCES)
    officialSource(sources, app, source.label, source.href);
}

/** Plain-text preview is derived on demand and cannot overwrite the Markdown source. */
function renderDescriptionExport(
  parent: HTMLElement,
  context: MetadataWorkspaceContext,
  editionId: string | undefined,
  effective: EffectiveMetadata
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Description plain-text export preview' });
  details.createEl('p', {
    text: 'Markdown remains canonical. This deterministic preview strips formatting without rendering or executing HTML.'
  });
  const field = details.createEl('select', { attr: { 'aria-label': 'Description to export' } });
  field.createEl('option', { value: 'long-description-markdown', text: 'Long description' });
  field.createEl('option', { value: 'short-description-markdown', text: 'Short description' });
  const output = details.createEl('pre', { cls: 'pm-description-export' });
  const render = () => {
    const key = field.value as 'long-description-markdown' | 'short-description-markdown';
    output.setText(
      context.metadata.exportDescription(context.book.id, editionId, key) ||
        `No effective ${fieldLabel(key).toLowerCase()} to export.`
    );
  };
  field.addEventListener('change', render);
  render();
  if (effective.fields['long-description-markdown'].value === undefined)
    details.createEl('p', {
      cls: 'pm-muted',
      text: 'Add a long description to improve profile coverage.'
    });
}

/** Classification disclosure records current regional practice and exact licensing boundaries. */
function renderClassificationBoundary(parent: HTMLElement, app: App): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Classification reference versions and limits' });
  details.createEl('p', {
    text: `Thema ${METADATA_CLASSIFICATION_VERSIONS.thema} is the current regional route for the UK and Australia and is also supported for France and Germany. France additionally accepts CLIL; Germany accepts WGS 2.0; legacy UK BIC 2.1 remains available only for existing records. BISAC is labelled ${METADATA_CLASSIFICATION_VERSIONS.bisac}. Manual codes receive syntax and territory/scheme validation, but headings are not claimed valid without an authorized source. The Classification Data Licence Acknowledgement in Settings adds no restriction to the MIT software and grants no third-party rights. Publishing Manager does not bundle these lists or make an automatic lookup request.`
  });
  const sources = details.createEl('ul');
  for (const source of CLASSIFICATION_OFFICIAL_SOURCES)
    officialSource(sources, app, source.label, source.href);
  details.createEl('pre', {
    text: 'Examples:\nGB | thema | FJH | primary | Crime fiction\nAU | thema | FJH | primary\nFR | clil | 3430 | secondary | User-supplied label\nDE | wgs | 1121 | primary | User-supplied label'
  });
}

/** External references are user-initiated, visibly named, and isolated from the plugin runtime. */
function officialSource(parent: HTMLUListElement, app: App, label: string, href: string): void {
  createConfirmedExternalLink(parent.createEl('li'), app, label, href);
}

function valuesFromInputs(
  inputs: ReadonlyMap<MetadataFieldKey, HTMLInputElement | HTMLTextAreaElement>
): MetadataValues {
  const values: Partial<Record<MetadataFieldKey, unknown>> = {};
  for (const [key, control] of inputs) {
    const raw = control.value.trim();
    if (!raw) continue;
    if (key === 'regional-subject-codes') values[key] = regionalAssignments(raw);
    else if (['keywords', 'bisac-codes', 'thema-codes'].includes(key)) values[key] = lines(raw);
    else if (key === 'contributors')
      values[key] = lines(raw).map((line) => {
        const separator = line.lastIndexOf('|');
        return separator < 0
          ? { name: line, role: 'Contributor' }
          : { name: line.slice(0, separator).trim(), role: line.slice(separator + 1).trim() };
      });
    else if (key.startsWith('reading-age-')) values[key] = Number(raw);
    else values[key] = raw;
  }
  return values;
}

function input(
  parent: HTMLElement,
  labelText: string,
  type: string,
  value: string
): HTMLInputElement {
  const label = parent.createEl('label', { cls: 'pm-field' });
  label.createSpan({ text: labelText });
  return label.createEl('input', { value, attr: { type } });
}
function textarea(parent: HTMLElement, labelText: string, value: string): HTMLTextAreaElement {
  const label = parent.createEl('label', { cls: 'pm-field pm-field--wide' });
  label.createSpan({ text: labelText });
  return label.createEl('textarea', { text: value, attr: { rows: '5' } });
}
function asValues(value: unknown): MetadataValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
function lines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join('\n')
    : '';
}
function contributorsText(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is { name: string; role: string } =>
            typeof item === 'object' && item !== null && 'name' in item && 'role' in item
        )
        .map(({ name, role }) => `${name} | ${role}`)
        .join('\n')
    : '';
}
/** Converts structured assignments to an editable, diff-friendly line representation. */
function regionalAssignmentsText(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is RegionalSubjectCodeAssignment =>
            typeof item === 'object' && item !== null && 'territory' in item && 'scheme' in item
        )
        .map(({ territory, scheme, code, primary, label }) =>
          [territory, scheme, code, primary ? 'primary' : 'secondary', label]
            .filter((part) => part !== undefined)
            .join(' | ')
        )
        .join('\n')
    : '';
}

/** Parses one human-readable assignment per line; domain validation supplies precise rejection. */
function regionalAssignments(value: string): RegionalSubjectCodeAssignment[] {
  return lines(value).map((line) => {
    const [territory = '', scheme = '', code = '', priority = '', ...labelParts] = line
      .split('|')
      .map((part) => part.trim());
    const label = labelParts.join(' | ').trim();
    const normalizedTerritory =
      territory.toUpperCase() as RegionalSubjectCodeAssignment['territory'];
    const normalizedScheme = scheme.toLowerCase() as RegionalSubjectCodeAssignment['scheme'];
    const definition = REGIONAL_SUBJECT_SCHEMES.find(
      (entry) => entry.territory === normalizedTerritory && entry.scheme === normalizedScheme
    );
    return {
      territory: normalizedTerritory,
      scheme: normalizedScheme,
      version: definition?.version ?? 'unsupported',
      code: code.toUpperCase(),
      primary: priority.toLowerCase() === 'primary',
      ...(label ? { label } : {}),
      source: 'manual'
    };
  });
}
function displayValue(value: unknown): string {
  if (value === undefined) return '— Missing';
  if (Array.isArray(value))
    return value
      .map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
      .join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '— Unsupported value';
}
function fieldLabel(key: MetadataFieldKey): string {
  return key
    .replace(/-markdown$/u, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
function editionLabel(edition: CatalogRecord): string {
  return `${String(edition.fields.type)} · revision ${String(edition.fields.revision)}`;
}
function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
