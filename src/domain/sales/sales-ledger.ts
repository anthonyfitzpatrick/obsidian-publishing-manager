/** Pure SAL-001/SAL-004/SAL-005/SAL-007/SAL-009/SAL-010 sales ledger contracts. */
export type SalesEntryKind = 'transaction' | 'period-summary';
export type SalesCorrectionKind = 'correction' | 'refund' | 'return' | 'reversal';
export const MONEY_FIELDS = [
  'gross-revenue',
  'net-revenue',
  'tax',
  'fees',
  'discounts',
  'proceeds'
] as const;

export interface NormalizedSalesInput {
  readonly sourceId: string;
  readonly isbnId: string;
  readonly editionId: string;
  readonly formatId?: string;
  readonly platformTargetId: string;
  readonly country: string;
  readonly kind: SalesEntryKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly units: number;
  readonly returns: number;
  readonly currency: string;
  readonly money: Readonly<Record<string, string>>;
  readonly externalReference?: string;
  readonly sourceValues: Readonly<Record<string, unknown>>;
}
export interface SalesPreview {
  readonly normalized: NormalizedSalesInput;
  readonly entryKey: string;
  readonly coverageKey: string;
  readonly exactDuplicateIds: readonly string[];
  readonly overlappingIds: readonly string[];
  readonly warnings: readonly string[];
}

export function normalizeSalesInput(
  input: Omit<NormalizedSalesInput, 'country' | 'currency' | 'money'> & {
    country: string;
    currency: string;
    money: Readonly<Record<string, string | undefined>>;
  }
): NormalizedSalesInput {
  const country = input.country.trim().toUpperCase();
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country))
    throw new Error('Sale country must be an ISO-style two-letter code.');
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new Error('Currency must be an ISO-style three-letter code.');
  if (!isDate(input.startDate) || !isDate(input.endDate) || input.endDate < input.startDate)
    throw new Error('Sale coverage dates must be real and ordered.');
  if (input.kind === 'transaction' && input.startDate !== input.endDate)
    throw new Error('An individual transaction uses one sale date.');
  if (
    !Number.isSafeInteger(input.units) ||
    !Number.isSafeInteger(input.returns) ||
    input.units < 0 ||
    input.returns < 0
  )
    throw new Error('Units and returns must be non-negative whole numbers.');
  const money: Record<string, string> = {};
  for (const field of MONEY_FIELDS) {
    const value = input.money[field];
    if (value !== undefined && value.trim() !== '') money[field] = normalizeDecimal(value);
  }
  return { ...input, country, currency, money };
}

export function salesKeys(input: NormalizedSalesInput): { entryKey: string; coverageKey: string } {
  const coverage = [
    input.sourceId,
    input.isbnId,
    input.platformTargetId,
    input.country,
    input.startDate,
    input.endDate
  ].join('|');
  return {
    coverageKey: coverage,
    entryKey: [
      coverage,
      input.kind,
      input.units,
      input.returns,
      input.currency,
      ...MONEY_FIELDS.map((field) => input.money[field] ?? '')
    ].join('|')
  };
}
export function periodsOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
export function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(trimmed))
    throw new Error(`Money value ${value} is not canonical decimal text.`);
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const cleaned = fraction.replace(/0+$/u, '');
  return cleaned ? `${whole}.${cleaned}` : whole;
}
export function sumDecimals(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((value) => (value.split('.')[1] ?? '').length));
  const total = values.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const amount = BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
    return sum + (negative ? -amount : amount);
  }, 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const result =
    scale === 0
      ? digits
      : `${digits.slice(0, -scale)}.${digits.slice(-scale).replace(/0+$/u, '')}`.replace(
          /\.$/u,
          ''
        );
  return `${negative ? '-' : ''}${result}`;
}
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  // Date.UTC deliberately rolls impossible values into a later month. Comparing every UTC part
  // rejects that rollover while remaining independent of the host timezone and daylight saving.
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}
