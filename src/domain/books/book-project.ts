/**
 * Defines the M1 book aggregate independently of storage paths and Obsidian classes. The aggregate
 * keeps stable identity in the shared envelope while exposing only the book fields that this
 * milestone can safely edit. Validation returns all actionable problems instead of coercing user
 * input, so application and UI layers can preserve drafts and point to the exact field to repair.
 */

import type { ManagedRecordEnvelope } from '../records/record-envelope';

/** Minimal structural input required to hydrate a book without importing application ports. */
export interface BookRecordSnapshot {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Stable lifecycle categories supported by the first book vertical slice. */
export const BOOK_STATUSES = [
  'planned',
  'active',
  'ready',
  'published',
  'suspended',
  'archived'
] as const;

/** Book lifecycle value persisted as the schema-one `status` field. */
export type BookStatus = (typeof BOOK_STATUSES)[number];

/** Editable identity and summary fields accepted by create and update use cases. */
export interface BookProjectFields {
  readonly title: string;
  readonly primaryLanguage: string;
  readonly status: BookStatus;
  readonly summary?: string;
  /** Optional user-owned vault image path used as the Project's visual cover. */
  readonly cover?: string;
  readonly seriesId?: string;
  readonly seriesPosition?: number;
}

/** Hydrated book snapshot; path and source revision remain persistence concerns. */
export interface BookProject extends BookProjectFields {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

/** Stable field-level diagnostic used for inline validation and catalog repair guidance. */
export interface BookProjectDiagnostic {
  readonly code:
    | 'book.invalid-language'
    | 'book.invalid-series-position'
    | 'book.invalid-status'
    | 'book.missing-series-for-position'
    | 'book.summary-too-long'
    | 'book.title-not-trimmed'
    | 'book.title-required';
  readonly field: keyof BookProjectFields;
  readonly message: string;
}

/** Checks the M1 business invariants without modifying the supplied draft. */
export function validateBookProject(
  fields: Readonly<Record<string, unknown>>
): readonly BookProjectDiagnostic[] {
  const diagnostics: BookProjectDiagnostic[] = [];
  const title = fields.title;
  const language = fields['primary-language'];
  const status = fields.status;
  const summary = fields.summary;
  const seriesId = fields['series-id'];
  const seriesPosition = fields['series-position'];
  const cover = fields.cover;

  if (typeof title !== 'string' || title.trim().length === 0) {
    diagnostics.push({
      code: 'book.title-required',
      field: 'title',
      message: 'Enter a book title.'
    });
  } else if (title !== title.trim()) {
    diagnostics.push({
      code: 'book.title-not-trimmed',
      field: 'title',
      message: 'Remove leading or trailing whitespace from the book title.'
    });
  }

  if (typeof language !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)) {
    diagnostics.push({
      code: 'book.invalid-language',
      field: 'primaryLanguage',
      message: 'Enter a language tag such as en, en-GB, or sv.'
    });
  }

  if (typeof status !== 'string' || !isBookStatus(status)) {
    diagnostics.push({
      code: 'book.invalid-status',
      field: 'status',
      message: `Choose one of: ${BOOK_STATUSES.join(', ')}.`
    });
  }

  if (summary !== undefined && (typeof summary !== 'string' || summary.length > 4000)) {
    diagnostics.push({
      code: 'book.summary-too-long',
      field: 'summary',
      message: 'Book summary must be text no longer than 4,000 characters.'
    });
  }

  if (cover !== undefined && (typeof cover !== 'string' || cover.trim().length === 0)) {
    diagnostics.push({
      code: 'book.summary-too-long',
      field: 'cover',
      message: 'Cover image path must be a non-empty vault path.'
    });
  }

  if (
    seriesPosition !== undefined &&
    (typeof seriesPosition !== 'number' ||
      !Number.isSafeInteger(seriesPosition) ||
      seriesPosition < 1)
  ) {
    diagnostics.push({
      code: 'book.invalid-series-position',
      field: 'seriesPosition',
      message: 'Series position must be a positive whole number.'
    });
  }

  if (seriesPosition !== undefined && (typeof seriesId !== 'string' || seriesId.length === 0)) {
    diagnostics.push({
      code: 'book.missing-series-for-position',
      field: 'seriesId',
      message: 'Choose a series before assigning a series position.'
    });
  }

  return diagnostics;
}

/** Converts one validated repository snapshot into the immutable book aggregate. */
export function hydrateBookProject(record: BookRecordSnapshot): BookProject {
  if (record.envelope.pmType !== 'book') {
    throw new Error(`Expected a book record but found ${record.envelope.pmType}.`);
  }

  const diagnostics = validateBookProject(record.fields);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map(({ message }) => message).join(' '));
  }

  const title = record.fields.title as string;
  const primaryLanguage = record.fields['primary-language'] as string;
  const status = record.fields.status as BookStatus;
  const summary = record.fields.summary;
  const seriesId = record.fields['series-id'];
  const seriesPosition = record.fields['series-position'];
  const cover = record.fields.cover;
  return {
    id: record.envelope.pmId,
    title,
    primaryLanguage,
    status,
    createdAt: record.envelope.createdAt,
    updatedAt: record.envelope.updatedAt,
    ...(record.envelope.archivedAt === undefined ? {} : { archivedAt: record.envelope.archivedAt }),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(typeof cover === 'string' ? { cover } : {}),
    ...(typeof seriesId === 'string' ? { seriesId } : {}),
    ...(typeof seriesPosition === 'number' ? { seriesPosition } : {})
  };
}

/** Narrows untrusted status text to the stable book lifecycle vocabulary. */
export function isBookStatus(value: string): value is BookStatus {
  return (BOOK_STATUSES as readonly string[]).includes(value);
}
