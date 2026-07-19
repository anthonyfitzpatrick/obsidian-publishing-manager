/** Proves exact decimal, tax/date errors, and explainable PRC-003/PRC-004 heuristics. */
import { describe, expect, it } from 'vitest';

import {
  compareDecimal,
  normalizeDecimal,
  PRICE_HEURISTIC_DISCLOSURE,
  validatePriceRecord
} from '../../src/domain/pricing/price-record';

const valid = {
  'edition-id': 'pm-edition-price-0001',
  platform: 'Direct',
  territory: 'GB',
  currency: 'GBP',
  amount: '9.99',
  'tax-included': true,
  'tax-rate': '0',
  'effective-from': '2026-07-19',
  source: 'Publisher decision'
};

describe('price record', () => {
  it('normalizes and compares decimal text without binary floating point', () => {
    expect(normalizeDecimal('10.5000')).toBe('10.5');
    expect(compareDecimal('10.10', '10.1')).toBe(0);
    expect(compareDecimal('999999999999.99', '999999999999.98')).toBe(1);
  });

  it('reports structural defects and separate planning warnings', () => {
    const diagnostics = validatePriceRecord({
      ...valid,
      territory: 'United Kingdom',
      currency: 'pounds',
      amount: '0.1234',
      'tax-included': true,
      'tax-rate': '120',
      'effective-to': '2026-01-01'
    });
    expect(
      diagnostics.filter(({ severity }) => severity === 'error').map(({ field }) => field)
    ).toEqual(expect.arrayContaining(['territory', 'currency', 'tax-rate', 'effective-to']));
    expect(
      diagnostics.filter(({ severity }) => severity === 'warning').map(({ field }) => field)
    ).toContain('amount');
    expect(PRICE_HEURISTIC_DISCLOSURE).toContain('do not certify retailer acceptance');
  });

  it('supports configurable local endings and extreme same-currency warnings', () => {
    const diagnostics = validatePriceRecord(
      { ...valid, amount: '10.50' },
      {
        oddEndings: [{ currency: 'GBP', endings: ['.99'] }],
        comparisonAmounts: [{ currency: 'GBP', amount: '1.00' }]
      }
    );
    expect(diagnostics.filter(({ severity }) => severity === 'warning')).toHaveLength(2);
  });
});
