/**
 * Implements PRC-001–PRC-004 as deterministic local rules. Money is decimal text rather than a
 * binary number; warnings are explicitly planning heuristics and never retailer compliance claims.
 */

export type PriceSeverity = 'error' | 'warning';

export interface PriceDiagnostic {
  readonly field: string;
  readonly severity: PriceSeverity;
  readonly message: string;
}

export interface OddEndingRule {
  readonly currency: string;
  readonly endings: readonly string[];
}

export interface PriceValidationContext {
  readonly knownEditionIds?: ReadonlySet<string>;
  readonly requiredCurrencies?: readonly string[];
  readonly oddEndings?: readonly OddEndingRule[];
  readonly comparisonAmounts?: readonly { currency: string; amount: string }[];
}

/** Normalizes user-entered decimal text without ever converting its canonical value to float. */
export function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(trimmed))
    throw new Error('Enter a nonnegative decimal using digits and an optional decimal point.');
  const [whole = '0', fraction] = trimmed.split('.');
  const normalizedFraction = fraction?.replace(/0+$/u, '');
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

/** Exact positive comparison for canonical unsigned decimal text. */
export function isPositiveDecimal(value: string): boolean {
  return normalizeDecimal(value).replace(/[.0]/gu, '').length > 0;
}

/** Returns structural errors and explainable planning warnings for one canonical price snapshot. */
export function validatePriceRecord(
  fields: Readonly<Record<string, unknown>>,
  context: PriceValidationContext = {}
): readonly PriceDiagnostic[] {
  const diagnostics: PriceDiagnostic[] = [];
  requiredText(fields, 'edition-id', diagnostics);
  requiredText(fields, 'platform', diagnostics);
  const territory = requiredText(fields, 'territory', diagnostics);
  const currency = requiredText(fields, 'currency', diagnostics);
  if (territory !== undefined && !/^[A-Z]{2}$/u.test(territory))
    diagnostics.push(error('territory', 'Territory must be an uppercase ISO 3166-1 alpha-2 code.'));
  if (currency !== undefined && !/^[A-Z]{3}$/u.test(currency))
    diagnostics.push(error('currency', 'Currency must be an uppercase ISO 4217 code.'));
  const amount = decimalField(fields, 'amount', diagnostics, true);
  if (amount !== undefined) {
    const decimals = amount.split('.')[1]?.length ?? 0;
    if (decimals > 2)
      diagnostics.push(
        warning('amount', 'Amount uses more than two decimal places; verify marketplace precision.')
      );
    if (!isPositiveDecimal(amount))
      diagnostics.push(
        warning('amount', 'Price is zero; verify that free pricing is intentional and supported.')
      );
  }
  if (typeof fields['tax-included'] !== 'boolean')
    diagnostics.push(error('tax-included', 'Tax inclusion must be explicitly true or false.'));
  const taxRate = decimalField(fields, 'tax-rate', diagnostics, false);
  if (taxRate !== undefined && compareDecimal(taxRate, '100') > 0)
    diagnostics.push(error('tax-rate', 'Tax rate cannot exceed 100 percent.'));
  if (fields['tax-included'] === true && taxRate === undefined)
    diagnostics.push(warning('tax-rate', 'Tax is marked included but its rate is unknown.'));
  const from = dateField(fields, 'effective-from', diagnostics, true);
  const to = dateField(fields, 'effective-to', diagnostics, false);
  if (from !== undefined && to !== undefined && to < from)
    diagnostics.push(error('effective-to', 'Effective-to date cannot precede effective-from.'));
  requiredText(fields, 'source', diagnostics);
  decimalField(fields, 'print-cost', diagnostics, false);
  if (
    typeof fields['edition-id'] === 'string' &&
    context.knownEditionIds !== undefined &&
    !context.knownEditionIds.has(fields['edition-id'])
  )
    diagnostics.push(error('edition-id', 'Price refers to an unavailable edition.'));
  if (currency !== undefined && context.requiredCurrencies !== undefined)
    for (const required of context.requiredCurrencies)
      if (required !== currency)
        diagnostics.push(
          warning('currency', `This scope does not provide required currency ${required}.`)
        );
  if (amount !== undefined && currency !== undefined)
    addHeuristicWarnings(diagnostics, amount, currency, context);
  return diagnostics;
}

export const PRICE_HEURISTIC_DISCLOSURE =
  'Warnings are local planning heuristics. They do not certify retailer acceptance, tax compliance, or market suitability.';

function addHeuristicWarnings(
  diagnostics: PriceDiagnostic[],
  amount: string,
  currency: string,
  context: PriceValidationContext
): void {
  const rule = context.oddEndings?.find((candidate) => candidate.currency === currency);
  if (rule !== undefined && !rule.endings.some((ending) => amount.endsWith(ending)))
    diagnostics.push(
      warning(
        'amount',
        `Price does not use a configured ${currency} ending (${rule.endings.join(', ')}).`
      )
    );
  const peers =
    context.comparisonAmounts?.filter((candidate) => candidate.currency === currency) ?? [];
  for (const peer of peers)
    if (ratioExceeds(amount, peer.amount, 5)) {
      diagnostics.push(
        warning('amount', 'Price differs from another same-currency edition by more than 5×.')
      );
      break;
    }
}

/** Integer-scaled comparison avoids binary floating-point money arithmetic. */
export function compareDecimal(left: string, right: string): number {
  const [lw = '0', lf = ''] = normalizeDecimal(left).split('.');
  const [rw = '0', rf = ''] = normalizeDecimal(right).split('.');
  const places = Math.max(lf.length, rf.length);
  const li = BigInt(`${lw}${lf.padEnd(places, '0')}`);
  const ri = BigInt(`${rw}${rf.padEnd(places, '0')}`);
  return li === ri ? 0 : li > ri ? 1 : -1;
}

function ratioExceeds(left: string, right: string, ratio: number): boolean {
  const scale = (value: string): bigint => {
    const [whole = '0', fraction = ''] = normalizeDecimal(value).split('.');
    return BigInt(`${whole}${fraction.padEnd(6, '0').slice(0, 6)}`);
  };
  const a = scale(left);
  const b = scale(right);
  return a > b * BigInt(ratio) || b > a * BigInt(ratio);
}

function requiredText(
  fields: Readonly<Record<string, unknown>>,
  field: string,
  diagnostics: PriceDiagnostic[]
): string | undefined {
  const value = fields[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    diagnostics.push(error(field, `${field} is required.`));
    return undefined;
  }
  return value;
}

function decimalField(
  fields: Readonly<Record<string, unknown>>,
  field: string,
  diagnostics: PriceDiagnostic[],
  required: boolean
): string | undefined {
  const value = fields[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') {
    diagnostics.push(error(field, `${field} must be decimal text.`));
    return undefined;
  }
  try {
    return normalizeDecimal(value);
  } catch (cause) {
    diagnostics.push(error(field, cause instanceof Error ? cause.message : 'Decimal is invalid.'));
    return undefined;
  }
}

function dateField(
  fields: Readonly<Record<string, unknown>>,
  field: string,
  diagnostics: PriceDiagnostic[],
  required: boolean
): string | undefined {
  const value = fields[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    diagnostics.push(error(field, `${field} must be a date in YYYY-MM-DD form.`));
    return undefined;
  }
  return value;
}
function error(field: string, message: string): PriceDiagnostic {
  return { field, severity: 'error', message };
}
function warning(field: string, message: string): PriceDiagnostic {
  return { field, severity: 'warning', message };
}
