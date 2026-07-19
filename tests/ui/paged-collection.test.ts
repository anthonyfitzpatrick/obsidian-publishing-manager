/** Verifies exact bounded windows after growth, shrinkage, and empty-state transitions. */
import { describe, expect, it } from 'vitest';
import { pageCollection, pagedCollectionWindow } from '../../src/ui/view-models/paged-collection';

describe('paged collection view model', () => {
  it('bounds visible rows and clamps a stale page after the collection shrinks', () => {
    const values = Array.from({ length: 123 }, (_, index) => index + 1);
    const third = pagedCollectionWindow(values.length, 2, 50);
    expect(third).toEqual({
      page: 2,
      pageSize: 50,
      total: 123,
      totalPages: 3,
      offset: 100,
      end: 123
    });
    expect(pageCollection(values, third)).toEqual(values.slice(100, 123));

    expect(pagedCollectionWindow(12, 9, 50)).toEqual({
      page: 0,
      pageSize: 50,
      total: 12,
      totalPages: 1,
      offset: 0,
      end: 12
    });
    expect(pagedCollectionWindow(0, 0, 50)).toEqual({
      page: 0,
      pageSize: 50,
      total: 0,
      totalPages: 1,
      offset: 0,
      end: 0
    });
  });
});
