/**
 * Defines MET-001–MET-006 metadata values, validation, inheritance, provenance, completeness, and
 * deterministic description export without Obsidian or storage dependencies. Book-level values
 * and edition override values use the same readable object shape. Missing overrides inherit;
 * explicit empty strings are invalid so clearing an override has one unambiguous meaning.
 */

/** Stable field vocabulary used by storage, provenance rows, profiles, and grouped UI controls. */
export const METADATA_FIELD_KEYS = [
  'title',
  'subtitle',
  'series-title',
  'series-number',
  'long-description-markdown',
  'short-description-markdown',
  'keywords',
  'bisac-codes',
  'thema-codes',
  'audience',
  'publisher',
  'imprint',
  'copyright',
  'contributors',
  'edition-statement',
  'language',
  'reading-age-min',
  'reading-age-max'
] as const;

export type MetadataFieldKey = (typeof METADATA_FIELD_KEYS)[number];
export type MetadataValues = Partial<Readonly<Record<MetadataFieldKey, unknown>>>;
export type MetadataSource = 'book' | 'edition' | 'missing';

/** Contributor role stays human-readable while retaining a structured name/role pair. */
export interface MetadataContributor {
  readonly name: string;
  readonly role: string;
}

/** One effective field names its exact origin so the UI never hides inherited values. */
export interface EffectiveMetadataField {
  readonly key: MetadataFieldKey;
  readonly value?: unknown;
  readonly source: MetadataSource;
}

/** Complete resolved metadata projection used by coverage and export without becoming canonical. */
export interface EffectiveMetadata {
  readonly fields: Readonly<Record<MetadataFieldKey, EffectiveMetadataField>>;
}

/** Repair-oriented diagnostic shared by service, catalog, tests, and UI. */
export interface MetadataDiagnostic {
  readonly field: MetadataFieldKey | 'values';
  readonly message: string;
}

/** Profile applicability remains explicit rather than guessing platform requirements. */
export interface MetadataCompletenessProfile {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly formatKinds: readonly string[];
  readonly platforms: readonly string[];
  readonly territories: readonly string[];
  readonly requiredFields: readonly MetadataFieldKey[];
}

/** Coverage reports exact missing fields plus a stable ratio; it is guidance, not retailer proof. */
export interface MetadataCoverage {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly complete: boolean;
  readonly present: number;
  readonly required: number;
  readonly percent: number;
  readonly missing: readonly MetadataFieldKey[];
  readonly explanation: string;
}

/** Local profile versions ship with plugin code and make completeness reproducible after reload. */
export const METADATA_COMPLETENESS_PROFILES: readonly MetadataCompletenessProfile[] = [
  {
    id: 'core-book',
    version: 1,
    label: 'Core book metadata',
    formatKinds: [],
    platforms: [],
    territories: [],
    requiredFields: [
      'title',
      'long-description-markdown',
      'language',
      'publisher',
      'copyright',
      'contributors'
    ]
  },
  {
    id: 'print-general',
    version: 1,
    label: 'General print edition',
    formatKinds: ['print-interior-pdf', 'print-cover-pdf'],
    platforms: [],
    territories: [],
    requiredFields: [
      'title',
      'long-description-markdown',
      'short-description-markdown',
      'keywords',
      'bisac-codes',
      'thema-codes',
      'audience',
      'publisher',
      'copyright',
      'contributors',
      'edition-statement',
      'language'
    ]
  },
  {
    id: 'digital-general',
    version: 1,
    label: 'General digital edition',
    formatKinds: ['epub', 'pdf', 'html'],
    platforms: [],
    territories: [],
    requiredFields: [
      'title',
      'long-description-markdown',
      'short-description-markdown',
      'keywords',
      'bisac-codes',
      'thema-codes',
      'audience',
      'publisher',
      'copyright',
      'contributors',
      'language'
    ]
  },
  {
    id: 'audio-general',
    version: 1,
    label: 'General audiobook edition',
    formatKinds: ['m4b', 'mp3'],
    platforms: [],
    territories: [],
    requiredFields: [
      'title',
      'long-description-markdown',
      'short-description-markdown',
      'keywords',
      'bisac-codes',
      'thema-codes',
      'audience',
      'publisher',
      'contributors',
      'edition-statement',
      'language'
    ]
  }
];

/**
 * Validates every supplied value and returns all defects. `partial` is true for edition override
 * records; book sets still allow progressive completion, with profile coverage naming omissions.
 */
export function validateMetadataValues(values: unknown): readonly MetadataDiagnostic[] {
  if (!isRecord(values))
    return [{ field: 'values', message: 'Metadata values must be an object.' }];
  const diagnostics: MetadataDiagnostic[] = [];
  for (const key of Object.keys(values))
    if (!(METADATA_FIELD_KEYS as readonly string[]).includes(key))
      diagnostics.push({ field: 'values', message: `Unknown metadata field ${key}.` });
  for (const key of textFields) {
    const value = values[key];
    if (value !== undefined && !isTrimmedText(value, textLimit(key)))
      diagnostics.push({ field: key, message: `${key} must be non-empty trimmed text.` });
  }
  for (const key of ['keywords', 'bisac-codes', 'thema-codes'] as const) {
    const value = values[key];
    if (value !== undefined && !isUniqueTextList(value))
      diagnostics.push({ field: key, message: `${key} must be a unique trimmed text list.` });
  }
  if (isUniqueTextList(values['bisac-codes']))
    for (const code of values['bisac-codes'])
      if (!/^[A-Z]{3}\d{6}$/u.test(code))
        diagnostics.push({
          field: 'bisac-codes',
          message: `BISAC code ${code} has invalid syntax.`
        });
  if (isUniqueTextList(values['thema-codes']))
    for (const code of values['thema-codes'])
      if (!/^[A-Z0-9]{2,8}$/u.test(code))
        diagnostics.push({
          field: 'thema-codes',
          message: `Thema code ${code} has invalid syntax.`
        });
  if (values.contributors !== undefined && !isContributors(values.contributors))
    diagnostics.push({
      field: 'contributors',
      message: 'Contributors must contain unique, trimmed name and role pairs.'
    });
  for (const key of ['reading-age-min', 'reading-age-max'] as const)
    if (values[key] !== undefined && !isAge(values[key]))
      diagnostics.push({ field: key, message: `${key} must be a whole age from 0 through 120.` });
  if (
    isAge(values['reading-age-min']) &&
    isAge(values['reading-age-max']) &&
    values['reading-age-min'] > values['reading-age-max']
  )
    diagnostics.push({
      field: 'reading-age-max',
      message: 'Maximum reading age cannot be lower than minimum reading age.'
    });
  return diagnostics;
}

/** Validates record scope/relationships/version labels before catalog projection accepts a set. */
export function validateMetadataSet(
  fields: Readonly<Record<string, unknown>>
): readonly MetadataDiagnostic[] {
  const diagnostics = [...validateMetadataValues(fields.values)];
  if (typeof fields['book-id'] !== 'string')
    diagnostics.push({ field: 'values', message: 'Metadata requires one book identity.' });
  if (fields.scope !== 'book' && fields.scope !== 'edition')
    diagnostics.push({ field: 'values', message: 'Metadata scope must be book or edition.' });
  if (fields.scope === 'book' && fields['edition-id'] !== undefined)
    diagnostics.push({
      field: 'values',
      message: 'Book metadata cannot carry an edition override link.'
    });
  if (fields.scope === 'edition' && typeof fields['edition-id'] !== 'string')
    diagnostics.push({
      field: 'values',
      message: 'Edition metadata requires one edition identity.'
    });
  for (const key of ['bisac-version', 'thema-version'] as const)
    if (!isTrimmedText(fields[key], 160))
      diagnostics.push({
        field: 'values',
        message: `${key} must identify the local reference version.`
      });
  return diagnostics;
}

/** Resolves edition values over book values field by field and records exact provenance. */
export function resolveEffectiveMetadata(
  bookValues: MetadataValues,
  editionOverrides: MetadataValues = {}
): EffectiveMetadata {
  const fields = {} as Record<MetadataFieldKey, EffectiveMetadataField>;
  for (const key of METADATA_FIELD_KEYS) {
    if (editionOverrides[key] !== undefined)
      fields[key] = { key, value: cloneValue(editionOverrides[key]), source: 'edition' };
    else if (bookValues[key] !== undefined)
      fields[key] = { key, value: cloneValue(bookValues[key]), source: 'book' };
    else fields[key] = { key, source: 'missing' };
  }
  return { fields };
}

/** Removes exactly one override so the next resolution immediately inherits the book value. */
export function clearMetadataOverride(
  overrides: MetadataValues,
  key: MetadataFieldKey
): MetadataValues {
  const next = { ...overrides };
  delete next[key];
  return next;
}

/** Evaluates a named local profile and preserves exact missing field identities. */
export function assessMetadataCompleteness(
  effective: EffectiveMetadata,
  profile: MetadataCompletenessProfile
): MetadataCoverage {
  const missing = profile.requiredFields.filter(
    (key) => !hasMeaningfulValue(effective.fields[key].value)
  );
  const present = profile.requiredFields.length - missing.length;
  const percent =
    profile.requiredFields.length === 0
      ? 100
      : Math.round((present / profile.requiredFields.length) * 100);
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    complete: missing.length === 0,
    present,
    required: profile.requiredFields.length,
    percent,
    missing,
    explanation:
      missing.length === 0
        ? `All ${profile.requiredFields.length} fields required by ${profile.label} v${profile.version} are present.`
        : `${missing.length} fields required by ${profile.label} v${profile.version} are missing: ${missing.join(', ')}.`
  };
}

/**
 * Produces deterministic plain text from supported Markdown description syntax. It keeps link and
 * image labels, normalizes line endings/space, removes formatting markers, and never executes or
 * renders embedded HTML. Identical Markdown always yields identical export text.
 */
export function descriptionMarkdownToPlainText(markdown: string): string {
  return markdown
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[*_~]+/gu, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .join('\n');
}

const textFields = [
  'title',
  'subtitle',
  'series-title',
  'series-number',
  'long-description-markdown',
  'short-description-markdown',
  'audience',
  'publisher',
  'imprint',
  'copyright',
  'edition-statement',
  'language'
] as const;

function textLimit(key: (typeof textFields)[number]): number {
  if (key.includes('description')) return 20_000;
  return key === 'title' || key === 'subtitle' ? 500 : 1_000;
}
function isTrimmedText(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= limit
  );
}
function isUniqueTextList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => isTrimmedText(entry, 500)) &&
    new Set(value).size === value.length
  );
}
function isContributors(value: unknown): value is readonly MetadataContributor[] {
  if (!Array.isArray(value)) return false;
  const pairs = value.map((candidate) =>
    isRecord(candidate) && isTrimmedText(candidate.name, 500) && isTrimmedText(candidate.role, 160)
      ? `${candidate.name}\u0000${candidate.role}`
      : undefined
  );
  return pairs.every((pair) => pair !== undefined) && new Set(pairs).size === pairs.length;
}
function isAge(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 120;
}
function hasMeaningfulValue(value: unknown): boolean {
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function cloneValue(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}
