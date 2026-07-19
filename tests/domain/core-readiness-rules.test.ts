/** RDY-007/RDY-012 regression fixture over the documented core publishing evidence. */
import { describe, expect, it } from 'vitest';
import { CORE_READINESS_RULE_PACK } from '../../src/domain/readiness/core-readiness-rules';
import { evaluateReadiness } from '../../src/domain/readiness/readiness-engine';

const completeInputs = {
  'cover.state': 'pass',
  'isbn.state': 'pass',
  'metadata.state': 'pass',
  'formats.count': 2,
  'assets.freshness': 'pass',
  'edition.medium': 'print',
  'edition.page-count': 320,
  'pricing.state': 'pass',
  'tasks.required-count': 5,
  'tasks.incomplete-count': 0,
  'platform.state': 'pass'
} as const;

describe('core readiness rule pack', () => {
  it('passes a complete fictional print edition reproducibly', () => {
    const run = () =>
      evaluateReadiness(
        CORE_READINESS_RULE_PACK,
        { scope: { kind: 'edition', id: 'fictional-edition' }, inputs: completeInputs },
        '2026-07-19T12:00:00.000Z'
      );
    expect(run()).toEqual(run());
    expect(run()).toMatchObject({ state: 'ready', score: 100, confidence: 100 });
    expect(run().results.every(({ destination }) => destination !== undefined)).toBe(true);
  });

  it('keeps unknown evidence in confidence and a missing cover as a blocker', () => {
    const evaluation = evaluateReadiness(
      CORE_READINESS_RULE_PACK,
      {
        scope: { kind: 'edition', id: 'fictional-edition' },
        inputs: { ...completeInputs, 'cover.state': 'fail', 'assets.freshness': 'unknown' }
      },
      '2026-07-19T12:00:00.000Z'
    );
    expect(evaluation.state).toBe('not-ready');
    expect(evaluation.confidence).toBeLessThan(100);
    expect(evaluation.results.find(({ code }) => code === 'CORE.COVER')).toMatchObject({
      state: 'fail',
      remedy: 'Complete the cover evidence.'
    });
  });

  it('marks print page count not applicable for a digital edition', () => {
    const evaluation = evaluateReadiness(
      CORE_READINESS_RULE_PACK,
      {
        scope: { kind: 'edition', id: 'fictional-edition' },
        inputs: { ...completeInputs, 'edition.medium': 'digital', 'edition.page-count': undefined }
      },
      '2026-07-19T12:00:00.000Z'
    );
    expect(evaluation.results.find(({ code }) => code === 'CORE.PRINT_PAGE_COUNT')?.state).toBe(
      'not-applicable'
    );
  });
});
