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
  type PublisherImprintTerritory,
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
  readonly regionalLanguage?: string;
  readonly publisher?: string;
  readonly publisherCountry?: string;
  readonly publisherVariant?: string;
  readonly imprint?: string;
  readonly publisherImprintsByCountry?: readonly PublisherImprintTerritory[];
  readonly status: BookStatus;
  readonly summary?: string;
  readonly cover?: string;
}

/** Explicit partial edit; omitted values remain unchanged and summary `undefined` deletes it. */
export interface EditBookProjectInput {
  readonly title?: string;
  readonly primaryLanguage?: string;
  readonly regionalLanguage?: string | undefined;
  readonly publisher?: string | undefined;
  readonly publisherCountry?: string | undefined;
  readonly publisherVariant?: string | undefined;
  readonly imprint?: string | undefined;
  readonly publisherImprintsByCountry?: readonly PublisherImprintTerritory[] | undefined;
  readonly status?: BookStatus;
  readonly summary?: string | undefined;
  readonly cover?: string | undefined;
}

/** Series has no duplicate Project metadata; it only owns optional local cover art. */
export interface EditSeriesInput {
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
    if ('regionalLanguage' in patch) nextFields['regional-language'] = patch.regionalLanguage;
    if ('publisher' in patch) nextFields.publisher = patch.publisher;
    if ('publisherCountry' in patch) nextFields['publisher-country'] = patch.publisherCountry;
    if ('publisherVariant' in patch) nextFields['publisher-variant'] = patch.publisherVariant;
    if ('imprint' in patch) nextFields.imprint = patch.imprint;
    if ('publisherImprintsByCountry' in patch) {
      nextFields['publisher-imprints-by-country'] = publisherTerritoriesForStorage(
        patch.publisherImprintsByCountry
      );
    }
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
          ...('regionalLanguage' in patch ? { 'regional-language': patch.regionalLanguage } : {}),
          ...('publisher' in patch ? { publisher: patch.publisher } : {}),
          ...('publisherCountry' in patch ? { 'publisher-country': patch.publisherCountry } : {}),
          ...('publisherVariant' in patch ? { 'publisher-variant': patch.publisherVariant } : {}),
          ...('imprint' in patch ? { imprint: patch.imprint } : {}),
          ...('publisherImprintsByCountry' in patch
            ? {
                'publisher-imprints-by-country': publisherTerritoriesForStorage(
                  patch.publisherImprintsByCountry
                )
              }
            : {}),
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

  /**
   * Reorders all current Series members by their explicit user-visible Part numbers. Validation
   * occurs before any relationship write, so duplicate, missing, or invalid numbers cannot leave
   * a partially reordered Series behind.
   */
  public async setSeriesPartNumbers(
    seriesId: string,
    entries: readonly { readonly path: VaultPath; readonly partNumber: number }[]
  ): Promise<void> {
    const members = this.catalog.orderedBooks(seriesId);
    const requestedPaths = new Set(entries.map(({ path }) => path));
    const positions = new Set(entries.map(({ partNumber }) => partNumber));
    if (
      members.length !== entries.length ||
      requestedPaths.size !== entries.length ||
      positions.size !== entries.length ||
      entries.some(({ path, partNumber }) =>
        !members.some((member) => member.path === path) ||
        !Number.isSafeInteger(partNumber) ||
        partNumber < 1
      )
    ) {
      throw new BookProjectServiceError(
        'series-invalid',
        'Every Project in this Series needs one unique whole-number Part number of 1 or greater.'
      );
    }
    // A direct swap (Part 1 ↔ Part 2) would otherwise hit the uniqueness guard midway through.
    // Temporarily making all members standalone is safe and preserves their canonical Projects.
    for (const member of members) await this.removeSeries(member.path);
    for (const entry of [...entries].sort((left, right) => left.partNumber - right.partNumber)) {
      await this.assignSeries(entry.path, seriesId, entry.partNumber);
    }
  }

  /** Removes only Series membership; the Project remains a normal standalone Project. */
  public async removeSeries(path: VaultPath): Promise<BookProjectResult> {
    const loaded = await this.repository.load(path);
    assertBookType(loaded.envelope.pmType);
    const nextFields = { ...loaded.fields };
    delete nextFields['series-id'];
    delete nextFields['series-position'];
    assertValidBook(nextFields);
    const saved = await this.repository.save(
      loaded,
      { fields: { 'series-id': undefined, 'series-position': undefined } },
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'modified');
    return { path, book: hydrateBookProject(saved) };
  }

  /** Stores or clears a Series cover without changing its Projects or their order. */
  public async editSeries(path: VaultPath, patch: EditSeriesInput): Promise<void> {
    const loaded = await this.repository.load(path);
    assertSeriesType(loaded.envelope.pmType);
    const saved = await this.repository.save(
      loaded,
      { fields: 'cover' in patch ? { cover: patch.cover } : {} },
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'modified');
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
    ...(input.regionalLanguage === undefined ? {} : { 'regional-language': input.regionalLanguage }),
    ...(input.publisher === undefined ? {} : { publisher: input.publisher }),
    ...(input.publisherCountry === undefined ? {} : { 'publisher-country': input.publisherCountry }),
    ...(input.publisherVariant === undefined ? {} : { 'publisher-variant': input.publisherVariant }),
    ...(input.imprint === undefined ? {} : { imprint: input.imprint }),
    ...(input.publisherImprintsByCountry === undefined
      ? {}
      : { 'publisher-imprints-by-country': publisherTerritoriesForStorage(input.publisherImprintsByCountry) }),
    status: input.status,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.cover === undefined ? {} : { cover: input.cover })
  };
}

/** Serializes the editable list to a country-keyed map so one Project cannot hold duplicate countries. */
function publisherTerritoriesForStorage(
  territories: readonly PublisherImprintTerritory[] | undefined
): Readonly<Record<string, { readonly publisher: string; readonly imprint?: string }> | undefined> {
  if (territories === undefined) return undefined;
  return Object.fromEntries(
    territories.map((territory) => [
      territory.country,
      {
        publisher: territory.publisher,
        ...(territory.imprint === undefined ? {} : { imprint: territory.imprint })
      }
    ])
  );
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

/** Prevents a Series presentation edit from mutating another managed record family. */
function assertSeriesType(type: string): void {
  if (type !== 'series') {
    throw new BookProjectServiceError('series-not-found', `Expected a series record but found ${type}.`);
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
