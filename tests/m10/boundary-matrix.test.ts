/**
 * Closes the M10 calendar, Unicode, identifier, relationship, and limit matrix with explicit edge
 * examples. Broader malformed and target-scale fixtures remain in tests/fixtures.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookCatalog } from '../../src/application/catalog/book-catalog';
import type { Clock } from '../../src/domain/foundation/clock';
import { serializeEnvelope } from '../../src/domain/records/record-envelope';
import { normalizeSalesInput } from '../../src/domain/sales/sales-ledger';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { shiftDateOnly } from '../../src/domain/launch/launch-plan';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

afterEach(() => vi.unstubAllEnvs());

describe('M10 boundary matrix', () => {
  it('keeps date-only launch arithmetic stable across leap years and DST zones', () => {
    for (const timezone of ['UTC', 'Europe/Stockholm', 'America/New_York', 'Australia/Sydney']) {
      vi.stubEnv('TZ', timezone);
      expect(shiftDateOnly('2028-03-01', -1, false)).toBe('2028-02-29');
      expect(shiftDateOnly('2026-03-30', -1, true)).toBe('2026-03-27');
      expect(shiftDateOnly('2026-11-02', -1, true)).toBe('2026-10-30');
    }
  });

  it('rejects impossible sales dates rather than accepting JavaScript date rollover', () => {
    expect(() =>
      normalizeSalesInput({
        sourceId: 'fictional-source',
        isbnId: 'pm-isbn-fictional-0001',
        editionId: 'pm-edition-fictional-0001',
        platformTargetId: 'pm-platform-fictional-0001',
        country: 'SE',
        kind: 'transaction',
        startDate: '2026-02-30',
        endDate: '2026-02-30',
        units: 1,
        returns: 0,
        currency: 'SEK',
        money: { proceeds: '10.00' },
        sourceValues: {}
      })
    ).toThrow('real and ordered');
  });

  it('normalizes canonically equivalent Unicode paths to one vault identity', () => {
    const composed = normalizeVaultPath('Publishing Manager/Books/Ångström 海.md');
    const decomposed = normalizeVaultPath('Publishing Manager/Books/Ångström 海.md');
    expect(decomposed).toBe(composed);
  });

  it('reports missing relationships and duplicate identities in one catalog rebuild', async () => {
    const vault = new MemoryVaultTextPort();
    const codec = new JsonTestFrontmatterCodec();
    const repository = new VaultManagedRecordRepository(vault, codec);
    const clock: Clock = { now: () => new Date('2026-07-20T12:00:00.000Z') };
    const catalog = new BookCatalog(repository, clock);
    const paths = [
      normalizeVaultPath('Publishing Manager/Books/fictional-a.md'),
      normalizeVaultPath('Publishing Manager/Books/fictional-b.md'),
      normalizeVaultPath('Publishing Manager/Books/fictional-linked.md')
    ];
    const source = (id: string, fields: Readonly<Record<string, unknown>> = {}) =>
      codec.serialize({
        frontmatter: {
          title: 'Fictional Boundary Book',
          status: 'active',
          'primary-language': 'en',
          ...fields,
          ...serializeEnvelope({
            pmId: id,
            pmType: 'book',
            pmSchema: 1,
            createdAt: '2026-07-20T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z'
          })
        },
        body: ''
      });
    vault.files.set(paths[0]!, source('pm-book-duplicate-boundary'));
    vault.files.set(paths[1]!, source('pm-book-duplicate-boundary'));
    vault.files.set(
      paths[2]!,
      source('pm-book-missing-link', {
        'series-id': 'pm-series-does-not-exist',
        'series-position': 1
      })
    );

    await catalog.initialize(paths);
    const codes = catalog.snapshot().diagnostics.map(({ code }) => code);
    expect(codes).toContain('catalog.duplicate-id');
    expect(codes).toContain('catalog.unresolved-link');
  });
});
