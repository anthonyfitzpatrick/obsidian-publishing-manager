/**
 * Proves UI-004 draft continuity, validation, save baselines, and confirmed discard behavior as a
 * pure runtime state contract. Drafts stay attached to stable book paths and cannot leak between
 * books when views or tabs navigate.
 */

import { describe, expect, it } from 'vitest';

import type { CatalogRecord } from '../../src/domain/catalog/catalog-model';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { BookDraftStore } from '../../src/ui/state/book-draft-store';

function record(title: string, suffix: string): CatalogRecord {
  return {
    path: normalizeVaultPath(`Publishing Manager/Books/${suffix}.md`),
    id: `pm-book-draft-${suffix.padEnd(8, '0')}`,
    type: 'book',
    schemaVersion: 1,
    archived: false,
    sourceRevision: `source-${suffix}`,
    fields: { title, status: 'active', 'primary-language': 'en', summary: 'Saved summary.' }
  };
}

describe('book draft store', () => {
  it('preserves independent drafts while navigating between books', () => {
    const store = new BookDraftStore();
    const first = record('First Book', 'first');
    const second = record('Second Book', 'second');
    store.ensure(first);
    store.update(first.path, { summary: 'Unsaved first draft.' });
    store.ensure(second);
    store.update(second.path, { title: 'Unsaved Second Title' });

    expect(store.get(first.path)).toMatchObject({ summary: 'Unsaved first draft.', dirty: true });
    expect(store.get(second.path)).toMatchObject({ title: 'Unsaved Second Title', dirty: true });
  });

  it('blocks invalid drafts before application persistence', () => {
    const store = new BookDraftStore();
    const book = record('Valid Book', 'valid');
    store.ensure(book);
    const invalid = store.update(book.path, { title: '  invalid  ' });

    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      'Remove leading or trailing whitespace from the book title.'
    );
    expect(() => store.toEditInput(book.path)).toThrow('Remove leading or trailing whitespace');
  });

  it('discards only after an explicit call and marks authoritative saved state clean', () => {
    const store = new BookDraftStore();
    const book = record('Saved Book', 'saved');
    store.ensure(book);
    store.update(book.path, { summary: 'Temporary draft.' });
    expect(store.discard(book.path)).toMatchObject({ summary: 'Saved summary.', dirty: false });

    const updated: CatalogRecord = {
      ...book,
      sourceRevision: 'source-saved-2',
      fields: { ...book.fields, summary: 'Persisted update.' }
    };
    expect(store.markSaved(updated)).toMatchObject({ summary: 'Persisted update.', dirty: false });
  });
});
