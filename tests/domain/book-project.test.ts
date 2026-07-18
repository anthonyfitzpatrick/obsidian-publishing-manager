/**
 * Proves M1 book validation rejects ambiguous drafts without modifying them and hydrates complete
 * storage snapshots into stable domain identity. These tests intentionally avoid UI and Obsidian
 * classes so the business rules remain deterministic on desktop, mobile, and CI.
 */

import { describe, expect, it } from 'vitest';

import { hydrateBookProject, validateBookProject } from '../../src/domain/books/book-project';

describe('book project domain', () => {
  it('reports every invalid identity and series field in one pass', () => {
    const diagnostics = validateBookProject({
      title: '  ',
      'primary-language': 'not a language!',
      status: 'mystery',
      summary: 'x'.repeat(4001),
      'series-position': 0
    });

    expect(diagnostics.map(({ code }) => code)).toEqual([
      'book.title-required',
      'book.invalid-language',
      'book.invalid-status',
      'book.summary-too-long',
      'book.invalid-series-position',
      'book.missing-series-for-position'
    ]);
  });

  it('hydrates stable identity and optional series membership from a valid snapshot', () => {
    const book = hydrateBookProject({
      envelope: {
        pmId: 'pm-book-00000001',
        pmType: 'book',
        pmSchema: 1,
        createdAt: '2026-07-18T10:00:00.000Z',
        updatedAt: '2026-07-18T11:00:00.000Z'
      },
      fields: {
        title: 'The Fictional Meridian',
        'primary-language': 'en-GB',
        status: 'active',
        summary: 'A fictional test book.',
        'series-id': 'pm-series-00000001',
        'series-position': 2
      }
    });

    expect(book).toMatchObject({
      id: 'pm-book-00000001',
      title: 'The Fictional Meridian',
      primaryLanguage: 'en-GB',
      seriesId: 'pm-series-00000001',
      seriesPosition: 2
    });
  });
});
