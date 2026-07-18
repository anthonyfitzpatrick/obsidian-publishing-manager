import { describe, expect, it } from 'vitest';

import { createCatalogFixture, FIXTURE_PROFILES } from './fixtures/catalog-fixtures';
import { MALFORMED_FIXTURES } from './fixtures/malformed-fixtures';
import { UPGRADE_FIXTURES } from './fixtures/upgrade-fixtures';

describe('foundation fixtures', () => {
  it('generates the small profile deterministically', () => {
    const first = createCatalogFixture('small');
    const second = createCatalogFixture('small');

    expect(first).toEqual(second);
    expect(first.books).toHaveLength(FIXTURE_PROFILES.small.bookCount);
    expect(first.editions).toHaveLength(FIXTURE_PROFILES.small.editionCount);
    expect(first.tasks).toHaveLength(FIXTURE_PROFILES.small.taskCount);
  });

  it('generates a valid target-scale relationship graph', () => {
    const fixture = createCatalogFixture('targetScale');
    const bookIds = new Set(fixture.books.map(({ id }) => id));
    const taskIds = new Set(fixture.tasks.map(({ id }) => id));
    const allIds = new Set([...bookIds, ...fixture.editions.map(({ id }) => id), ...taskIds]);

    expect(fixture.books).toHaveLength(FIXTURE_PROFILES.targetScale.bookCount);
    expect(fixture.editions).toHaveLength(FIXTURE_PROFILES.targetScale.editionCount);
    expect(fixture.tasks).toHaveLength(FIXTURE_PROFILES.targetScale.taskCount);
    expect(allIds.size).toBe(
      FIXTURE_PROFILES.targetScale.bookCount +
        FIXTURE_PROFILES.targetScale.editionCount +
        FIXTURE_PROFILES.targetScale.taskCount
    );
    expect(fixture.editions.every(({ bookId }) => bookIds.has(bookId))).toBe(true);
    expect(fixture.tasks.every(({ bookId }) => bookIds.has(bookId))).toBe(true);
    expect(
      fixture.tasks.every(({ dependsOn }) => dependsOn === undefined || taskIds.has(dependsOn))
    ).toBe(true);
    expect(fixture.editions.some(({ assetPath }) => assetPath !== undefined)).toBe(true);
  });

  it('provides named malformed cases with expected diagnostics', () => {
    const ids = new Set(MALFORMED_FIXTURES.map(({ id }) => id));
    const categories = new Set(MALFORMED_FIXTURES.map(({ category }) => category));

    expect(ids.size).toBe(MALFORMED_FIXTURES.length);
    expect(categories).toEqual(
      new Set([
        'invalid-yaml',
        'duplicate-id',
        'dependency-cycle',
        'unsafe-path',
        'unsafe-markup',
        'oversized-value'
      ])
    );
    expect(
      MALFORMED_FIXTURES.every(({ expectedDiagnostic }) => expectedDiagnostic.length > 0)
    ).toBe(true);
  });

  it('covers previous, current, future, and interrupted upgrade states', () => {
    expect(UPGRADE_FIXTURES.map(({ expectedMode }) => expectedMode)).toEqual([
      'migrate',
      'current',
      'read-only',
      'resume'
    ]);

    for (const fixture of UPGRADE_FIXTURES) {
      expect(
        fixture.expectedPreservedKeys.every((key) =>
          Object.prototype.hasOwnProperty.call(fixture.source, key)
        )
      ).toBe(true);
    }
  });

  it('contains no known personal project identifiers', () => {
    const serialized = JSON.stringify({
      small: createCatalogFixture('small'),
      malformed: MALFORMED_FIXTURES,
      upgrades: UPGRADE_FIXTURES
    }).toLowerCase();

    expect(serialized).not.toContain('anthony fitzpatrick');
    expect(serialized).not.toContain('wolf 359 press');
  });
});
