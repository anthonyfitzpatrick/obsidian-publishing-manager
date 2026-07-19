/** Verifies the in-Obsidian probe remains deterministic, bounded, and serializable offline. */
import { describe, expect, it } from 'vitest';
import {
  runReferenceHostPerformance,
  serializeReferenceHostPerformance
} from '../../src/application/diagnostics/reference-host-performance';

describe('reference-host performance', () => {
  it('measures every M9 interaction budget and creates a readable receipt', async () => {
    const report = await runReferenceHostPerformance();
    expect(report.scale).toEqual({
      books: 1_000,
      editions: 10_000,
      tasks: 50_000,
      salesLines: 1_000_000
    });
    expect(report.measurements).toHaveLength(8);
    expect(report.passed).toBe(true);
    expect(serializeReferenceHostPerformance(report)).toContain(
      '# M9 reference-host performance receipt'
    );
  });
});
