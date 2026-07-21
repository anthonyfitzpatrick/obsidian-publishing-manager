/**
 * Coordinates the complete EDN-001–EDN-008 lifecycle through canonical record repositories. The
 * service owns edition/format creation, conditional validation, previewed revision copying,
 * comparison, archival, and one-record-at-a-time dependency reassignment. It exposes no delete
 * operation: canonical editions remain recoverable evidence and referenced records are never
 * silently detached or moved.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type {
  LoadedManagedRecord,
  ManagedRecordRepositoryPort
} from '../storage/record-storage-ports';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedRecordType } from '../../domain/records/record-types';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { VaultPath } from '../../domain/storage/vault-path';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import {
  defaultMediumFor,
  editionTypeLabel,
  hydrateEditionFormat,
  hydrateEditionProject,
  mediumSupportsFormat,
  validateEditionFormat,
  validateEditionProject,
  type EditionFormat,
  type EditionMedium,
  type EditionProject,
  type EditionStatus,
  type EditionType,
  type FormatCategory
} from '../../domain/editions/edition-project';

/** Fields required to create one stable edition identity under an existing book. */
export interface CreateEditionInput {
  readonly bookId: string;
  readonly type: EditionType;
  readonly medium?: EditionMedium;
  readonly customType?: string;
  readonly status: EditionStatus;
  readonly publicationDate?: string;
  readonly cover?: string;
  readonly retailLinks?: Readonly<Record<string, string>>;
  readonly notes?: string;
  readonly trimWidth?: string;
  readonly trimHeight?: string;
  readonly trimUnit?: 'in' | 'mm';
  readonly pageCount?: number;
  readonly narrator?: string;
  readonly durationMinutes?: number;
  readonly audioMetadata?: Readonly<Record<string, string>>;
}

/** Complete editable edition state; stable type, medium, book, revision, and identity do not move. */
export interface EditEditionInput {
  readonly customType?: string | undefined;
  readonly status: EditionStatus;
  readonly publicationDate?: string | undefined;
  readonly cover?: string | undefined;
  readonly retailLinks: Readonly<Record<string, string>>;
  readonly notes?: string | undefined;
  readonly trimWidth?: string | undefined;
  readonly trimHeight?: string | undefined;
  readonly trimUnit?: 'in' | 'mm' | undefined;
  readonly pageCount?: number | undefined;
  readonly narrator?: string | undefined;
  readonly durationMinutes?: number | undefined;
  readonly audioMetadata: Readonly<Record<string, string>>;
}

/** One canonical format record links semantic output details to an optional vault file. */
export interface CreateEditionFormatInput {
  readonly editionId: string;
  readonly category: FormatCategory;
  readonly kind: string;
  readonly label?: string;
  readonly filePath?: string;
  readonly accessibility?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Revision copy groups are explicit so unchecked fields cannot slip into a new identity. */
export interface EditionRevisionSelection {
  readonly publication: boolean;
  readonly production: boolean;
  readonly marketing: boolean;
  readonly notes: boolean;
}

/** Immutable preview is safe to render before the user authorizes the new record. */
export interface EditionRevisionPreview {
  readonly sourcePath: VaultPath;
  readonly sourceRevision: string;
  readonly sourceEditionId: string;
  readonly nextRevision: number;
  readonly selection: EditionRevisionSelection;
  readonly proposedFields: Readonly<Record<string, unknown>>;
  readonly copiedFields: readonly string[];
  readonly identifierWarning: string;
  readonly formatWarning: string;
}

/** Persisted result includes the current path needed for navigation and the hydrated record. */
export interface EditionProjectResult {
  readonly path: VaultPath;
  readonly edition: EditionProject;
}

/** Format result keeps its canonical path so UI can open the human-readable note. */
export interface EditionFormatResult {
  readonly path: VaultPath;
  readonly format: EditionFormat;
}

/** Removal assessment explains why deletion is unavailable and which links can be reassigned. */
export interface EditionRemovalAssessment {
  readonly canDelete: boolean;
  readonly canArchive: true;
  readonly dependants: readonly CatalogRecord[];
  readonly explanation: string;
}

/** One comparison row always states whether its values match and where the evidence came from. */
export interface EditionComparisonRow {
  readonly group:
    'assets' | 'dates' | 'identity' | 'metadata' | 'platforms' | 'prices' | 'production';
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly equal: boolean;
}

/** Complete comparison is ordered for both accessible tables and visual grouping. */
export interface EditionComparison {
  readonly left: CatalogRecord;
  readonly right: CatalogRecord;
  readonly rows: readonly EditionComparisonRow[];
}

/** Stable application error categories support inline guidance without parsing messages. */
export class EditionProjectServiceError extends Error {
  public constructor(
    public readonly code:
      | 'edition-book-not-found'
      | 'edition-conflict'
      | 'edition-dependant-invalid'
      | 'edition-format-incompatible'
      | 'edition-invalid'
      | 'edition-not-found'
      | 'edition-revision-stale'
      | 'edition-target-invalid'
      | 'format-invalid'
      | 'record-type-invalid',
    message: string
  ) {
    super(message);
    this.name = 'EditionProjectServiceError';
  }
}

/** Application service used by the workspace and deterministic integration tests. */
export class EditionProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Creates revision one after validating the parent, type vocabulary, and conditional fields. */
  public async create(input: CreateEditionInput): Promise<EditionProjectResult> {
    return this.createWithRevision(input, 1);
  }

  /** Replaces only editable fields while preserving unknown frontmatter and unrelated note prose. */
  public async edit(path: VaultPath, input: EditEditionInput): Promise<EditionProjectResult> {
    const loaded = await this.repository.load(path);
    assertRecordType(loaded, 'edition');
    const patch = editableStorageFields(input);
    const nextFields = applyFieldPatch(loaded.fields, patch);
    assertValidEdition(nextFields);
    const saved = await this.repository.save(loaded, { fields: patch }, this.now());
    this.catalog.accept(saved, 'modified');
    return { path, edition: hydrateEditionProject(saved) };
  }

  /** Creates one separate format record; the referenced file is never opened, copied, or moved. */
  public async createFormat(input: CreateEditionFormatInput): Promise<EditionFormatResult> {
    const edition = this.requireEdition(input.editionId);
    const medium = edition.fields.medium;
    if (
      typeof medium !== 'string' ||
      !mediumSupportsFormat(medium as EditionMedium, input.category)
    ) {
      throw new EditionProjectServiceError(
        'edition-format-incompatible',
        `${input.category} formats are not valid for this edition's ${String(medium)} media category.`
      );
    }
    const fields = formatStorageFields(input);
    assertValidFormat(fields);
    const now = this.now();
    const title = `${editionTypeLabel(catalogEditionLabel(edition))} ${input.label ?? input.kind}`;
    const path = this.layout.collisionSafePath('format', title, this.catalog.knownPaths());
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: createManagedId('format', this.ids.generate()),
        pmType: 'format',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Format notes\n'
    });
    this.catalog.accept(loaded, 'created');
    return { path, format: hydrateEditionFormat(loaded) };
  }

  /** Builds a field-by-field revision proposal without writing or copying an identifier assignment. */
  public async previewRevision(
    sourcePath: VaultPath,
    selection: EditionRevisionSelection
  ): Promise<EditionRevisionPreview> {
    const loaded = await this.repository.load(sourcePath);
    assertRecordType(loaded, 'edition');
    const source = hydrateEditionProject(loaded);
    const siblings = this.catalog.editionsForBook(source.bookId);
    const nextRevision =
      Math.max(
        source.revision,
        ...siblings
          .filter(
            (record) =>
              record.fields.type === source.type &&
              record.fields['custom-type'] === source.customType
          )
          .map((record) =>
            typeof record.fields.revision === 'number' ? record.fields.revision : 0
          )
      ) + 1;
    const proposed: Record<string, unknown> = {
      'book-id': source.bookId,
      type: source.type,
      ...(source.customType === undefined ? {} : { 'custom-type': source.customType }),
      medium: source.medium,
      revision: nextRevision,
      status: 'planned',
      'source-edition-id': source.id,
      'retail-links': {}
    };
    const copiedFields: string[] = [];
    if (selection.publication)
      copyFields(loaded.fields, proposed, ['publication-date'], copiedFields);
    if (selection.production) {
      copyFields(
        loaded.fields,
        proposed,
        [
          'trim-width',
          'trim-height',
          'trim-unit',
          'page-count',
          'narrator',
          'duration-minutes',
          'audio-metadata'
        ],
        copiedFields
      );
    }
    if (selection.marketing)
      copyFields(loaded.fields, proposed, ['cover', 'retail-links'], copiedFields);
    if (selection.notes) copyFields(loaded.fields, proposed, ['notes'], copiedFields);
    assertValidEdition(proposed);
    return {
      sourcePath,
      sourceRevision: loaded.sourceRevision,
      sourceEditionId: source.id,
      nextRevision,
      selection,
      proposedFields: proposed,
      copiedFields,
      identifierWarning:
        'ISBN assignments are never copied. Review identifier policy and assign a valid ISBN separately after creating the revision.',
      formatWarning:
        'Format records are not copied automatically because every output needs its own current file and accessibility evidence.'
    };
  }

  /** Persists exactly the reviewed proposal after confirming the source has not changed. */
  public async createRevision(preview: EditionRevisionPreview): Promise<EditionProjectResult> {
    const current = await this.repository.load(preview.sourcePath);
    assertRecordType(current, 'edition');
    if (current.sourceRevision !== preview.sourceRevision) {
      throw new EditionProjectServiceError(
        'edition-revision-stale',
        'The source edition changed after preview. Review the copy choices again before creating a revision.'
      );
    }
    const input = storageFieldsToCreateInput(preview.proposedFields);
    return this.createWithRevision(input, preview.nextRevision, preview.sourceEditionId);
  }

  /** Archives without deleting the record or breaking dependent links; all dependants remain visible. */
  public async archive(path: VaultPath): Promise<EditionProjectResult> {
    return this.setArchiveState(path, true);
  }

  /** Restores a previously archived edition without modifying its status or dependent records. */
  public async restore(path: VaultPath): Promise<EditionProjectResult> {
    return this.setArchiveState(path, false);
  }

  /** Explains deletion protection and supplies the exact records eligible for explicit reassignment. */
  public assessRemoval(editionId: string): EditionRemovalAssessment {
    this.requireEdition(editionId);
    const dependants = this.catalog.dependantsOfEdition(editionId);
    return {
      canDelete: dependants.length === 0,
      canArchive: true,
      dependants,
      explanation:
        dependants.length === 0
          ? 'No dependants exist. Publishing Manager still uses archival so history remains recoverable.'
          : `${dependants.length} dependent record${dependants.length === 1 ? '' : 's'} remain linked. Archive safely or reassign each dependant before any future deletion workflow.`
    };
  }

  /** Reassigns exactly one dependant after verifying both editions belong to the same book. */
  public async reassignDependant(
    dependantPath: VaultPath,
    sourceEditionId: string,
    targetEditionId: string
  ): Promise<void> {
    const source = this.requireEdition(sourceEditionId);
    const target = this.requireEdition(targetEditionId);
    if (source.fields['book-id'] !== target.fields['book-id'] || target.archived) {
      throw new EditionProjectServiceError(
        'edition-target-invalid',
        'Choose a non-archived target edition belonging to the same book.'
      );
    }
    const loaded = await this.repository.load(dependantPath);
    if (loaded.envelope.pmType === 'edition' || loaded.fields['edition-id'] !== sourceEditionId) {
      throw new EditionProjectServiceError(
        'edition-dependant-invalid',
        'The selected record is not a current dependant of the source edition.'
      );
    }
    const saved = await this.repository.save(
      loaded,
      { fields: { 'edition-id': targetEditionId } },
      this.now()
    );
    this.catalog.accept(saved, 'modified');
  }

  /** Compares canonical fields and all currently implemented related record evidence. */
  public compare(leftId: string, rightId: string): EditionComparison {
    const left = this.requireEdition(leftId);
    const right = this.requireEdition(rightId);
    if (left.fields['book-id'] !== right.fields['book-id']) {
      throw new EditionProjectServiceError(
        'edition-target-invalid',
        'Edition comparison is scoped to revisions and editions of the same book.'
      );
    }
    const rows: EditionComparisonRow[] = [
      row('identity', 'Type', editionLabel(left), editionLabel(right)),
      row('identity', 'Revision', value(left.fields.revision), value(right.fields.revision)),
      row('identity', 'Status', value(left.fields.status), value(right.fields.status)),
      row(
        'dates',
        'Publication date',
        value(left.fields['publication-date']),
        value(right.fields['publication-date'])
      ),
      row('production', 'Media category', value(left.fields.medium), value(right.fields.medium)),
      row('production', 'Trim', trimSummary(left), trimSummary(right)),
      row(
        'production',
        'Page count',
        value(left.fields['page-count']),
        value(right.fields['page-count'])
      ),
      row('production', 'Narrator', value(left.fields.narrator), value(right.fields.narrator)),
      row('production', 'Duration', durationSummary(left), durationSummary(right)),
      row('assets', 'Cover', value(left.fields.cover), value(right.fields.cover)),
      row(
        'assets',
        'Formats and files',
        formatSummary(this.catalog.formatsForEdition(left.id)),
        formatSummary(this.catalog.formatsForEdition(right.id))
      ),
      row(
        'metadata',
        'Metadata sets',
        relatedSummary(this.related('metadata-set', left.id)),
        relatedSummary(this.related('metadata-set', right.id))
      ),
      row(
        'prices',
        'Price-bearing targets',
        priceSummary(this.related('platform-target', left.id)),
        priceSummary(this.related('platform-target', right.id))
      ),
      row(
        'platforms',
        'Platform targets',
        relatedSummary(this.related('platform-target', left.id)),
        relatedSummary(this.related('platform-target', right.id))
      )
    ];
    return { left, right, rows };
  }

  /** Creates an edition at an explicit revision used by initial and preview-authorized flows. */
  private async createWithRevision(
    input: CreateEditionInput,
    revision: number,
    sourceEditionId?: string
  ): Promise<EditionProjectResult> {
    const book = this.catalog.snapshot().books.find(({ id }) => id === input.bookId);
    if (book === undefined) {
      throw new EditionProjectServiceError(
        'edition-book-not-found',
        'The selected book does not resolve to one valid catalog record.'
      );
    }
    const fields = editionStorageFields(input, revision, sourceEditionId);
    assertValidEdition(fields);
    const duplicate = this.catalog
      .editionsForBook(input.bookId)
      .some(
        (candidate) =>
          candidate.fields.type === input.type &&
          candidate.fields['custom-type'] === input.customType &&
          candidate.fields.revision === revision
      );
    if (duplicate) {
      throw new EditionProjectServiceError(
        'edition-conflict',
        `${editionTypeLabel({ type: input.type, ...(input.customType === undefined ? {} : { customType: input.customType }) })} revision ${revision} already exists for this book.`
      );
    }
    const now = this.now();
    const bookTitle = typeof book.fields.title === 'string' ? book.fields.title : 'Untitled book';
    const editionLabelText = editionTypeLabel({
      type: input.type,
      ...(input.customType === undefined ? {} : { customType: input.customType })
    });
    const path = this.layout.collisionSafePath(
      'edition',
      `${bookTitle} ${editionLabelText} revision ${revision}`,
      this.catalog.knownPaths()
    );
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: createManagedId('edition', this.ids.generate()),
        pmType: 'edition',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Edition notes\n'
    });
    this.catalog.accept(loaded, 'created');
    return { path, edition: hydrateEditionProject(loaded) };
  }

  /** Applies archive envelope state and leaves every relationship untouched. */
  private async setArchiveState(path: VaultPath, archived: boolean): Promise<EditionProjectResult> {
    const loaded = await this.repository.load(path);
    assertRecordType(loaded, 'edition');
    const now = this.now();
    const saved = await this.repository.setArchivedAt(loaded, archived ? now : undefined, now);
    this.catalog.accept(saved, archived ? 'archived' : 'restored');
    return { path, edition: hydrateEditionProject(saved) };
  }

  /** Resolves exactly one valid edition and rejects duplicate or malformed identities. */
  private requireEdition(id: string): CatalogRecord {
    const record = this.catalog.snapshot().editions.find((candidate) => candidate.id === id);
    if (record === undefined) {
      throw new EditionProjectServiceError(
        'edition-not-found',
        `Edition ${id} does not resolve to one valid record.`
      );
    }
    return record;
  }

  /** Finds implemented relationship records used by comparison without hydrating note bodies. */
  private related(type: ManagedRecordType, editionId: string): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType(type)
      .filter((record) => record.fields['edition-id'] === editionId);
  }

  /** Central timestamp helper keeps tests deterministic and persisted instants canonical. */
  private now(): string {
    return this.clock.now().toISOString();
  }
}

/** Converts create input into the human-readable schema-one storage vocabulary. */
function editionStorageFields(
  input: CreateEditionInput,
  revision: number,
  sourceEditionId?: string
): Readonly<Record<string, unknown>> {
  return {
    'book-id': input.bookId,
    type: input.type,
    ...(input.customType === undefined ? {} : { 'custom-type': input.customType }),
    medium: input.medium ?? defaultMediumFor(input.type),
    revision,
    status: input.status,
    ...(input.publicationDate === undefined ? {} : { 'publication-date': input.publicationDate }),
    ...(input.cover === undefined ? {} : { cover: input.cover }),
    'retail-links': input.retailLinks ?? {},
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(sourceEditionId === undefined ? {} : { 'source-edition-id': sourceEditionId }),
    ...(input.trimWidth === undefined ? {} : { 'trim-width': input.trimWidth }),
    ...(input.trimHeight === undefined ? {} : { 'trim-height': input.trimHeight }),
    ...(input.trimUnit === undefined ? {} : { 'trim-unit': input.trimUnit }),
    ...(input.pageCount === undefined ? {} : { 'page-count': input.pageCount }),
    ...(input.narrator === undefined ? {} : { narrator: input.narrator }),
    ...(input.durationMinutes === undefined ? {} : { 'duration-minutes': input.durationMinutes }),
    ...(input.audioMetadata === undefined || Object.keys(input.audioMetadata).length === 0
      ? {}
      : { 'audio-metadata': input.audioMetadata })
  };
}

/** Converts a complete edit form to an explicit patch where undefined removes only named fields. */
function editableStorageFields(input: EditEditionInput): Readonly<Record<string, unknown>> {
  return {
    'custom-type': input.customType,
    status: input.status,
    'publication-date': input.publicationDate,
    cover: input.cover,
    'retail-links': input.retailLinks,
    notes: input.notes,
    'trim-width': input.trimWidth,
    'trim-height': input.trimHeight,
    'trim-unit': input.trimUnit,
    'page-count': input.pageCount,
    narrator: input.narrator,
    'duration-minutes': input.durationMinutes,
    'audio-metadata':
      Object.keys(input.audioMetadata).length === 0 ? undefined : input.audioMetadata
  };
}

/** Converts a format form into canonical storage names without copying referenced content. */
function formatStorageFields(input: CreateEditionFormatInput): Readonly<Record<string, unknown>> {
  return {
    'edition-id': input.editionId,
    category: input.category,
    kind: input.kind,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.filePath === undefined ? {} : { 'file-path': input.filePath }),
    accessibility: input.accessibility ?? {},
    metadata: input.metadata ?? {}
  };
}

/** Applies deletion semantics to a proposed field bag before complete domain validation. */
function applyFieldPatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Converts the reviewed storage proposal back to the create boundary without lossy coercion. */
function storageFieldsToCreateInput(fields: Readonly<Record<string, unknown>>): CreateEditionInput {
  return {
    bookId: fields['book-id'] as string,
    type: fields.type as EditionType,
    medium: fields.medium as EditionMedium,
    status: fields.status as EditionStatus,
    ...(typeof fields['custom-type'] === 'string' ? { customType: fields['custom-type'] } : {}),
    ...(typeof fields['publication-date'] === 'string'
      ? { publicationDate: fields['publication-date'] }
      : {}),
    ...(typeof fields.cover === 'string' ? { cover: fields.cover } : {}),
    retailLinks: (fields['retail-links'] ?? {}) as Readonly<Record<string, string>>,
    ...(typeof fields.notes === 'string' ? { notes: fields.notes } : {}),
    ...(typeof fields['trim-width'] === 'string' ? { trimWidth: fields['trim-width'] } : {}),
    ...(typeof fields['trim-height'] === 'string' ? { trimHeight: fields['trim-height'] } : {}),
    ...(fields['trim-unit'] === 'in' || fields['trim-unit'] === 'mm'
      ? { trimUnit: fields['trim-unit'] }
      : {}),
    ...(typeof fields['page-count'] === 'number' ? { pageCount: fields['page-count'] } : {}),
    ...(typeof fields.narrator === 'string' ? { narrator: fields.narrator } : {}),
    ...(typeof fields['duration-minutes'] === 'number'
      ? { durationMinutes: fields['duration-minutes'] }
      : {}),
    audioMetadata: (fields['audio-metadata'] ?? {}) as Readonly<Record<string, string>>
  };
}

/** Rejects invalid complete edition state before any repository mutation. */
function assertValidEdition(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateEditionProject(fields);
  if (diagnostics.length > 0) {
    throw new EditionProjectServiceError(
      'edition-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
  }
}

/** Rejects invalid format state before the path or identity becomes authoritative. */
function assertValidFormat(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateEditionFormat(fields);
  if (diagnostics.length > 0) {
    throw new EditionProjectServiceError(
      'format-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
  }
}

/** Narrows a loaded repository record before edition-specific hydration or mutation. */
function assertRecordType(record: LoadedManagedRecord, expected: 'edition' | 'format'): void {
  if (record.envelope.pmType !== expected) {
    throw new EditionProjectServiceError(
      'record-type-invalid',
      `Expected a${expected === 'edition' ? 'n' : ''} ${expected} record but found ${record.envelope.pmType}.`
    );
  }
}

/** Copies only present named fields and records the exact human-review evidence. */
function copyFields(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  fields: readonly string[],
  copied: string[]
): void {
  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
      copied.push(field);
    }
  }
}

/** Produces the label input expected by the pure domain helper. */
function catalogEditionLabel(record: CatalogRecord): { type: EditionType; customType?: string } {
  const type = record.fields.type as EditionType;
  const customType = record.fields['custom-type'];
  return {
    type,
    ...(typeof customType === 'string' ? { customType } : {})
  };
}

/** Produces one consistent comparison row with explicit equality. */
function row(
  group: EditionComparisonRow['group'],
  label: string,
  left: string,
  right: string
): EditionComparisonRow {
  return { group, label, left, right, equal: left === right };
}

/** Human-readable edition type label for catalog projections. */
function editionLabel(record: CatalogRecord): string {
  return editionTypeLabel(catalogEditionLabel(record));
}

/** Renders absent scalar evidence explicitly rather than as an empty table cell. */
function value(input: unknown): string {
  if (input === undefined || input === null || input === '') return 'Not recorded';
  if (typeof input === 'object') return stableObjectSummary(input);
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return input.toString();
  }
  return 'Unsupported value';
}

/** Combines conditional trim evidence without applying implicit unit conversion. */
function trimSummary(record: CatalogRecord): string {
  const width = record.fields['trim-width'];
  const height = record.fields['trim-height'];
  const unit = record.fields['trim-unit'];
  return typeof width !== 'string' || typeof height !== 'string' || typeof unit !== 'string'
    ? 'Not recorded'
    : `${width} × ${height} ${unit}`;
}

/** Displays duration using the persisted whole-minute value. */
function durationSummary(record: CatalogRecord): string {
  const duration = record.fields['duration-minutes'];
  return typeof duration === 'number' ? `${duration} minutes` : 'Not recorded';
}

/** Lists semantic formats and file evidence in stable order. */
function formatSummary(records: readonly CatalogRecord[]): string {
  if (records.length === 0) return 'No format records';
  return records
    .map(
      (record) =>
        `${String(record.fields.kind)}${typeof record.fields['file-path'] === 'string' ? ` — ${record.fields['file-path']}` : ''}`
    )
    .join('; ');
}

/** Lists stable related-record identities without pretending unavailable fields exist. */
function relatedSummary(records: readonly CatalogRecord[]): string {
  return records.length === 0
    ? 'No records'
    : records.map((record) => `${record.type}:${record.id}`).join('; ');
}

/** Extracts price/currency evidence from platform targets introduced fully in M4. */
function priceSummary(records: readonly CatalogRecord[]): string {
  const values = records
    .filter((record) => record.fields.price !== undefined || record.fields.currency !== undefined)
    .map((record) => `${value(record.fields.price)} ${value(record.fields.currency)}`);
  return values.length === 0 ? 'No price-bearing targets' : values.join('; ');
}

/** Stable object rendering keeps comparison deterministic and readable. */
function stableObjectSummary(input: object): string {
  if (Array.isArray(input)) return input.map((entry) => value(entry)).join(', ');
  return Object.entries(input)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${key}: ${value(entry)}`)
    .join('; ');
}

/** Prefixes opaque generator output without deriving identity from title, type, or path. */
function createManagedId(type: 'edition' | 'format', generated: string): string {
  const opaque = generated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (opaque.length < 8) {
    throw new EditionProjectServiceError(
      'edition-invalid',
      'Identity generator returned an invalid value.'
    );
  }
  return `pm-${type}-${opaque}`;
}
