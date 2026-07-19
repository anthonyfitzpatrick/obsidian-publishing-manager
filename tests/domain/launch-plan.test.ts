/** Proves date-only leap/weekend handling and deterministic critical-path calculation. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAUNCH_TEMPLATE,
  criticalPath,
  shiftDateOnly
} from '../../src/domain/launch/launch-plan';

describe('launch plan domain', () => {
  it('keeps date-only arithmetic stable across leap days and working-day weekends', () => {
    expect(shiftDateOnly('2024-03-01', -1, false)).toBe('2024-02-29');
    expect(shiftDateOnly('2026-07-20', -1, true)).toBe('2026-07-17');
    expect(() => shiftDateOnly('2026-02-30', 0, false)).toThrow('real YYYY-MM-DD');
  });

  it('returns the longest dependency chain in template order', () => {
    expect(criticalPath(DEFAULT_LAUNCH_TEMPLATE)).toEqual([
      'L-90',
      'L-60',
      'L-30',
      'LAUNCH',
      'L+14'
    ]);
  });
});
