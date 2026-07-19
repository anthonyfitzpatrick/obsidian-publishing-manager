/** Ensures confidence is never collapsed into, or presented as, the readiness score. */
import { describe, expect, it } from 'vitest';
import { evaluateReadiness } from '../../src/domain/readiness/readiness-engine';
import { buildReadinessSummary } from '../../src/ui/view-models/readiness-summary-view-model';

describe('readiness summary view model', () => {
  it('shows an honest foundation state before core rules exist', () => {
    expect(buildReadinessSummary(undefined)).toEqual({
      stateLabel: '○ Rules pending',
      scoreLabel: 'Score —',
      confidenceLabel: 'Confidence —',
      explanation: 'The M5 engine is active; core publishing checks arrive in the next stage.'
    });
  });

  it('renders score and confidence as separate labelled values', () => {
    const evaluation = evaluateReadiness(
      {
        code: 'TEST',
        version: 1,
        rules: [
          {
            code: 'KNOWN',
            version: 1,
            inputKeys: ['known'],
            scopes: ['book'],
            weight: 1,
            severity: 'required',
            applicability: () => true,
            evaluate: () => ({ state: 'pass', evidence: { summary: 'Known.' } })
          },
          {
            code: 'MISSING',
            version: 1,
            inputKeys: ['missing'],
            scopes: ['book'],
            weight: 1,
            severity: 'required',
            applicability: () => true,
            evaluate: () => ({ state: 'unknown', evidence: { summary: 'Missing.' } })
          }
        ]
      },
      { scope: { kind: 'book', id: 'fictional-book' }, inputs: {} },
      '2026-07-19T12:00:00.000Z'
    );
    expect(buildReadinessSummary(evaluation)).toMatchObject({
      stateLabel: '✓ Ready',
      scoreLabel: 'Score 100%',
      confidenceLabel: 'Confidence 50%'
    });
  });
});
