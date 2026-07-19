/** Proves manual readiness, stale-profile diagnostics, and the DST-005 boundary. */
import { describe, expect, it } from 'vitest';
import {
  DISTRIBUTION_NO_CLIENT_DISCLOSURE,
  targetReadiness,
  validatePlatformProfile
} from '../../src/domain/distribution/distribution-record';
describe('distribution records', () => {
  it('makes stale official review visible', () => {
    expect(
      validatePlatformProfile(
        {
          slug: 'test',
          label: 'Test',
          version: 1,
          'reviewed-at': '2025-01-01',
          'official-url': 'https://example.invalid',
          requirements: { items: [] }
        },
        '2026-07-19'
      ).some(({ severity }) => severity === 'warning')
    ).toBe(true);
  });
  it('explains every incomplete readiness input', () => {
    expect(
      targetReadiness({
        intent: true,
        'metadata-ready': false,
        'assets-ready': true,
        'pricing-ready': false,
        checklist: { items: [{ label: 'Manual portal review', done: false }] }
      }).reasons
    ).toHaveLength(3);
  });
  it('states the complete no-client boundary', () => {
    expect(DISTRIBUTION_NO_CLIENT_DISCLOSURE).toContain(
      'does not log in, upload, scrape, poll, call retailer APIs, or store credentials'
    );
  });
});
