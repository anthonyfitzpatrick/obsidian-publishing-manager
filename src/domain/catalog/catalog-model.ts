/**
 * Declares the read-only catalog projection used by application services and future views. The
 * projection is deliberately disposable: canonical Markdown remains authoritative, while stable
 * diagnostics and activity summaries explain what the catalog accepted, rejected, or changed.
 */

import type { ManagedRecordType } from '../records/record-types';
import type { VaultPath } from '../storage/vault-path';

/** Lightweight record projection retained without hydrating unrelated note bodies. */
export interface CatalogRecord {
  readonly path: VaultPath;
  readonly id: string;
  readonly type: ManagedRecordType;
  readonly schemaVersion: number;
  readonly archived: boolean;
  readonly sourceRevision: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Repair-oriented diagnostic suitable for the future Diagnostics and Overview views. */
export interface CatalogDiagnostic {
  readonly code:
    | 'catalog.duplicate-id'
    | 'catalog.invalid-book'
    | 'catalog.invalid-edition'
    | 'catalog.invalid-format'
    | 'catalog.invalid-task'
    | 'catalog.invalid-workflow'
    | 'catalog.malformed-envelope'
    | 'catalog.malformed-frontmatter'
    | 'catalog.malformed-schema'
    | 'catalog.series-position-conflict'
    | 'catalog.unresolved-link'
    | 'catalog.unsupported-future-schema';
  readonly severity: 'error' | 'warning';
  readonly path: VaultPath;
  readonly entityId?: string;
  readonly field?: string;
  readonly message: string;
  readonly suggestedAction: string;
}

/** Incremental activity action retained for the current local session. */
export type CatalogActivityAction =
  'archived' | 'created' | 'deleted' | 'modified' | 'renamed' | 'restored';

/** Human-readable activity without copying note content into logs or caches. */
export interface CatalogActivity {
  readonly action: CatalogActivityAction;
  readonly occurredAt: string;
  readonly path: VaultPath;
  readonly entityId?: string;
  readonly title?: string;
  readonly previousPath?: VaultPath;
}

/** Deterministic next publishing step derived from valid active catalog state. */
export interface NextMilestoneSummary {
  readonly code:
    | 'add-first-edition'
    | 'add-first-format'
    | 'create-first-book'
    | 'manage-editions'
    | 'repair-catalog';
  readonly title: string;
  readonly explanation: string;
}

/** Explicit catalog lifecycle prevents empty, loading, and failure states from being conflated. */
export type CatalogAvailability =
  | { readonly state: 'loading' }
  | { readonly state: 'rebuilding'; readonly message: string }
  | { readonly state: 'ready' }
  | { readonly state: 'unavailable'; readonly message: string }
  | { readonly state: 'error'; readonly message: string };

/** Immutable state delivered to subscribers after one reconciled catalog change. */
export interface BookCatalogSnapshot {
  readonly availability: CatalogAvailability;
  readonly books: readonly CatalogRecord[];
  readonly editions: readonly CatalogRecord[];
  readonly formats: readonly CatalogRecord[];
  readonly assets: readonly CatalogRecord[];
  readonly workflows: readonly CatalogRecord[];
  readonly tasks: readonly CatalogRecord[];
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly recentActivity: readonly CatalogActivity[];
  readonly nextMilestone: NextMilestoneSummary;
}
