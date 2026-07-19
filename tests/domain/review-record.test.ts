/** Proves rating, URL, quote-size, permission, date, and follow-up validation. */
import { describe, expect, it } from 'vitest';
import { normalizeReview } from '../../src/domain/reviews/review-record';

const base = {
  bookId: 'pm-book-review-0001',
  source: 'Fictional Review Journal',
  date: '2026-07-19',
  permissionStatus: 'obtained' as const,
  followUpStatus: 'none' as const
};
describe('review record', () => {
  it('normalizes bounded permission-aware evidence', () => {
    expect(
      normalizeReview({
        ...base,
        sourceLink: 'https://example.invalid/review',
        rating: '4.500',
        quote: 'A short fictional quotation.'
      })
    ).toMatchObject({ rating: '4.5', permissionStatus: 'obtained' });
  });
  it('rejects unsafe links, excessive quotes, and unowned quoted text', () => {
    expect(() => normalizeReview({ ...base, sourceLink: 'javascript:alert(1)' })).toThrow(
      'HTTP or HTTPS'
    );
    expect(() =>
      normalizeReview({ ...base, sourceLink: 'https://user:secret@example.invalid/' })
    ).toThrow('without credentials');
    expect(() => normalizeReview({ ...base, quote: 'x'.repeat(501) })).toThrow('500 characters');
    expect(() => normalizeReview({ ...base, permissionStatus: 'unknown', quote: 'Text' })).toThrow(
      'permission'
    );
  });
  it('requires valid rating/date and a date for open follow-up', () => {
    expect(() => normalizeReview({ ...base, rating: '5.1' })).toThrow('0 to 5');
    expect(() => normalizeReview({ ...base, date: '2026-02-30' })).toThrow('real YYYY-MM-DD');
    expect(() => normalizeReview({ ...base, followUpStatus: 'open' })).toThrow('requires a date');
  });
});
