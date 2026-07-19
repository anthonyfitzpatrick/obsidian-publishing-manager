/**
 * Coordinates MET-001–MET-007 canonical metadata sets through the lossless record repository.
 * One book set stores defaults and at most one set per edition stores explicit overrides. The
 * service derives effective values, provenance, coverage, and plain-text exports in memory; it
 * never copies those projections into canonical notes and performs no classification lookup.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type {
  LoadedManagedRecord,
  ManagedRecordRepositoryPort
} from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import {
  METADATA_COMPLETENESS_PROFILES,
  assessMetadataCompleteness,
  clearMetadataOverride,
  descriptionMarkdownToPlainText,
  resolveEffectiveMetadata,
  validateMetadataValues,
  type EffectiveMetadata,
  type MetadataCompletenessProfile,
  type MetadataCoverage,
  type MetadataFieldKey,
  type MetadataValues
} from '../../domain/metadata/metadata-set';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { VaultPath } from '../../domain/storage/vault-path';

/** Local classification labels identify the standards used to validate user-entered codes. */
export const METADATA_CLASSIFICATION_VERSIONS = {
  bisac: '2025-online-reference',
  thema: '1.6'
} as const;

/** Effective projection pairs record scope with exact field provenance and profile coverage. */
export interface ResolvedMetadataProject {
  readonly bookRecord?: CatalogRecord;
  readonly editionRecord?: CatalogRecord;
  readonly effective: EffectiveMetadata;
  readonly coverage: MetadataCoverage;
  readonly profile: MetadataCompletenessProfile;
}

/** Focused errors keep user guidance stable without exposing repository implementation details. */
export class MetadataProjectServiceError extends Error {
  public constructor(
    public readonly code:
      | 'book-not-found'
      | 'edition-not-found'
      | 'metadata-invalid'
      | 'metadata-not-found'
      | 'record-type-invalid',
    message: string
  ) {
    super(message);
    this.name = 'MetadataProjectServiceError';
  }
}

/** Application service owns canonical set creation/update and delegates all derivation to domain code. */
export class MetadataProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Returns deterministic book/edition set records, rejecting duplicate ambiguity through catalog diagnostics. */
  public recordsForBook(bookId: string): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType('metadata-set')
      .filter((record) => record.fields['book-id'] === bookId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Saves progressive book defaults, seeding immutable identity/language from the canonical book when first created. */
  public async saveBookValues(bookId: string, values: MetadataValues): Promise<CatalogRecord> {
    const book = this.requireBook(bookId);
    const seeded: MetadataValues = {
      title: book.fields.title,
      language: book.fields['primary-language'],
      ...values
    };
    return this.saveScope(bookId, undefined, seeded);
  }

  /** Saves only explicit edition overrides; inherited values are never copied into this record. */
  public async saveEditionOverrides(
    editionId: string,
    overrides: MetadataValues
  ): Promise<CatalogRecord> {
    const edition = this.requireEdition(editionId);
    return this.saveScope(String(edition.fields['book-id']), editionId, overrides);
  }

  /** Removes exactly one edition override and immediately restores book-level inheritance. */
  public async clearEditionOverride(
    editionId: string,
    key: MetadataFieldKey
  ): Promise<CatalogRecord> {
    const record = this.scopeRecord(
      String(this.requireEdition(editionId).fields['book-id']),
      editionId
    );
    if (record === undefined)
      throw new MetadataProjectServiceError(
        'metadata-not-found',
        'This edition has no override record to clear.'
      );
    return this.saveEditionOverrides(
      editionId,
      clearMetadataOverride(asMetadataValues(record.fields.values), key)
    );
  }

  /** Resolves one edition over book defaults and evaluates an explicit local completeness profile. */
  public resolve(
    bookId: string,
    editionId?: string,
    profileId = 'core-book'
  ): ResolvedMetadataProject {
    this.requireBook(bookId);
    if (editionId !== undefined) {
      const edition = this.requireEdition(editionId);
      if (edition.fields['book-id'] !== bookId)
        throw new MetadataProjectServiceError(
          'edition-not-found',
          'The selected edition does not belong to this book.'
        );
    }
    const bookRecord = this.scopeRecord(bookId);
    const editionRecord = editionId === undefined ? undefined : this.scopeRecord(bookId, editionId);
    const effective = resolveEffectiveMetadata(
      bookRecord === undefined ? {} : asMetadataValues(bookRecord.fields.values),
      editionRecord === undefined ? {} : asMetadataValues(editionRecord.fields.values)
    );
    const profile = METADATA_COMPLETENESS_PROFILES.find(({ id }) => id === profileId);
    if (profile === undefined)
      throw new MetadataProjectServiceError(
        'metadata-invalid',
        `Unknown metadata completeness profile ${profileId}.`
      );
    return {
      ...(bookRecord === undefined ? {} : { bookRecord }),
      ...(editionRecord === undefined ? {} : { editionRecord }),
      effective,
      coverage: assessMetadataCompleteness(effective, profile),
      profile
    };
  }

  /** Exports one effective description deterministically while preserving Markdown as canonical source. */
  public exportDescription(
    bookId: string,
    editionId: string | undefined,
    field: 'long-description-markdown' | 'short-description-markdown'
  ): string {
    const value = this.resolve(bookId, editionId).effective.fields[field].value;
    return typeof value === 'string' ? descriptionMarkdownToPlainText(value) : '';
  }

  /** Creates or updates one scoped set after complete domain validation. */
  private async saveScope(
    bookId: string,
    editionId: string | undefined,
    values: MetadataValues
  ): Promise<CatalogRecord> {
    const diagnostics = validateMetadataValues(values);
    if (diagnostics.length > 0)
      throw new MetadataProjectServiceError(
        'metadata-invalid',
        diagnostics.map(({ message }) => message).join(' ')
      );
    const existing = this.scopeRecord(bookId, editionId);
    const fields = {
      'book-id': bookId,
      ...(editionId === undefined ? {} : { 'edition-id': editionId }),
      scope: editionId === undefined ? 'book' : 'edition',
      values: structuredClone(values),
      'bisac-version': METADATA_CLASSIFICATION_VERSIONS.bisac,
      'thema-version': METADATA_CLASSIFICATION_VERSIONS.thema
    };
    if (existing === undefined) {
      const now = this.now();
      const book = this.requireBook(bookId);
      const path = this.layout.collisionSafePath(
        'metadata-set',
        `${String(book.fields.title)} ${editionId === undefined ? 'book metadata' : `${editionId} overrides`}`,
        this.catalog.knownPaths()
      );
      const loaded = await this.repository.create(path, {
        envelope: {
          pmId: managedMetadataId(this.ids.generate()),
          pmType: 'metadata-set',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields,
        body: '# Metadata notes\n\nMarkdown descriptions remain inside the readable `values` object.\n'
      });
      this.catalog.accept(loaded, 'created');
      return this.catalog.recordById(loaded.envelope.pmId)!;
    }
    const loaded = await this.requireMetadata(existing.path);
    const saved = await this.repository.save(loaded, { fields }, this.now());
    this.catalog.accept(saved, 'modified');
    return this.catalog.recordById(saved.envelope.pmId)!;
  }

  private scopeRecord(bookId: string, editionId?: string): CatalogRecord | undefined {
    return this.recordsForBook(bookId).find((record) =>
      editionId === undefined
        ? record.fields['edition-id'] === undefined
        : record.fields['edition-id'] === editionId
    );
  }
  private requireBook(id: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'book')
      throw new MetadataProjectServiceError('book-not-found', 'Choose one valid book.');
    return record;
  }
  private requireEdition(id: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'edition')
      throw new MetadataProjectServiceError('edition-not-found', 'Choose one valid edition.');
    return record;
  }
  private async requireMetadata(path: VaultPath): Promise<LoadedManagedRecord> {
    const loaded = await this.repository.load(path);
    if (loaded.envelope.pmType !== 'metadata-set')
      throw new MetadataProjectServiceError(
        'record-type-invalid',
        'The selected record is not metadata.'
      );
    return loaded;
  }
  private now(): string {
    return this.clock.now().toISOString();
  }
}

function asMetadataValues(value: unknown): MetadataValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
function managedMetadataId(generated: string): string {
  const safe = generated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8)
    throw new MetadataProjectServiceError('metadata-invalid', 'Identity generator failed.');
  return `pm-metadata-${safe}`;
}
