/**
 * Preserves per-book overview drafts independently of view DOM lifecycles. Navigating between
 * dashboard, workspace tabs, books, or panes therefore cannot discard typed values. Discard is an
 * explicit operation for a confirmation dialog, while save replaces the baseline only after the
 * application service returns authoritative persisted state.
 */

import { validateBookProject, type BookStatus } from '../../domain/books/book-project';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { VaultPath } from '../../domain/storage/vault-path';
import type { EditBookProjectInput } from '../../application/books/book-project-service';
import type { PublisherImprintTerritory } from '../../domain/books/book-project';
import { splitLanguageSelection } from '../language-options';

/** Editable overview draft plus validation and dirty state for one stable book. */
export interface BookOverviewDraft {
  readonly path: VaultPath;
  readonly bookId: string;
  readonly title: string;
  readonly primaryLanguage: string;
  readonly regionalLanguage: string;
  readonly publisher: string;
  readonly publisherCountry: string;
  readonly publisherVariant: string;
  readonly imprint: string;
  readonly publisherImprintsByCountry: readonly PublisherImprintTerritory[];
  readonly status: BookStatus;
  readonly summary: string;
  readonly cover: string;
  readonly dirty: boolean;
  readonly diagnostics: readonly { readonly field: string; readonly message: string }[];
}

interface StoredDraft {
  baseline: DraftValues;
  values: DraftValues;
  bookId: string;
  path: VaultPath;
}

interface DraftValues {
  title: string;
  primaryLanguage: string;
  regionalLanguage: string;
  publisher: string;
  publisherCountry: string;
  publisherVariant: string;
  imprint: string;
  publisherImprintsByCountry: readonly PublisherImprintTerritory[];
  status: BookStatus;
  summary: string;
  cover: string;
}

/** Runtime draft registry shared by all Book Workspace view instances. */
export class BookDraftStore {
  private readonly drafts = new Map<VaultPath, StoredDraft>();

  /**
   * Seeds a draft and keeps clean fields synchronized with authoritative catalog changes.
   *
   * A dirty draft belongs to the user and must survive tab changes and background reconciliation.
   * A clean draft has no independent user state, so retaining it after an external Markdown edit
   * would display stale values and could overwrite that edit on the next save. Refreshing only the
   * clean case preserves both promises: unsaved typing is protected, while externally edited
   * Markdown remains the source of truth.
   */
  public ensure(record: CatalogRecord): BookOverviewDraft {
    const existing = this.drafts.get(record.path);
    if (existing !== undefined) {
      if (!isDirty(existing)) {
        const values = valuesFromRecord(record);
        existing.bookId = record.id;
        existing.baseline = { ...values };
        existing.values = { ...values };
      }
      return toPublicDraft(existing);
    }
    const values = valuesFromRecord(record);
    const stored: StoredDraft = {
      path: record.path,
      bookId: record.id,
      baseline: { ...values },
      values: { ...values }
    };
    this.drafts.set(record.path, stored);
    return toPublicDraft(stored);
  }

  /** Applies one explicit field patch and immediately recomputes inline validation. */
  public update(path: VaultPath, patch: Partial<DraftValues>): BookOverviewDraft {
    const stored = this.require(path);
    stored.values = { ...stored.values, ...patch };
    return toPublicDraft(stored);
  }

  /** Returns the current draft without creating one from incomplete data. */
  public get(path: VaultPath): BookOverviewDraft | undefined {
    const stored = this.drafts.get(path);
    return stored === undefined ? undefined : toPublicDraft(stored);
  }

  /** Converts a valid draft into the application edit patch; invalid drafts never reach storage. */
  public toEditInput(path: VaultPath): EditBookProjectInput {
    const draft = toPublicDraft(this.require(path));
    if (draft.diagnostics.length > 0) {
      throw new Error(draft.diagnostics.map(({ message }) => message).join(' '));
    }
    return {
      title: draft.title,
      primaryLanguage: draft.primaryLanguage,
      regionalLanguage: draft.regionalLanguage.length === 0 ? undefined : draft.regionalLanguage,
      publisher: draft.publisher.length === 0 ? undefined : draft.publisher,
      publisherCountry: draft.publisherCountry.length === 0 ? undefined : draft.publisherCountry,
      publisherVariant: draft.publisherVariant.length === 0 ? undefined : draft.publisherVariant,
      imprint: draft.imprint.length === 0 ? undefined : draft.imprint,
      publisherImprintsByCountry:
        draft.publisherImprintsByCountry.length === 0 ? undefined : draft.publisherImprintsByCountry,
      status: draft.status,
      summary: draft.summary.length === 0 ? undefined : draft.summary,
      cover: draft.cover.length === 0 ? undefined : draft.cover
    };
  }

  /** Replaces baseline and values only after a confirmed authoritative catalog update. */
  public markSaved(record: CatalogRecord): BookOverviewDraft {
    this.drafts.delete(record.path);
    return this.ensure(record);
  }

  /** Explicitly discards typed values and restores the last saved baseline. */
  public discard(path: VaultPath): BookOverviewDraft {
    const stored = this.require(path);
    stored.values = { ...stored.baseline };
    return toPublicDraft(stored);
  }

  /** Removes state only when the canonical book itself is no longer available. */
  public forget(path: VaultPath): void {
    this.drafts.delete(path);
  }

  /** Prevents silent creation of draft state for missing/invalid books. */
  private require(path: VaultPath): StoredDraft {
    const stored = this.drafts.get(path);
    if (stored === undefined) throw new Error(`No draft is available for ${path}.`);
    return stored;
  }
}

/** Reads only the implemented M1 overview fields from a valid catalog record. */
function valuesFromRecord(record: CatalogRecord): DraftValues {
  const language = splitLanguageSelection(
    record.fields['primary-language'] as string,
    typeof record.fields['regional-language'] === 'string' ? record.fields['regional-language'] : undefined
  );
  return {
    title: record.fields.title as string,
    primaryLanguage: language.primary,
    regionalLanguage: language.regional,
    publisher: typeof record.fields.publisher === 'string' ? record.fields.publisher : '',
    publisherCountry: typeof record.fields['publisher-country'] === 'string' ? record.fields['publisher-country'] : 'GLOBAL',
    publisherVariant: typeof record.fields['publisher-variant'] === 'string' ? record.fields['publisher-variant'] : '',
    imprint: typeof record.fields.imprint === 'string' ? record.fields.imprint : '',
    publisherImprintsByCountry: publisherTerritoriesFrom(record.fields['publisher-imprints-by-country']),
    status: record.fields.status as BookStatus,
    summary: typeof record.fields.summary === 'string' ? record.fields.summary : '',
    cover: typeof record.fields.cover === 'string' ? record.fields.cover : ''
  };
}

/** Produces immutable public state and derives dirty/validation rather than storing them twice. */
function toPublicDraft(stored: StoredDraft): BookOverviewDraft {
  const fields = {
    title: stored.values.title,
    'primary-language': stored.values.primaryLanguage,
    ...(stored.values.regionalLanguage.length === 0
      ? {}
      : { 'regional-language': stored.values.regionalLanguage }),
    ...(stored.values.publisher.length === 0 ? {} : { publisher: stored.values.publisher }),
    ...(stored.values.publisherCountry.length === 0
      ? {}
      : { 'publisher-country': stored.values.publisherCountry }),
    ...(stored.values.publisherVariant.length === 0
      ? {}
      : { 'publisher-variant': stored.values.publisherVariant }),
    ...(stored.values.imprint.length === 0 ? {} : { imprint: stored.values.imprint }),
    ...(stored.values.publisherImprintsByCountry.length === 0
      ? {}
      : { 'publisher-imprints-by-country': publisherTerritoriesForValidation(stored.values.publisherImprintsByCountry) }),
    status: stored.values.status,
    ...(stored.values.summary.length === 0 ? {} : { summary: stored.values.summary }),
    ...(stored.values.cover.length === 0 ? {} : { cover: stored.values.cover })
  };
  return {
    path: stored.path,
    bookId: stored.bookId,
    ...stored.values,
    dirty: isDirty(stored),
    diagnostics: validateBookProject(fields).map(({ field, message }) => ({
      field: String(field),
      message
    }))
  };
}

/** Reads only valid-shaped rows so malformed externally edited records stay visible to diagnostics. */
function publisherTerritoriesFrom(value: unknown): readonly PublisherImprintTerritory[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.entries(value)
    .flatMap(([country, identity]) => {
      if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) return [];
      const fields = identity as Record<string, unknown>;
      if (typeof fields.publisher !== 'string') return [];
      return [{ country, publisher: fields.publisher, ...(typeof fields.imprint === 'string' ? { imprint: fields.imprint } : {}) }];
    })
    .sort((left, right) => left.country.localeCompare(right.country));
}

/** Matches the canonical country-keyed storage contract used by domain validation. */
function publisherTerritoriesForValidation(
  territories: readonly PublisherImprintTerritory[]
): Readonly<Record<string, { readonly publisher: string; readonly imprint?: string }>> {
  return Object.fromEntries(
    territories.map((territory) => [
      territory.country,
      { publisher: territory.publisher, ...(territory.imprint === undefined ? {} : { imprint: territory.imprint }) }
    ])
  );
}

/** Compares the small fixed overview value set without introducing a second mutable dirty flag. */
function isDirty(stored: StoredDraft): boolean {
  return JSON.stringify(stored.values) !== JSON.stringify(stored.baseline);
}
