import { describe, expect, it } from 'vitest';
import { isCatalogCandidatePath } from '../../src/domain/storage/catalog-path';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';

describe('isCatalogCandidatePath', () => {
  const root = normalizeVaultPath('Publishing Manager');

  it('keeps ordinary canonical-record folders eligible for catalog validation', () => {
    expect(isCatalogCandidatePath(root, 'Publishing Manager/Books/example.md')).toBe(true);
    expect(isCatalogCandidatePath(root, 'Publishing Manager/Templates/book.md')).toBe(true);
  });

  it('excludes human-facing exports and internal journals from record validation', () => {
    expect(
      isCatalogCandidatePath(root, 'Publishing Manager/Exports/Diagnostics/diagnostics.md')
    ).toBe(false);
    expect(isCatalogCandidatePath(root, 'Publishing Manager/System/Journals/move.md')).toBe(false);
  });

  it('does not capture similarly prefixed or unrelated vault paths', () => {
    expect(isCatalogCandidatePath(root, 'Publishing Manager Archive/Books/example.md')).toBe(false);
    expect(isCatalogCandidatePath(root, 'Projects/example.md')).toBe(false);
  });
});
