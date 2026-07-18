/**
 * Proves every UI-006 dashboard state is explicit and content-aware without requiring DOM tests.
 * The pure presenter must never confuse a genuinely empty ready catalog with loading, rebuilding,
 * partial, unavailable, or unexpected error conditions.
 */

import { describe, expect, it } from 'vitest';

import type {
  BookCatalogSnapshot,
  CatalogAvailability
} from '../../src/domain/catalog/catalog-model';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { buildDashboardViewModel } from '../../src/ui/view-models/dashboard-view-model';

function snapshot(
  availability: CatalogAvailability,
  books = 0,
  diagnostics = 0
): BookCatalogSnapshot {
  return {
    availability,
    books: Array.from({ length: books }, (_, index) => ({
      path: normalizeVaultPath(`Publishing Manager/Books/book-${index}.md`),
      id: `pm-book-viewmodel-${String(index).padStart(4, '0')}`,
      type: 'book' as const,
      schemaVersion: 1,
      archived: false,
      sourceRevision: `source-${index}`,
      fields: { title: `Book ${index}`, status: 'active', 'primary-language': 'en' }
    })),
    editions: [],
    formats: [],
    assets: [],
    diagnostics: Array.from({ length: diagnostics }, (_, index) => ({
      code: 'catalog.malformed-schema' as const,
      severity: 'error' as const,
      path: normalizeVaultPath(`Publishing Manager/Books/problem-${index}.md`),
      message: 'A fictional required field is missing.',
      suggestedAction: 'Repair the named fictional field and save the note.'
    })),
    recentActivity: [],
    nextMilestone: {
      code: 'create-first-book',
      title: 'Create the first active book',
      explanation: 'A book anchors publishing work.'
    }
  };
}

describe('dashboard view model', () => {
  it.each([
    [{ state: 'loading' } as const, 0, 0, 'loading'],
    [{ state: 'rebuilding', message: 'Rebuilding.' } as const, 1, 0, 'rebuilding'],
    [{ state: 'unavailable', message: 'Unavailable.' } as const, 0, 0, 'unavailable'],
    [{ state: 'error', message: 'Unexpected error.' } as const, 0, 0, 'error'],
    [{ state: 'ready' } as const, 0, 0, 'empty'],
    [{ state: 'ready' } as const, 1, 1, 'partial'],
    [{ state: 'ready' } as const, 1, 0, 'ready']
  ])('maps %o with %i books and %i diagnostics to %s', (availability, books, issues, expected) => {
    expect(buildDashboardViewModel(snapshot(availability, books, issues)).kind).toBe(expected);
  });
});
