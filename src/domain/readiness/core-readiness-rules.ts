/** RDY-007 core rule pack over a normalized, platform-independent evidence snapshot. */
import type { ReadinessRule, ReadinessRuleDecision, ReadinessRulePack } from './readiness-engine';

export const CORE_READINESS_RULE_PACK_VERSION = 1;

const coreRules: readonly ReadinessRule[] = [
  stateRule('CORE.COVER', 'cover.state', 'blocking', 'assets', 'cover', 'cover'),
  stateRule('CORE.ISBN', 'isbn.state', 'blocking', 'isbns', 'ISBN assignment', 'isbn'),
  stateRule('CORE.METADATA', 'metadata.state', 'blocking', 'metadata', 'metadata', 'metadata'),
  countRule('CORE.FORMATS', 'formats.count', 'blocking', 'editions', 'format'),
  freshnessRule(),
  pageCountRule(),
  stateRule(
    'CORE.TERRITORY_PRICE',
    'pricing.state',
    'required',
    'pricing',
    'territory price',
    'pricing'
  ),
  taskRule(),
  stateRule(
    'CORE.PLATFORM_CONFIRMATION',
    'platform.state',
    'blocking',
    'distribution',
    'manual platform confirmation',
    'platform'
  )
];

export const CORE_READINESS_RULE_PACK: ReadinessRulePack = {
  code: 'CORE',
  version: CORE_READINESS_RULE_PACK_VERSION,
  rules: coreRules
};

function stateRule(
  code: string,
  inputKey: string,
  severity: ReadinessRule['severity'],
  workspace: string,
  label: string,
  field: string
): ReadinessRule {
  return {
    code,
    version: 1,
    inputKeys: [inputKey],
    scopes: ['book', 'edition', 'platform'],
    weight: severity === 'blocking' ? 3 : 2,
    severity,
    applicability: () => true,
    evaluate: ({ inputs }) => decision(inputs[inputKey], label, workspace, field)
  };
}

function decision(
  value: unknown,
  label: string,
  workspace: string,
  field: string
): ReadinessRuleDecision {
  const destination = { label: `Open ${label}`, workspace, field };
  if (value === 'pass')
    return { state: 'pass', evidence: { summary: `${label} evidence is complete.` }, destination };
  if (value === 'warning')
    return {
      state: 'warning',
      evidence: { summary: `${label} evidence needs review.` },
      remedy: `Review the ${label} evidence.`,
      destination
    };
  if (value === 'fail')
    return {
      state: 'fail',
      evidence: { summary: `${label} evidence is incomplete.` },
      remedy: `Complete the ${label} evidence.`,
      destination
    };
  return {
    state: 'unknown',
    evidence: { summary: `${label} evidence is unavailable.` },
    remedy: `Record enough information to evaluate ${label}.`,
    destination
  };
}

function countRule(
  code: string,
  inputKey: string,
  severity: ReadinessRule['severity'],
  workspace: string,
  label: string
): ReadinessRule {
  return {
    code,
    version: 1,
    inputKeys: [inputKey],
    scopes: ['book', 'edition'],
    weight: 3,
    severity,
    applicability: () => true,
    evaluate: ({ inputs }) =>
      typeof inputs[inputKey] !== 'number'
        ? decision(undefined, label, workspace, inputKey)
        : inputs[inputKey] > 0
          ? decision('pass', label, workspace, inputKey)
          : decision('fail', label, workspace, inputKey)
  };
}

function freshnessRule(): ReadinessRule {
  return {
    code: 'CORE.FILE_FRESHNESS',
    version: 1,
    inputKeys: ['assets.freshness'],
    scopes: ['book', 'edition', 'platform'],
    weight: 3,
    severity: 'blocking',
    applicability: () => true,
    evaluate: ({ inputs }) =>
      decision(inputs['assets.freshness'], 'file freshness', 'assets', 'freshness')
  };
}

function pageCountRule(): ReadinessRule {
  return {
    code: 'CORE.PRINT_PAGE_COUNT',
    version: 1,
    inputKeys: ['edition.medium', 'edition.page-count'],
    scopes: ['edition', 'platform'],
    weight: 2,
    severity: 'blocking',
    applicability: ({ inputs }) => inputs['edition.medium'] === 'print',
    evaluate: ({ inputs }) =>
      typeof inputs['edition.page-count'] === 'number' && inputs['edition.page-count'] > 0
        ? decision('pass', 'print page count', 'editions', 'page-count')
        : decision('fail', 'print page count', 'editions', 'page-count')
  };
}

function taskRule(): ReadinessRule {
  return {
    code: 'CORE.REQUIRED_TASKS',
    version: 1,
    inputKeys: ['tasks.required-count', 'tasks.incomplete-count'],
    scopes: ['book', 'edition', 'platform', 'launch', 'portfolio'],
    weight: 2,
    severity: 'required',
    applicability: () => true,
    evaluate: ({ inputs }) => {
      const total = inputs['tasks.required-count'];
      const incomplete = inputs['tasks.incomplete-count'];
      if (typeof total !== 'number' || total === 0)
        return decision(undefined, 'required task completion', 'workflow', 'tasks');
      return decision(
        incomplete === 0 ? 'pass' : 'fail',
        'required task completion',
        'workflow',
        'tasks'
      );
    }
  };
}
