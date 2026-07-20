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

/** Editable overview draft plus validation and dirty state for one stable book. */
export interface BookOverviewDraft {
  readonly path: VaultPath;
  readonly bookId: string;
  readonly title: string;
  readonly primaryLanguage: string;
  readonly status: BookStatus;
  readonly summary: string;
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
  status: BookStatus;
  summary: string;
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
      status: draft.status,
      summary: draft.summary.length === 0 ? undefined : draft.summary
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
  return {
    title: record.fields.title as string,
    primaryLanguage: record.fields['primary-language'] as string,
    status: record.fields.status as BookStatus,
    summary: typeof record.fields.summary === 'string' ? record.fields.summary : ''
  };
}

/** Produces immutable public state and derives dirty/validation rather than storing them twice. */
function toPublicDraft(stored: StoredDraft): BookOverviewDraft {
  const fields = {
    title: stored.values.title,
    'primary-language': stored.values.primaryLanguage,
    status: stored.values.status,
    ...(stored.values.summary.length === 0 ? {} : { summary: stored.values.summary })
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

/** Compares the small fixed overview value set without introducing a second mutable dirty flag. */
function isDirty(stored: StoredDraft): boolean {
  return JSON.stringify(stored.values) !== JSON.stringify(stored.baseline);
}
