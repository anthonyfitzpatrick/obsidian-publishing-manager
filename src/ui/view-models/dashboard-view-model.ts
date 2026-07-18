/**
 * Converts catalog snapshots into explicit presentation states before DOM rendering. Keeping this
 * decision pure makes loading, rebuilding, unavailable, error, empty, partial, and ready behavior
 * deterministic and testable without an Obsidian window or browser-specific test environment.
 */

import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';

/** Complete state vocabulary required by UI-006. */
export type DashboardStateKind =
  'empty' | 'error' | 'loading' | 'partial' | 'ready' | 'rebuilding' | 'unavailable';

/** Presentation-ready dashboard summary with no mutable catalog collections. */
export interface DashboardViewModel {
  readonly kind: DashboardStateKind;
  readonly heading: string;
  readonly explanation: string;
  readonly books: readonly CatalogRecord[];
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly activeBooks: number;
  readonly archivedBooks: number;
  readonly issueCount: number;
}

/** Maps availability and content to one unambiguous state and summary. */
export function buildDashboardViewModel(snapshot: BookCatalogSnapshot): DashboardViewModel {
  const counts = {
    activeBooks: snapshot.books.filter(({ archived }) => !archived).length,
    archivedBooks: snapshot.books.filter(({ archived }) => archived).length,
    issueCount: snapshot.diagnostics.length
  };
  const common = {
    books: snapshot.books,
    diagnostics: snapshot.diagnostics,
    ...counts
  };

  switch (snapshot.availability.state) {
    case 'loading':
      return {
        kind: 'loading',
        heading: 'Loading publishing catalog',
        explanation: 'Reading local managed records. No network request is made.',
        ...common
      };
    case 'rebuilding':
      return {
        kind: 'rebuilding',
        heading: 'Rebuilding publishing catalog',
        explanation: snapshot.availability.message,
        ...common
      };
    case 'unavailable':
      return {
        kind: 'unavailable',
        heading: 'Publishing catalog unavailable',
        explanation: snapshot.availability.message,
        ...common
      };
    case 'error':
      return {
        kind: 'error',
        heading: 'Publishing catalog error',
        explanation: snapshot.availability.message,
        ...common
      };
    case 'ready':
      if (snapshot.books.length === 0 && snapshot.diagnostics.length === 0) {
        return {
          kind: 'empty',
          heading: 'Create your first book project',
          explanation: 'Start with a title, primary language, and publishing status.',
          ...common
        };
      }
      if (snapshot.diagnostics.length > 0) {
        return {
          kind: 'partial',
          heading: 'Catalog loaded with issues',
          explanation: 'Valid books remain available while damaged records show repair guidance.',
          ...common
        };
      }
      return {
        kind: 'ready',
        heading: 'Publishing catalog ready',
        explanation: 'All managed book records passed current validation.',
        ...common
      };
  }
}
