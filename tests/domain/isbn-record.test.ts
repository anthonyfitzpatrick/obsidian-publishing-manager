/**
 * Proves ISBN-002 and the record-level parts of ISBN-001/ISBN-005 without storage or UI concerns.
 * Canonical comparison always uses ISBN-13, while a valid ISBN-10 remains available as provenance.
 */
import { describe, expect, it } from 'vitest';

import { isbn10To13, normalizeIsbn, validateIsbnRecord } from '../../src/domain/isbn/isbn-record';

describe('ISBN record contract', () => {
  it('normalizes valid ISBN-10 and hyphenated ISBN-13 values to one ISBN-13 identity', () => {
    expect(normalizeIsbn('0-306-40615-2')).toEqual({
      isbn10: '0306406152',
      isbn13: '9780306406157'
    });
    expect(normalizeIsbn('978-0-306-40615-7')).toEqual({ isbn13: '9780306406157' });
    expect(isbn10To13('0306406152')).toBe('9780306406157');
  });

  it('rejects invalid check digits and inconsistent lifecycle assignments', () => {
    expect(() => normalizeIsbn('9780306406158')).toThrow('invalid check digit');
    expect(
      validateIsbnRecord({ value: '9780306406157', status: 'assigned' }).map(({ field }) => field)
    ).toContain('edition-id');
    expect(
      validateIsbnRecord({
        value: '9780306406157',
        status: 'available',
        'edition-id': 'pm-edition-should-not-remain'
      })
    ).toHaveLength(1);
  });

  it('accepts a retired published correction only with immutable assignment evidence', () => {
    expect(
      validateIsbnRecord({
        value: '9780306406157',
        status: 'retired',
        corrections: {
          entries: [
            {
              reason: 'The distributor supplied the wrong identifier.',
              recordedAt: '2026-07-19T09:00:00.000Z',
              previousStatus: 'published',
              editionId: 'pm-edition-history-0001'
            }
          ]
        }
      })
    ).toEqual([]);
  });
});
