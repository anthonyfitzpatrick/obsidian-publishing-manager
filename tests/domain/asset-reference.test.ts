/** Proves every AST-005 freshness state and its human-readable evidence without host APIs. */
import { describe, expect, it } from 'vitest';
import { assessAssetFreshness, type AssetReference } from '../../src/domain/assets/asset-reference';

const baseline: AssetReference = {
  id: 'pm-asset-reference-00000000-0000-4000-8000-00000001',
  bookId: 'pm-book-00000000-0000-4000-8000-00000002',
  path: 'Production/book.epub',
  role: 'epub',
  modifiedTime: '2026-07-18T10:00:00.000Z',
  size: 120,
  fingerprint: 'sha256:abc',
  externallyManaged: false,
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z'
};
const baselineModifiedTime = '2026-07-18T10:00:00.000Z';

describe('asset freshness assessment', () => {
  it('distinguishes missing, external, unknown, stale, and current evidence', () => {
    expect(assessAssetFreshness(baseline, { exists: false }).state).toBe('missing');
    expect(
      assessAssetFreshness(
        { ...baseline, externallyManaged: true },
        { exists: true, modifiedTime: baselineModifiedTime, size: 120 }
      ).state
    ).toBe('externally-managed');
    expect(
      assessAssetFreshness(
        {
          id: baseline.id,
          bookId: baseline.bookId,
          path: baseline.path,
          role: baseline.role,
          externallyManaged: false,
          createdAt: baseline.createdAt,
          updatedAt: baseline.updatedAt
        },
        { exists: true }
      ).state
    ).toBe('unknown');
    expect(
      assessAssetFreshness(baseline, {
        exists: true,
        modifiedTime: '2026-07-18T11:00:00.000Z',
        size: 121
      }).state
    ).toBe('stale');
    const current = assessAssetFreshness(baseline, {
      exists: true,
      modifiedTime: baselineModifiedTime,
      size: 120,
      verifiedFingerprint: 'sha256:abc'
    });
    expect(current.state).toBe('current');
    expect(current.evidence.join(' ')).toContain('SHA-256');
  });
});
