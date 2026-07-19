/** Proves RDY-001–RDY-006 with fictional, deterministic rules and no vault dependency. */
import { describe, expect, it } from 'vitest';
import {
  evaluateReadiness,
  type ReadinessResultState,
  type ReadinessRule,
  type ReadinessScopeKind
} from '../../src/domain/readiness/readiness-engine';

const allScopes: readonly ReadinessScopeKind[] = [
  'book',
  'edition',
  'platform',
  'launch',
  'portfolio'
];

function rule(
  code: string,
  state: Exclude<ReadinessResultState, 'not-applicable'>,
  options: Partial<ReadinessRule> = {}
): ReadinessRule {
  return {
    code,
    version: 1,
    inputKeys: [`fictional.${code.toLowerCase()}`],
    scopes: allScopes,
    weight: 1,
    severity: 'required',
    applicability: () => true,
    evaluate: () => ({
      state,
      evidence: { summary: `${code} produced ${state}.` },
      remedy: 'Change the fictional input.',
      destination: { label: 'Open fictional field', workspace: 'overview', field: code }
    }),
    ...options
  };
}

function evaluate(rules: readonly ReadinessRule[], kind: ReadinessScopeKind = 'book') {
  return evaluateReadiness(
    { code: 'CORE', version: 1, rules },
    { scope: { kind, id: `fictional-${kind}` }, inputs: {} },
    '2026-07-19T12:00:00.000Z'
  );
}

describe('readiness engine', () => {
  it('retains the complete rule contract and all five result states', () => {
    const result = evaluate([
      rule('PASS', 'pass'),
      rule('WARN', 'warning'),
      rule('FAIL', 'fail'),
      rule('UNKNOWN', 'unknown'),
      rule('NA', 'pass', { applicability: () => false })
    ]);
    expect(result.results.map(({ state }) => state)).toEqual([
      'pass',
      'warning',
      'fail',
      'unknown',
      'not-applicable'
    ]);
    expect(result.results[0]).toMatchObject({
      code: 'PASS',
      version: 1,
      inputKeys: ['fictional.pass'],
      weight: 1,
      severity: 'required',
      remedy: 'Change the fictional input.',
      destination: { workspace: 'overview' }
    });
  });

  it.each(allScopes)('evaluates %s scope explicitly', (kind) => {
    expect(evaluate([rule('SCOPE', 'pass')], kind).scope).toEqual({
      kind,
      id: `fictional-${kind}`
    });
  });

  it('scores passed weight over applicable known weight', () => {
    const result = evaluate([
      rule('HEAVY', 'pass', { weight: 3 }),
      rule('LIGHT', 'fail', { weight: 1 }),
      rule('MISSING', 'unknown', { weight: 6 }),
      rule('IRRELEVANT', 'pass', { weight: 50, applicability: () => false })
    ]);
    expect(result.score).toBe(75);
    expect(result.applicableWeight).toBe(10);
    expect(result.knownWeight).toBe(4);
    expect(result.passedWeight).toBe(3);
  });

  it('caps the overall state when a blocking rule fails', () => {
    const result = evaluate([
      rule('LARGE', 'pass', { weight: 99 }),
      rule('BLOCK', 'fail', { weight: 1, severity: 'blocking' })
    ]);
    expect(result.score).toBe(99);
    expect(result.state).toBe('not-ready');
  });

  it('reports confidence separately from score when inputs are unknown', () => {
    const result = evaluate([
      rule('KNOWN', 'pass', { weight: 2 }),
      rule('UNKNOWN', 'unknown', { weight: 2 })
    ]);
    expect(result.score).toBe(100);
    expect(result.confidence).toBe(50);
    expect(result.state).toBe('ready');
  });

  it('rejects ambiguous packs before evaluation', () => {
    expect(() => evaluate([rule('DUPLICATE', 'pass'), rule('DUPLICATE', 'fail')])).toThrow(
      'Duplicate readiness rule code'
    );
  });
});
