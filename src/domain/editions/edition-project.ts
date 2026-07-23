/**
 * Defines the M2 edition and format vocabulary independently of Obsidian, storage paths, and UI
 * controls. The domain keeps preset values stable for filtering and reporting, while `custom`
 * supplies a labelled escape hatch without allowing arbitrary text to replace canonical types.
 * Conditional validation prevents print, digital, and audio details from becoming contradictory.
 */

import type { ManagedRecordEnvelope } from '../records/record-envelope';
import { normalizeVaultPath } from '../storage/vault-path';

/** Stable preset values persisted in edition records and safe to use in future reports. */
export const EDITION_TYPES = [
  'paperback',
  'hardcover',
  'ebook',
  'audiobook',
  'screenplay',
  'large-print',
  'special-edition',
  'collector-edition',
  'box-set',
  'custom'
] as const;

/** Persisted preset identifier; a custom record also requires a human-readable label. */
export type EditionType = (typeof EDITION_TYPES)[number];

/** Stable media categories drive conditional fields without inferring behavior from labels. */
export const EDITION_MEDIA = ['print', 'digital', 'audio', 'mixed'] as const;
export type EditionMedium = (typeof EDITION_MEDIA)[number];

/** Edition lifecycle categories align with the project-wide stable state vocabulary. */
export const EDITION_STATUSES = [
  'planned',
  'active',
  'ready',
  'published',
  'suspended',
  'archived'
] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

/** Format categories make file intent explicit and remain independent of filename extensions. */
export const FORMAT_CATEGORIES = ['print', 'digital', 'audio'] as const;
export type FormatCategory = (typeof FORMAT_CATEGORIES)[number];

/** Canonical editable edition fields hydrated from one Markdown record. */
export interface EditionProjectFields {
  readonly bookId: string;
  readonly type: EditionType;
  readonly medium: EditionMedium;
  readonly revision: number;
  readonly status: EditionStatus;
  /** Global is the default; a country value identifies this Publishing Item as a market variant. */
  readonly countryVariant?: string;
  readonly customType?: string;
  readonly publicationDate?: string;
  readonly cover?: string;
  readonly fullCover?: string;
  readonly retailLinks: Readonly<Record<string, string>>;
  readonly notes?: string;
  readonly sourceEditionId?: string;
  readonly trimWidth?: string;
  readonly trimHeight?: string;
  readonly trimUnit?: 'in' | 'mm';
  readonly pageCount?: number;
  readonly narrator?: string;
  readonly durationMinutes?: number;
  readonly audioMetadata: Readonly<Record<string, string>>;
}

/** Hydrated edition retains stable envelope identity and lifecycle timestamps. */
export interface EditionProject extends EditionProjectFields {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

/** Canonical format fields link one production output to exactly one edition. */
export interface EditionFormatFields {
  readonly editionId: string;
  readonly category: FormatCategory;
  readonly kind: string;
  readonly label?: string;
  readonly filePath?: string;
  readonly accessibility: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Hydrated format includes its stable record identity and archive state. */
export interface EditionFormat extends EditionFormatFields {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

/** Minimal record input accepted by the pure edition/format hydration functions. */
export interface EditionRecordSnapshot {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Field-level diagnostics are shared by application validation and catalog repair guidance. */
export interface EditionDiagnostic {
  readonly code:
    | 'edition.conditional-audio-field'
    | 'edition.conditional-print-field'
    | 'edition.custom-label-required'
    | 'edition.invalid-audio-metadata'
    | 'edition.invalid-book'
    | 'edition.invalid-cover'
    | 'edition.invalid-date'
    | 'edition.invalid-duration'
    | 'edition.invalid-medium'
    | 'edition.invalid-notes'
    | 'edition.invalid-page-count'
    | 'edition.invalid-retail-links'
    | 'edition.invalid-revision'
    | 'edition.invalid-status'
    | 'edition.invalid-trim'
    | 'edition.invalid-type';
  readonly field: keyof EditionProjectFields;
  readonly message: string;
}

/** Format diagnostics reject ambiguous kinds, unsafe paths, and non-text metadata maps. */
export interface EditionFormatDiagnostic {
  readonly code:
    | 'format.invalid-accessibility'
    | 'format.invalid-category'
    | 'format.invalid-edition'
    | 'format.invalid-kind'
    | 'format.invalid-label'
    | 'format.invalid-metadata'
    | 'format.invalid-path';
  readonly field: keyof EditionFormatFields;
  readonly message: string;
}

/** Returns the stable media category for a preset; custom records supply it explicitly. */
export function defaultMediumFor(type: EditionType): EditionMedium | undefined {
  switch (type) {
    case 'paperback':
    case 'hardcover':
    case 'large-print':
    case 'special-edition':
    case 'collector-edition':
      return 'print';
    case 'ebook':
    case 'screenplay':
      return 'digital';
    case 'audiobook':
      return 'audio';
    case 'box-set':
      return 'mixed';
    case 'custom':
      return undefined;
  }
}

/** Produces a concise label that never substitutes for the stable persisted type. */
export function editionTypeLabel(
  fields: Pick<EditionProjectFields, 'customType' | 'type'>
): string {
  if (fields.type === 'custom') return fields.customType ?? 'Custom edition';
  return fields.type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Validates complete proposed edition state without trimming, coercing, or inventing defaults. */
export function validateEditionProject(
  fields: Readonly<Record<string, unknown>>
): readonly EditionDiagnostic[] {
  const diagnostics: EditionDiagnostic[] = [];
  const type = fields.type;
  const medium = fields.medium;
  const expectedMedium =
    typeof type === 'string' && isEditionType(type) ? defaultMediumFor(type) : undefined;

  if (!isManagedId(fields['book-id'])) {
    diagnostics.push({
      code: 'edition.invalid-book',
      field: 'bookId',
      message: 'Choose one valid book for this edition.'
    });
  }
  if (typeof type !== 'string' || !isEditionType(type)) {
    diagnostics.push({
      code: 'edition.invalid-type',
      field: 'type',
      message: `Choose one of: ${EDITION_TYPES.join(', ')}.`
    });
  }
  if (typeof medium !== 'string' || !isEditionMedium(medium)) {
    diagnostics.push({
      code: 'edition.invalid-medium',
      field: 'medium',
      message: `Choose one of: ${EDITION_MEDIA.join(', ')}.`
    });
  } else if (expectedMedium !== undefined && medium !== expectedMedium) {
    diagnostics.push({
      code: 'edition.invalid-medium',
      field: 'medium',
      message: `${editionTypeLabel({ type: type as EditionType })} editions use the ${expectedMedium} media category.`
    });
  }
  if (
    type === 'custom' &&
    (typeof fields['custom-type'] !== 'string' ||
      fields['custom-type'].trim().length === 0 ||
      fields['custom-type'] !== fields['custom-type'].trim())
  ) {
    diagnostics.push({
      code: 'edition.custom-label-required',
      field: 'customType',
      message: 'Enter a trimmed human-readable name for the custom edition type.'
    });
  }
  if (
    typeof fields.revision !== 'number' ||
    !Number.isSafeInteger(fields.revision) ||
    fields.revision < 1
  ) {
    diagnostics.push({
      code: 'edition.invalid-revision',
      field: 'revision',
      message: 'Revision must be a positive whole number.'
    });
  }
  if (typeof fields.status !== 'string' || !isEditionStatus(fields.status)) {
    diagnostics.push({
      code: 'edition.invalid-status',
      field: 'status',
      message: `Choose one of: ${EDITION_STATUSES.join(', ')}.`
    });
  }
  if (fields['publication-date'] !== undefined && !isCalendarDate(fields['publication-date'])) {
    diagnostics.push({
      code: 'edition.invalid-date',
      field: 'publicationDate',
      message: 'Publication date must be a real calendar date in YYYY-MM-DD form.'
    });
  }
  if (fields.cover !== undefined && !isSafeOptionalPath(fields.cover)) {
    diagnostics.push({
      code: 'edition.invalid-cover',
      field: 'cover',
      message: 'Cover must be an unambiguous vault-relative path.'
    });
  }
  if (fields['full-cover'] !== undefined && !isSafeOptionalPath(fields['full-cover'])) {
    diagnostics.push({
      code: 'edition.invalid-cover',
      field: 'fullCover',
      message: 'Full-wrap cover must be an unambiguous vault-relative path.'
    });
  }
  if (!isStringMap(fields['retail-links'] ?? {})) {
    diagnostics.push({
      code: 'edition.invalid-retail-links',
      field: 'retailLinks',
      message: 'Retail links must be a map of human labels to URL text.'
    });
  }
  if (
    fields.notes !== undefined &&
    (typeof fields.notes !== 'string' || fields.notes.length > 8_000)
  ) {
    diagnostics.push({
      code: 'edition.invalid-notes',
      field: 'notes',
      message: 'Edition notes must be text no longer than 8,000 characters.'
    });
  }

  validatePrintFields(fields, medium, diagnostics);
  validateAudioFields(fields, medium, diagnostics);
  return diagnostics;
}

/** Validates a complete format proposal before it is written to a canonical Markdown record. */
export function validateEditionFormat(
  fields: Readonly<Record<string, unknown>>
): readonly EditionFormatDiagnostic[] {
  const diagnostics: EditionFormatDiagnostic[] = [];
  if (!isManagedId(fields['edition-id'])) {
    diagnostics.push({
      code: 'format.invalid-edition',
      field: 'editionId',
      message: 'Choose one valid edition for this format.'
    });
  }
  if (typeof fields.category !== 'string' || !isFormatCategory(fields.category)) {
    diagnostics.push({
      code: 'format.invalid-category',
      field: 'category',
      message: `Choose one of: ${FORMAT_CATEGORIES.join(', ')}.`
    });
  }
  if (typeof fields.kind !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(fields.kind)) {
    diagnostics.push({
      code: 'format.invalid-kind',
      field: 'kind',
      message: 'Format kind must be a lowercase stable value such as epub or print-interior-pdf.'
    });
  }
  if (
    fields.label !== undefined &&
    (typeof fields.label !== 'string' ||
      fields.label.trim().length === 0 ||
      fields.label.length > 120)
  ) {
    diagnostics.push({
      code: 'format.invalid-label',
      field: 'label',
      message: 'Format label must be non-empty text no longer than 120 characters.'
    });
  }
  if (fields['file-path'] !== undefined && !isSafeOptionalPath(fields['file-path'])) {
    diagnostics.push({
      code: 'format.invalid-path',
      field: 'filePath',
      message: 'Format file must be an unambiguous vault-relative path.'
    });
  }
  if (!isStringMap(fields.accessibility ?? {})) {
    diagnostics.push({
      code: 'format.invalid-accessibility',
      field: 'accessibility',
      message: 'Accessibility metadata must contain text keys and text values.'
    });
  }
  if (!isStringMap(fields.metadata ?? {})) {
    diagnostics.push({
      code: 'format.invalid-metadata',
      field: 'metadata',
      message: 'Format metadata must contain text keys and text values.'
    });
  }
  return diagnostics;
}

/** Hydrates one validated edition record into the immutable domain representation. */
export function hydrateEditionProject(record: EditionRecordSnapshot): EditionProject {
  if (record.envelope.pmType !== 'edition') throw new Error('Expected an edition record.');
  const diagnostics = validateEditionProject(record.fields);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(({ message }) => message).join(' '));
  const retailLinks = record.fields['retail-links'] ?? {};
  const audioMetadata = record.fields['audio-metadata'] ?? {};
  return {
    id: record.envelope.pmId,
    bookId: record.fields['book-id'] as string,
    type: record.fields.type as EditionType,
    medium: record.fields.medium as EditionMedium,
    revision: record.fields.revision as number,
    status: record.fields.status as EditionStatus,
    ...optionalString(record.fields, 'country-variant', 'countryVariant'),
    retailLinks: retailLinks as Readonly<Record<string, string>>,
    audioMetadata: audioMetadata as Readonly<Record<string, string>>,
    createdAt: record.envelope.createdAt,
    updatedAt: record.envelope.updatedAt,
    ...(record.envelope.archivedAt === undefined ? {} : { archivedAt: record.envelope.archivedAt }),
    ...optionalString(record.fields, 'custom-type', 'customType'),
    ...optionalString(record.fields, 'publication-date', 'publicationDate'),
    ...optionalString(record.fields, 'cover', 'cover'),
    ...optionalString(record.fields, 'full-cover', 'fullCover'),
    ...optionalString(record.fields, 'notes', 'notes'),
    ...optionalString(record.fields, 'source-edition-id', 'sourceEditionId'),
    ...optionalString(record.fields, 'trim-width', 'trimWidth'),
    ...optionalString(record.fields, 'trim-height', 'trimHeight'),
    ...optionalString(record.fields, 'trim-unit', 'trimUnit'),
    ...optionalNumber(record.fields, 'page-count', 'pageCount'),
    ...optionalString(record.fields, 'narrator', 'narrator'),
    ...optionalNumber(record.fields, 'duration-minutes', 'durationMinutes')
  };
}

/** Hydrates one validated format record without reading or copying its referenced file. */
export function hydrateEditionFormat(record: EditionRecordSnapshot): EditionFormat {
  if (record.envelope.pmType !== 'format') throw new Error('Expected a format record.');
  const diagnostics = validateEditionFormat(record.fields);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(({ message }) => message).join(' '));
  return {
    id: record.envelope.pmId,
    editionId: record.fields['edition-id'] as string,
    category: record.fields.category as FormatCategory,
    kind: record.fields.kind as string,
    accessibility: (record.fields.accessibility ?? {}) as Readonly<Record<string, string>>,
    metadata: (record.fields.metadata ?? {}) as Readonly<Record<string, string>>,
    createdAt: record.envelope.createdAt,
    updatedAt: record.envelope.updatedAt,
    ...(record.envelope.archivedAt === undefined ? {} : { archivedAt: record.envelope.archivedAt }),
    ...optionalString(record.fields, 'label', 'label'),
    ...optionalString(record.fields, 'file-path', 'filePath')
  };
}

/** Reports whether a format category is meaningful for the edition's stable medium. */
export function mediumSupportsFormat(medium: EditionMedium, category: FormatCategory): boolean {
  return medium === 'mixed' || medium === category;
}

/** Narrows arbitrary strings to stable persisted edition types. */
export function isEditionType(value: string): value is EditionType {
  return (EDITION_TYPES as readonly string[]).includes(value);
}

/** Narrows arbitrary strings to stable edition media categories. */
export function isEditionMedium(value: string): value is EditionMedium {
  return (EDITION_MEDIA as readonly string[]).includes(value);
}

/** Narrows arbitrary strings to stable edition lifecycle values. */
export function isEditionStatus(value: string): value is EditionStatus {
  return (EDITION_STATUSES as readonly string[]).includes(value);
}

/** Narrows arbitrary strings to stable format categories. */
export function isFormatCategory(value: string): value is FormatCategory {
  return (FORMAT_CATEGORIES as readonly string[]).includes(value);
}

/** Print-only invariants reject incomplete dimensions and print data on incompatible media. */
function validatePrintFields(
  fields: Readonly<Record<string, unknown>>,
  medium: unknown,
  diagnostics: EditionDiagnostic[]
): void {
  const printKeys = ['trim-width', 'trim-height', 'trim-unit', 'page-count'] as const;
  const hasPrintField = printKeys.some((key) => fields[key] !== undefined);
  if (hasPrintField && medium !== 'print' && medium !== 'mixed') {
    diagnostics.push({
      code: 'edition.conditional-print-field',
      field: 'trimWidth',
      message: 'Trim and page details are available only for print or mixed editions.'
    });
    return;
  }
  const width = fields['trim-width'];
  const height = fields['trim-height'];
  const unit = fields['trim-unit'];
  if ([width, height, unit].some((value) => value !== undefined)) {
    if (
      !isPositiveDecimal(width) ||
      !isPositiveDecimal(height) ||
      (unit !== 'mm' && unit !== 'in')
    ) {
      diagnostics.push({
        code: 'edition.invalid-trim',
        field: 'trimWidth',
        message: 'Trim requires positive width and height values plus an mm or in unit.'
      });
    }
  }
  const pageCount = fields['page-count'];
  if (
    pageCount !== undefined &&
    (typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount) || pageCount < 1)
  ) {
    diagnostics.push({
      code: 'edition.invalid-page-count',
      field: 'pageCount',
      message: 'Page count must be a positive whole number.'
    });
  }
}

/** Audio-only invariants keep narrator, duration, and metadata off incompatible editions. */
function validateAudioFields(
  fields: Readonly<Record<string, unknown>>,
  medium: unknown,
  diagnostics: EditionDiagnostic[]
): void {
  const audioMetadata = fields['audio-metadata'];
  const hasAudioField =
    fields.narrator !== undefined ||
    fields['duration-minutes'] !== undefined ||
    (typeof audioMetadata === 'object' &&
      audioMetadata !== null &&
      !Array.isArray(audioMetadata) &&
      Object.keys(audioMetadata).length > 0);
  if (hasAudioField && medium !== 'audio' && medium !== 'mixed') {
    diagnostics.push({
      code: 'edition.conditional-audio-field',
      field: 'narrator',
      message:
        'Narrator, duration, and audio metadata are available only for audio or mixed editions.'
    });
    return;
  }
  const narrator = fields.narrator;
  if (narrator !== undefined && (typeof narrator !== 'string' || narrator.trim().length === 0)) {
    diagnostics.push({
      code: 'edition.conditional-audio-field',
      field: 'narrator',
      message: 'Narrator must be non-empty text when supplied.'
    });
  }
  const duration = fields['duration-minutes'];
  if (
    duration !== undefined &&
    (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 1)
  ) {
    diagnostics.push({
      code: 'edition.invalid-duration',
      field: 'durationMinutes',
      message: 'Audio duration must be a positive whole number of minutes.'
    });
  }
  if (!isStringMap(fields['audio-metadata'] ?? {})) {
    diagnostics.push({
      code: 'edition.invalid-audio-metadata',
      field: 'audioMetadata',
      message: 'Audio metadata must contain text keys and text values.'
    });
  }
}

/** Accepts opaque managed identities without tying relationships to filenames. */
function isManagedId(value: unknown): value is string {
  return typeof value === 'string' && /^pm-[a-z0-9][a-z0-9-]{7,127}$/u.test(value);
}

/** Checks a real UTC calendar date rather than accepting regex-shaped impossible dates. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates path syntax without accessing the vault or requiring the referenced file to exist. */
function isSafeOptionalPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return normalizeVaultPath(value) === value;
  } catch {
    return false;
  }
}

/** Human-readable maps must not hide arrays, numbers, or executable values. */
function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, entry]) => key.trim().length > 0 && typeof entry === 'string'
    )
  );
}

/** Decimal strings are persisted exactly so later unit conversion does not introduce float drift. */
function isPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$/u.test(value);
}

/** Adds one optional string using domain naming without spreading undefined values. */
function optionalString(
  fields: Readonly<Record<string, unknown>>,
  storageKey: string,
  domainKey: string
): Readonly<Record<string, string>> {
  const value = fields[storageKey];
  return typeof value === 'string' ? { [domainKey]: value } : {};
}

/** Adds one optional number using domain naming without weakening exact optional types. */
function optionalNumber(
  fields: Readonly<Record<string, unknown>>,
  storageKey: string,
  domainKey: string
): Readonly<Record<string, number>> {
  const value = fields[storageKey];
  return typeof value === 'number' ? { [domainKey]: value } : {};
}
