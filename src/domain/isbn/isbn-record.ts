/**
 * Implements ISBN-001–ISBN-005 as a pure domain contract: normalization, check digits, lifecycle,
 * assignment identity, and immutable published-correction evidence. Hyphens and spaces are input
 * presentation only; canonical storage is always ISBN-13 so duplicate checks have one comparison.
 */

export const ISBN_STATES = ['available', 'reserved', 'assigned', 'published', 'retired'] as const;
export type IsbnState = (typeof ISBN_STATES)[number];

export interface NormalizedIsbn {
  readonly isbn13: string;
  readonly isbn10?: string;
}

export interface IsbnCorrection {
  readonly reason: string;
  readonly recordedAt: string;
  readonly previousStatus: 'published';
  readonly editionId: string;
  readonly formatId?: string;
  readonly publishedAt?: string;
}

export interface IsbnDiagnostic {
  readonly field: string;
  readonly message: string;
}

/** Removes presentation punctuation, validates the original check digit, and derives ISBN-13. */
export function normalizeIsbn(value: string): NormalizedIsbn {
  const compact = value.replace(/[\s-]+/gu, '').toUpperCase();
  if (/^\d{13}$/u.test(compact)) {
    if (!isValidIsbn13(compact)) throw new Error(`ISBN-13 ${compact} has an invalid check digit.`);
    if (!compact.startsWith('978') && !compact.startsWith('979'))
      throw new Error('ISBN-13 must use the 978 or 979 book prefix.');
    return { isbn13: compact };
  }
  if (/^\d{9}[\dX]$/u.test(compact)) {
    if (!isValidIsbn10(compact)) throw new Error(`ISBN-10 ${compact} has an invalid check digit.`);
    return { isbn13: isbn10To13(compact), isbn10: compact };
  }
  throw new Error('Enter a valid ISBN-10 or ISBN-13; spaces and hyphens are optional.');
}

/** Validates canonical record fields after schema validation but before catalog acceptance. */
export function validateIsbnRecord(
  fields: Readonly<Record<string, unknown>>
): readonly IsbnDiagnostic[] {
  const diagnostics: IsbnDiagnostic[] = [];
  let normalized: NormalizedIsbn | undefined;
  try {
    if (typeof fields.value !== 'string') throw new Error('ISBN value must be text.');
    normalized = normalizeIsbn(fields.value);
    if (normalized.isbn13 !== fields.value)
      diagnostics.push({
        field: 'value',
        message: 'ISBN value must be stored as normalized ISBN-13.'
      });
  } catch (cause) {
    diagnostics.push({ field: 'value', message: errorMessage(cause) });
  }
  if (!(ISBN_STATES as readonly unknown[]).includes(fields.status))
    diagnostics.push({ field: 'status', message: 'ISBN status is not supported.' });
  const assigned =
    fields.status === 'reserved' || fields.status === 'assigned' || fields.status === 'published';
  if (assigned && typeof fields['edition-id'] !== 'string')
    diagnostics.push({
      field: 'edition-id',
      message: `${String(fields.status)} ISBN requires an edition.`
    });
  if (!assigned && (fields['edition-id'] !== undefined || fields['format-id'] !== undefined))
    diagnostics.push({
      field: 'edition-id',
      message: `${String(fields.status)} ISBN cannot retain an assignment.`
    });
  if (fields['format-id'] !== undefined && typeof fields['format-id'] !== 'string')
    diagnostics.push({ field: 'format-id', message: 'Format identity must be text.' });
  if (fields.corrections !== undefined && !isCorrections(fields.corrections))
    diagnostics.push({
      field: 'corrections',
      message: 'ISBN corrections must retain reason, timestamp, and published status.'
    });
  if (normalized !== undefined && fields['isbn-10'] !== undefined) {
    if (typeof fields['isbn-10'] !== 'string' || !isValidIsbn10(fields['isbn-10']))
      diagnostics.push({ field: 'isbn-10', message: 'Optional ISBN-10 display is invalid.' });
    else if (isbn10To13(fields['isbn-10']) !== normalized.isbn13)
      diagnostics.push({
        field: 'isbn-10',
        message: 'ISBN-10 does not identify the stored ISBN-13.'
      });
  }
  return diagnostics;
}

export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/u.test(value)) return false;
  const sum = [...value].reduce(
    (total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index),
    0
  );
  return sum % 11 === 0;
}

export function isbn10To13(value: string): string {
  const body = `978${value.slice(0, 9)}`;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function isCorrections(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('entries' in value)) return false;
  const entries: unknown = value.entries;
  return Array.isArray(entries) && entries.every(isCorrection);
}

/** Narrows each user-editable history item before reading any of its properties. */
function isCorrection(entry: unknown): entry is IsbnCorrection {
  if (typeof entry !== 'object' || entry === null) return false;
  return (
    'reason' in entry &&
    typeof entry.reason === 'string' &&
    entry.reason.trim().length > 0 &&
    'recordedAt' in entry &&
    typeof entry.recordedAt === 'string' &&
    'previousStatus' in entry &&
    entry.previousStatus === 'published' &&
    'editionId' in entry &&
    typeof entry.editionId === 'string'
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'ISBN is invalid.';
}
