/**
 * The readiness engine is deliberately pure. Callers provide a complete input snapshot and an
 * evaluation timestamp; the engine never reads the vault, clock, network, or mutable settings.
 * That makes a result reproducible from the rule pack, scope, inputs, and timestamp recorded by
 * the application layer.
 */

export const READINESS_RESULT_STATES = [
  'pass',
  'warning',
  'fail',
  'unknown',
  'not-applicable'
] as const;
export type ReadinessResultState = (typeof READINESS_RESULT_STATES)[number];

export const READINESS_SCOPE_KINDS = [
  'book',
  'edition',
  'platform',
  'launch',
  'portfolio'
] as const;
export type ReadinessScopeKind = (typeof READINESS_SCOPE_KINDS)[number];
export type ReadinessSeverity = 'advisory' | 'required' | 'blocking';
export type ReadinessOverallState = 'ready' | 'attention' | 'not-ready' | 'unknown';

export interface ReadinessScope {
  readonly kind: ReadinessScopeKind;
  readonly id: string;
}

/** A destination is data, not a callback, so results remain serializable and auditable. */
export interface ReadinessDestination {
  readonly label: string;
  readonly workspace: string;
  readonly entityId?: string;
  readonly field?: string;
}

export interface ReadinessEvidence {
  readonly summary: string;
  readonly facts?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReadinessRuleContext {
  readonly scope: ReadinessScope;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export interface ReadinessRuleDecision {
  readonly state: Exclude<ReadinessResultState, 'not-applicable'>;
  readonly evidence: ReadinessEvidence;
  readonly remedy?: string;
  readonly destination?: ReadinessDestination;
}

/**
 * RDY-001 contract. Dependency keys name every input that can affect the rule and will become the
 * incremental invalidation boundary in RDY-009. Applicability is evaluated before the rule, so a
 * rule never needs to disguise an irrelevant scope as a pass.
 */
export interface ReadinessRule {
  readonly code: string;
  readonly version: number;
  readonly inputKeys: readonly string[];
  readonly scopes: readonly ReadinessScopeKind[];
  readonly weight: number;
  readonly severity: ReadinessSeverity;
  readonly applicability: (context: ReadinessRuleContext) => boolean;
  readonly evaluate: (context: ReadinessRuleContext) => ReadinessRuleDecision;
}

export interface ReadinessRulePack {
  readonly code: string;
  readonly version: number;
  readonly rules: readonly ReadinessRule[];
}

export interface ReadinessRuleResult {
  readonly code: string;
  readonly version: number;
  readonly inputKeys: readonly string[];
  readonly weight: number;
  readonly severity: ReadinessSeverity;
  readonly state: ReadinessResultState;
  readonly evidence: ReadinessEvidence;
  readonly remedy?: string;
  readonly destination?: ReadinessDestination;
}

export interface ReadinessEvaluation {
  readonly rulePackCode: string;
  readonly rulePackVersion: number;
  readonly evaluatedAt: string;
  readonly scope: ReadinessScope;
  readonly state: ReadinessOverallState;
  /** Null means there were no applicable known rules; it must not be rendered as zero. */
  readonly score: number | null;
  /** Null means there were no applicable rules; confidence is distinct from score. */
  readonly confidence: number | null;
  readonly applicableWeight: number;
  readonly knownWeight: number;
  readonly passedWeight: number;
  readonly results: readonly ReadinessRuleResult[];
}

/** Evaluates a complete rule pack in declared order and returns a deterministic projection. */
export function evaluateReadiness(
  pack: ReadinessRulePack,
  context: ReadinessRuleContext,
  evaluatedAt: string
): ReadinessEvaluation {
  validatePack(pack);
  if (!context.scope.id.trim()) throw new Error('Readiness scope identity is required.');
  if (!Number.isFinite(Date.parse(evaluatedAt)))
    throw new Error('Readiness evaluation time must be an ISO-compatible timestamp.');

  const results = pack.rules.map((rule) => evaluateRule(rule, context));
  const applicable = results.filter(({ state }) => state !== 'not-applicable');
  const known = applicable.filter(({ state }) => state !== 'unknown');
  const applicableWeight = sumWeight(applicable);
  const knownWeight = sumWeight(known);
  const passedWeight = sumWeight(known.filter(({ state }) => state === 'pass'));
  const score = knownWeight === 0 ? null : percentage(passedWeight, knownWeight);
  const confidence = applicableWeight === 0 ? null : percentage(knownWeight, applicableWeight);
  const blockingFailure = known.some(
    ({ state, severity }) => state === 'fail' && severity === 'blocking'
  );

  return {
    rulePackCode: pack.code,
    rulePackVersion: pack.version,
    evaluatedAt,
    scope: context.scope,
    state: overallState(results, score, blockingFailure),
    score,
    confidence,
    applicableWeight,
    knownWeight,
    passedWeight,
    results
  };
}

function evaluateRule(rule: ReadinessRule, context: ReadinessRuleContext): ReadinessRuleResult {
  const common = {
    code: rule.code,
    version: rule.version,
    inputKeys: [...rule.inputKeys],
    weight: rule.weight,
    severity: rule.severity
  };
  if (!rule.scopes.includes(context.scope.kind) || !rule.applicability(context))
    return {
      ...common,
      state: 'not-applicable',
      evidence: { summary: 'Rule does not apply to this scope and input snapshot.' }
    };
  const decision = rule.evaluate(context);
  return {
    ...common,
    state: decision.state,
    evidence: decision.evidence,
    ...(decision.remedy === undefined ? {} : { remedy: decision.remedy }),
    ...(decision.destination === undefined ? {} : { destination: decision.destination })
  };
}

function validatePack(pack: ReadinessRulePack): void {
  if (!/^[A-Z][A-Z0-9_.-]+$/u.test(pack.code))
    throw new Error('Rule-pack code must be a stable uppercase token.');
  if (!Number.isSafeInteger(pack.version) || pack.version < 1)
    throw new Error('Rule-pack version must be a positive integer.');
  const codes = new Set<string>();
  for (const rule of pack.rules) {
    if (!/^[A-Z][A-Z0-9_.-]+$/u.test(rule.code))
      throw new Error('Rule code must be a stable uppercase token.');
    if (codes.has(rule.code)) throw new Error(`Duplicate readiness rule code: ${rule.code}.`);
    codes.add(rule.code);
    if (!Number.isSafeInteger(rule.version) || rule.version < 1)
      throw new Error(`Rule ${rule.code} version must be a positive integer.`);
    if (!Number.isFinite(rule.weight) || rule.weight <= 0)
      throw new Error(`Rule ${rule.code} weight must be greater than zero.`);
    if (rule.scopes.length === 0) throw new Error(`Rule ${rule.code} must declare a scope.`);
    if (new Set(rule.inputKeys).size !== rule.inputKeys.length)
      throw new Error(`Rule ${rule.code} contains duplicate input keys.`);
  }
}

function sumWeight(results: readonly ReadinessRuleResult[]): number {
  return results.reduce((total, { weight }) => total + weight, 0);
}

/** Retains two decimal places without introducing presentation strings into the domain. */
function percentage(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function overallState(
  results: readonly ReadinessRuleResult[],
  score: number | null,
  blockingFailure: boolean
): ReadinessOverallState {
  if (blockingFailure) return 'not-ready';
  if (score === null) return 'unknown';
  if (results.some(({ state }) => state === 'fail' || state === 'warning')) return 'attention';
  return 'ready';
}
