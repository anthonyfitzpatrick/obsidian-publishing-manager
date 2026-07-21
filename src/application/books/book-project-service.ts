/**
 * Coordinates the M1 book lifecycle through application ports. This is the only layer that turns
 * create/edit/archive intent into repository writes; it validates complete proposed state first,
 * selects collision-safe paths, preserves stable identity across reloads and renames, and updates
 * the disposable catalog with the exact persisted result.
 */

import {
  hydrateBookProject,
  validateBookProject,
  type BookProject,
  type BookStatus
} from '../../domain/books/book-project';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { VaultPath } from '../../domain/storage/vault-path';
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';

/** User-supplied fields for a new stable book project. */
export interface CreateBookProjectInput {
  readonly title: string;
  readonly primaryLanguage: string;
  readonly status: BookStatus;
  readonly summary?: string;
  readonly cover?: string;
}

/** Explicit partial edit; omitted values remain unchanged and summary `undefined` deletes it. */
export interface EditBookProjectInput {
  readonly title?: string;
  readonly primaryLanguage?: string;
  readonly status?: BookStatus;
  readonly summary?: string | undefined;
  readonly cover?: string | undefined;
}

/** Persisted book result includes the current path required for navigation. */
export interface BookProjectResult {
  readonly path: VaultPath;
  readonly book: BookProject;
}

/** Stable application failure with field diagnostics suitable for inline display. */
export class BookProjectServiceError extends Error {
  /** Preserves an actionable category without leaking note content. */
  public constructor(
    public readonly code:
      | 'book-invalid'
      | 'book-not-book'
      | 'series-invalid'
      | 'series-not-found'
      | 'series-position-occupied',
    message: string
  ) {
    super(message);
    this.name = 'BookProjectServiceError';
  }
}

/** Complete lifecycle service used by commands now and workspace views in the next section. */
export class BookProjectService {
  /** Receives only deterministic domain services and application persistence/catalog ports. */
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Creates one canonical book at a readable collision-safe path. */
  public async create(input: CreateBookProjectInput): Promise<BookProjectResult> {
    const fields = toStorageFields(input);
    assertValidBook(fields);
    const now = this.clock.now().toISOString();
    const path = this.layout.collisionSafePath('book', input.title, this.catalog.knownPaths());
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: createManagedId('book', this.ids.generate()),
        pmType: 'book',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Publishing notes\n'
    });
    this.catalog.accept(loaded, 'created');
    return { path, book: hydrateBookProject(loaded) };
  }

  /** Reopens the authoritative note after plugin/app reload without regenerating identity. */
  public async reopen(path: VaultPath): Promise<BookProjectResult> {
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    return { path, book: hydrateBookProject(loaded) };
  }

  /** Applies an explicit validated edit through optimistic, lossless persistence. */
  public async edit(path: VaultPath, patch: EditBookProjectInput): Promise<BookProjectResult> {
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    const nextFields: Record<string, unknown> = { ...loaded.fields };
    if (patch.title !== undefined) nextFields.title = patch.title;
    if (patch.primaryLanguage !== undefined) nextFields['primary-language'] = patch.primaryLanguage;
    if (patch.status !== undefined) nextFields.status = patch.status;
    if ('summary' in patch) nextFields.summary = patch.summary;
    if ('cover' in patch) nextFields.cover = patch.cover;
    assertValidBook(nextFields);
    const saved = await this.repository.save(
      loaded,
      {
        fields: {
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.primaryLanguage === undefined
            ? {}
            : { 'primary-language': patch.primaryLanguage }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...('summary' in patch ? { summary: patch.summary } : {}),
          ...('cover' in patch ? { cover: patch.cover } : {})
        }
      },
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'modified');
    return { path, book: hydrateBookProject(saved) };
  }

  /** Creates a minimal series record so membership never relies on an unresolved free-text name. */
  public async createSeries(name: string): Promise<string> {
    if (name.trim().length === 0 || name !== name.trim()) {
      throw new BookProjectServiceError(
        'series-invalid',
        'Series name is required and cannot begin or end with whitespace.'
      );
    }
    const now = this.clock.now().toISOString();
    const path = this.layout.collisionSafePath('series', name, this.catalog.knownPaths());
    const loaded = await this.repository.create(path, {
      envelope: {
        pmId: createManagedId('series', this.ids.generate()),
        pmType: 'series',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields: { name, 'ordering-policy': 'explicit' }
    });
    this.catalog.accept(loaded, 'created');
    return loaded.envelope.pmId;
  }

  /** Assigns resolvable series membership with a unique stable positive position. */
  public async assignSeries(
    path: VaultPath,
    seriesId: string,
    position: number
  ): Promise<BookProjectResult> {
    const series = this.catalog.recordById(seriesId);
    if (series?.type !== 'series') {
      throw new BookProjectServiceError(
        'series-not-found',
        `Series ${seriesId} does not resolve to one valid series record.`
      );
    }
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    if (this.catalog.isSeriesPositionOccupied(seriesId, position, loaded.envelope.pmId)) {
      throw new BookProjectServiceError(
        'series-position-occupied',
        `Series position ${position} is already assigned. Choose another positive position.`
      );
    }
    const nextFields = {
      ...loaded.fields,
      'series-id': seriesId,
      'series-position': position
    };
    assertValidBook(nextFields);
    const saved = await this.repository.save(
      loaded,
      { fields: { 'series-id': seriesId, 'series-position': position } },
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'modified');
    return { path, book: hydrateBookProject(saved) };
  }

  /** Archives a book without deleting its note, identity, links, body, or unknown fields. */
  public async archive(path: VaultPath): Promise<BookProjectResult> {
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    const now = this.clock.now().toISOString();
    const saved = await this.repository.setArchivedAt(loaded, now, now);
    this.catalog.accept(saved, 'archived');
    return { path, book: hydrateBookProject(saved) };
  }

  /** Restores an archived book by removing only the optional archive timestamp. */
  public async restore(path: VaultPath): Promise<BookProjectResult> {
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    const saved = await this.repository.setArchivedAt(
      loaded,
      undefined,
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'restored');
    return { path, book: hydrateBookProject(saved) };
  }
}

/** Converts application naming to the documented human-readable storage field names. */
function toStorageFields(input: CreateBookProjectInput): Readonly<Record<string, unknown>> {
  return {
    title: input.title,
    'primary-language': input.primaryLanguage,
    status: input.status,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.cover === undefined ? {} : { cover: input.cover })
  };
}

/** Rejects a complete proposed state before any repository mutation. */
function assertValidBook(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateBookProject(fields);
  if (diagnostics.length > 0) {
    throw new BookProjectServiceError(
      'book-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
  }
}

/** Narrows repository results so commands cannot treat another record family as a book. */
function assertBookType(type: string): void {
  if (type !== 'book') {
    throw new BookProjectServiceError('book-not-book', `Expected a book record but found ${type}.`);
  }
}

/** Prefixes opaque generator output without deriving identity from title or vault path. */
function createManagedId(type: 'book' | 'series', generated: string): string {
  const opaque = generated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (opaque.length < 8) {
    throw new BookProjectServiceError(
      'book-invalid',
      'Identity generator returned an invalid value.'
    );
  }
  return `pm-${type}-${opaque}`;
}
