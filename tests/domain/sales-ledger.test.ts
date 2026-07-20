/** Proves normalized exact-once keys, overlap boundaries, and exact decimal aggregation. */
import { describe, expect, it } from 'vitest';
import {
  canAcceptSalesPreview,
  normalizeSalesInput,
  periodsOverlap,
  salesKeys,
  sumDecimals
} from '../../src/domain/sales/sales-ledger';
describe('sales ledger domain', () => {
  it('keeps exact duplicates blocked and enables explicitly reviewed overlaps', () => {
    const preview = {
      normalized: {} as never,
      entryKey: 'entry',
      coverageKey: 'coverage',
      exactDuplicateIds: [],
      overlappingIds: ['pm-sales-line-overlap-0001'],
      warnings: []
    };
    expect(canAcceptSalesPreview(preview, false)).toBe(false);
    expect(canAcceptSalesPreview(preview, true)).toBe(true);
    expect(
      canAcceptSalesPreview(
        { ...preview, exactDuplicateIds: ['pm-sales-line-duplicate-0001'] },
        true
      )
    ).toBe(false);
  });

  it('normalizes country, currency, money, and produces stable keys', () => {
    const value = normalizeSalesInput({
      sourceId: 'source',
      isbnId: 'isbn',
      editionId: 'edition',
      platformTargetId: 'target',
      country: 'gb',
      kind: 'transaction',
      startDate: '2026-07-19',
      endDate: '2026-07-19',
      units: 2,
      returns: 0,
      currency: 'gbp',
      money: { proceeds: '1.2300' },
      sourceValues: {}
    });
    expect(value).toMatchObject({ country: 'GB', currency: 'GBP', money: { proceeds: '1.23' } });
    expect(salesKeys(value)).toEqual(salesKeys(value));
  });
  it('detects inclusive overlap and sums decimal text without binary rounding', () => {
    expect(periodsOverlap('2026-01-01', '2026-01-31', '2026-01-31', '2026-02-28')).toBe(true);
    expect(sumDecimals(['0.1', '0.2', '1.005', '-0.005'])).toBe('1.3');
  });
});
