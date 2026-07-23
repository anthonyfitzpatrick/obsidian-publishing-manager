/**
 * Coordinates ISBN-001–ISBN-006 through canonical Markdown records. Every state change has a
 * preview carrying the source revision it was based on; apply reloads that record and refuses stale
 * previews. Published identifiers can only become retired through an explicit correction receipt.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type {
  LoadedManagedRecord,
  ManagedRecordRepositoryPort
} from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { normalizeIsbn, type IsbnState } from '../../domain/isbn/isbn-record';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { VaultPath } from '../../domain/storage/vault-path';

export type IsbnAction = 'reserve' | 'assign' | 'release' | 'publish' | 'retire' | 'correct';

export interface IsbnTransactionPreview {
  readonly recordId: string;
  readonly action: IsbnAction;
  readonly sourceRevision: string;
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
  readonly explanation: string;
  readonly warnings: readonly string[];
}

export interface IsbnImportRow {
  readonly row: number;
  readonly input: string;
  readonly normalized?: string;
  readonly isbn10?: string;
  readonly status: 'ready' | 'duplicate-file' | 'duplicate-pool' | 'invalid';
  readonly message: string;
}

export interface IsbnImportPreview {
  readonly rows: readonly IsbnImportRow[];
  readonly ready: number;
  readonly rejected: number;
}

export class IsbnProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  public records(): readonly CatalogRecord[] {
    return this.catalog.recordsOfType('isbn');
  }

  /** Previews every non-empty line independently and reports both file-local and pool duplicates. */
  public previewImport(text: string): IsbnImportPreview {
    const existing = new Set(this.records().map((record) => String(record.fields.value)));
    const seen = new Set<string>();
    const rows = text.split(/\r?\n/u).flatMap((raw, index): IsbnImportRow[] => {
      const input = raw.trim();
      if (!input) return [];
      try {
        const normalized = normalizeIsbn(input);
        const status = existing.has(normalized.isbn13)
          ? 'duplicate-pool'
          : seen.has(normalized.isbn13)
            ? 'duplicate-file'
            : 'ready';
        seen.add(normalized.isbn13);
        return [
          {
            row: index + 1,
            input,
            normalized: normalized.isbn13,
            ...(normalized.isbn10 === undefined ? {} : { isbn10: normalized.isbn10 }),
            status,
            message:
              status === 'ready'
                ? 'Ready to add as available.'
                : status === 'duplicate-pool'
                  ? 'Already exists in the ISBN pool.'
                  : 'Repeated earlier in this import.'
          }
        ];
      } catch (cause) {
        return [{ row: index + 1, input, status: 'invalid', message: errorMessage(cause) }];
      }
    });
    return {
      rows,
      ready: rows.filter(({ status }) => status === 'ready').length,
      rejected: rows.filter(({ status }) => status !== 'ready').length
    };
  }

  /** Applies only rows proven ready by a fresh preview; rejected rows are never partially coerced. */
  public async applyImport(
    text: string,
    defaults: { publisher?: string; imprint?: string; acquisitionNote?: string } = {}
  ): Promise<readonly CatalogRecord[]> {
    const preview = this.previewImport(text);
    const created: CatalogRecord[] = [];
    for (const row of preview.rows.filter((candidate) => candidate.status === 'ready')) {
      if (row.normalized !== undefined)
        created.push(await this.createAvailable(row.normalized, row.isbn10, defaults));
    }
    return created;
  }

  /** Builds an exact before/after proposal and validates relationships without writing. */
  public previewTransaction(input: {
    recordId: string;
    action: IsbnAction;
    editionId?: string;
    formatId?: string;
    reason?: string;
  }): IsbnTransactionPreview {
    const record = this.requireIsbn(input.recordId);
    const before = structuredClone(record.fields);
    const after = this.nextFields(record, input);
    return {
      recordId: record.id,
      action: input.action,
      sourceRevision: record.sourceRevision,
      before,
      after,
      explanation: `${String(before.status)} → ${String(after.status)} for ISBN ${String(before.value)}.`,
      warnings:
        input.action === 'release'
          ? [
              'Release removes the reservation/assignment but preserves the ISBN record and history.'
            ]
          : input.action === 'correct'
            ? [
                'A published ISBN is never made available again; correction retires it with a reason.'
              ]
            : []
    };
  }

  /** Applies a preview only while its source revision is still current. */
  public async applyTransaction(preview: IsbnTransactionPreview): Promise<CatalogRecord> {
    const record = this.requireIsbn(preview.recordId);
    if (record.sourceRevision !== preview.sourceRevision)
      throw new Error('ISBN changed after preview. Review the latest state before applying.');
    const loaded = await this.requireLoaded(record.path);
    const saved = await this.repository.save(
      loaded,
      { fields: replacementPatch(preview.before, preview.after) },
      this.now()
    );
    this.catalog.accept(saved, 'modified');
    return this.catalog.recordById(record.id)!;
  }

  private nextFields(
    record: CatalogRecord,
    input: { action: IsbnAction; editionId?: string; formatId?: string; reason?: string }
  ): Readonly<Record<string, unknown>> {
    const status = record.fields.status as IsbnState;
    const now = this.now();
    if (input.action === 'reserve' || input.action === 'assign') {
      if (input.action === 'reserve' && status !== 'available')
        throw new Error('Only an available ISBN can be reserved.');
      if (input.action === 'assign' && !['available', 'reserved'].includes(status))
        throw new Error('Only an available or reserved ISBN can be assigned.');
      const edition = this.requireEdition(input.editionId);
      const format =
        input.formatId === undefined ? undefined : this.requireFormat(input.formatId, edition.id);
      this.assertPermanentAssociation(record, edition.id, format?.id);
      this.assertAssignmentAvailable(edition.id, format?.id, record.id);
      return {
        ...omitAssignment({ ...record.fields }),
        // ISBN import data remains authoritative when already present. Otherwise the assigned
        // Publishing Item inherits the master Project's default identity at assignment time.
        ...(input.action === 'assign' ? this.projectPublisherIdentity(record, edition) : {}),
        status: input.action === 'reserve' ? 'reserved' : 'assigned',
        'edition-id': edition.id,
        ...(format === undefined ? {} : { 'format-id': format.id }),
        // ISBN is a global primary key. These fields intentionally survive release, retirement,
        // and correction so a previously associated identifier cannot be taken by another item.
        'associated-edition-id': edition.id,
        ...(format === undefined ? {} : { 'associated-format-id': format.id }),
        'associated-at':
          typeof record.fields['associated-at'] === 'string' ? record.fields['associated-at'] : now,
        ...(input.action === 'assign' ? { 'assigned-at': now } : {})
      };
    }
    if (input.action === 'release') {
      if (!['reserved', 'assigned'].includes(status))
        throw new Error('Only a reserved or unpublished assigned ISBN can be released.');
      return omitAssignment({ ...record.fields, status: 'available' });
    }
    if (input.action === 'publish') {
      if (status !== 'assigned') throw new Error('Assign the ISBN before marking it published.');
      return { ...record.fields, status: 'published', 'published-at': now };
    }
    if (input.action === 'correct') {
      if (status !== 'published') throw new Error('Corrections are reserved for published ISBNs.');
      const reason = requiredText(input.reason, 'Explain the published-identifier correction.');
      const corrections = correctionEntries(record.fields.corrections);
      const editionId = requiredText(
        typeof record.fields['edition-id'] === 'string' ? record.fields['edition-id'] : undefined,
        'Published ISBN has no edition assignment to preserve in its correction history.'
      );
      return omitAssignment({
        ...record.fields,
        status: 'retired',
        corrections: {
          entries: [
            ...corrections,
            {
              reason,
              recordedAt: now,
              previousStatus: 'published',
              editionId,
              ...(typeof record.fields['format-id'] === 'string'
                ? { formatId: record.fields['format-id'] }
                : {}),
              ...(typeof record.fields['published-at'] === 'string'
                ? { publishedAt: record.fields['published-at'] }
                : {})
            }
          ]
        }
      });
    }
    if (input.action === 'retire') {
      if (status === 'published')
        throw new Error('Use Record correction for a published ISBN so the reason is retained.');
      if (status === 'retired') throw new Error('ISBN is already retired.');
      return omitAssignment({ ...record.fields, status: 'retired' });
    }
    throw new Error('Unsupported ISBN transaction.');
  }

  private async createAvailable(
    isbn13: string,
    isbn10: string | undefined,
    defaults: { publisher?: string; imprint?: string; acquisitionNote?: string }
  ): Promise<CatalogRecord> {
    const now = this.now();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath('isbn', isbn13, this.catalog.knownPaths()),
      {
        envelope: {
          pmId: `pm-isbn-${safeId(this.ids.generate())}`,
          pmType: 'isbn',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields: {
          value: isbn13,
          ...(isbn10 === undefined ? {} : { 'isbn-10': isbn10 }),
          status: 'available',
          ...(trimmed(defaults.publisher) === undefined
            ? {}
            : { publisher: trimmed(defaults.publisher) }),
          ...(trimmed(defaults.imprint) === undefined
            ? {}
            : { imprint: trimmed(defaults.imprint) }),
          ...(trimmed(defaults.acquisitionNote) === undefined
            ? {}
            : { 'acquisition-note': trimmed(defaults.acquisitionNote) })
        },
        body: '# ISBN notes\n\nLifecycle changes are performed through previewed Publishing Manager transactions.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
    return this.catalog.recordById(loaded.envelope.pmId)!;
  }

  private assertAssignmentAvailable(
    editionId: string,
    formatId: string | undefined,
    exceptId: string
  ): void {
    const conflict = this.records().find(
      (candidate) =>
        candidate.id !== exceptId &&
        ['reserved', 'assigned', 'published'].includes(String(candidate.fields.status)) &&
        candidate.fields['edition-id'] === editionId &&
        candidate.fields['format-id'] === formatId
    );
    if (conflict !== undefined)
      throw new Error(
        `ISBN ${String(conflict.fields.value)} already occupies that edition/format assignment.`
      );
  }
  /** Rejects a second target even after a release: global ISBN identity is never recyclable. */
  private assertPermanentAssociation(
    record: CatalogRecord,
    editionId: string,
    formatId: string | undefined
  ): void {
    const associatedEdition = record.fields['associated-edition-id'];
    if (associatedEdition === undefined) return;
    // A format is a refinement within an edition, not a different publication item. Allow a
    // reviewed reserve/assign action to refine or clear that format while keeping the ISBN bound
    // to its original edition. Moving to any other edition still requires the dedicated correction
    // workflow and is never silently achieved by release then assign.
    if (associatedEdition === editionId) return;
    throw new Error(
      `ISBN ${String(record.fields.value)} is permanently associated with another edition or format and cannot be reassigned.`
    );
  }
  private requireIsbn(id: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'isbn') throw new Error('Choose a valid ISBN record.');
    return record;
  }
  private requireEdition(id?: string): CatalogRecord {
    const record = id === undefined ? undefined : this.catalog.recordById(id);
    if (record?.type !== 'edition') throw new Error('Choose an edition for this ISBN.');
    return record;
  }
  /** Resolves default Project identity without inventing a country for an ISBN allocation. */
  private projectPublisherIdentity(
    isbn: CatalogRecord,
    edition: CatalogRecord
  ): Readonly<Record<string, unknown>> {
    const bookId = edition.fields['book-id'];
    const book = typeof bookId === 'string' ? this.catalog.recordById(bookId) : undefined;
    if (book?.type !== 'book') return {};
    const publisher = book.fields.publisher;
    const publisherCountry = book.fields['publisher-country'];
    const publisherVariant = book.fields['publisher-variant'];
    return {
      ...(typeof isbn.fields.publisher === 'string' || typeof publisher !== 'string'
        ? {}
        : { publisher }),
      ...(typeof isbn.fields['publisher-country'] === 'string' || typeof publisherCountry !== 'string'
        ? {}
        : { 'publisher-country': publisherCountry }),
      ...(typeof isbn.fields['publisher-variant'] === 'string' || typeof publisherVariant !== 'string'
        ? {}
        : { 'publisher-variant': publisherVariant })
    };
  }
  private requireFormat(id: string, editionId: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'format' || record.fields['edition-id'] !== editionId)
      throw new Error('Choose a format belonging to the selected edition.');
    return record;
  }
  private async requireLoaded(path: VaultPath): Promise<LoadedManagedRecord> {
    const loaded = await this.repository.load(path);
    if (loaded.envelope.pmType !== 'isbn') throw new Error('Selected record is not an ISBN.');
    return loaded;
  }
  private now(): string {
    return this.clock.now().toISOString();
  }
}

function omitAssignment(fields: Record<string, unknown>): Readonly<Record<string, unknown>> {
  delete fields['edition-id'];
  delete fields['format-id'];
  delete fields['assigned-at'];
  delete fields['published-at'];
  return fields;
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
function requiredText(value: string | undefined, message: string): string {
  const result = trimmed(value);
  if (result === undefined) throw new Error(message);
  return result;
}
function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'ISBN could not be processed.';
}

/** Turns a complete reviewed replacement into the repository's explicit lossless patch format. */
function replacementPatch(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const patch: Record<string, unknown> = { ...after };
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = undefined;
  return patch;
}

/** Reads the structured correction container defensively so malformed hand edits remain inert. */
function correctionEntries(value: unknown): readonly unknown[] {
  if (typeof value !== 'object' || value === null || !('entries' in value)) return [];
  return Array.isArray(value.entries) ? value.entries : [];
}
