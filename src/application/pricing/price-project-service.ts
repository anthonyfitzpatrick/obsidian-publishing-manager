/**
 * Coordinates PRC-001–PRC-006 through append-only Markdown snapshots. New and seeded prices stop
 * at a review model; revisions create a new identity linked to the prior record instead of editing
 * historical money. Exchange assumptions are user-supplied local planning evidence, never rates.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import {
  normalizeDecimal,
  PRICE_HEURISTIC_DISCLOSURE,
  validatePriceRecord,
  type OddEndingRule,
  type PriceDiagnostic
} from '../../domain/pricing/price-record';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';

export interface PriceInput {
  readonly editionId: string;
  readonly platform: string;
  readonly territory: string;
  readonly currency: string;
  readonly amount: string;
  readonly taxIncluded: boolean;
  readonly taxRate?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly source: string;
  readonly notes?: string;
  readonly printCost?: string;
}

export interface PricePreview {
  readonly mode: 'create' | 'revise' | 'seed';
  readonly fields: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly PriceDiagnostic[];
  readonly disclosure: string;
  readonly sourcePriceId?: string;
}

export interface SeedTarget {
  readonly territory: string;
  readonly currency: string;
  readonly rate: string;
  readonly rateDate: string;
  readonly rateSource: string;
  readonly ending?: string;
}

export interface PriceSeedPreview {
  readonly sourcePriceId: string;
  readonly rows: readonly PricePreview[];
  readonly disclosure: string;
}

export class PriceProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly oddEndings: readonly OddEndingRule[] = [
      { currency: 'USD', endings: ['.99'] },
      { currency: 'GBP', endings: ['.99'] },
      { currency: 'EUR', endings: ['.99'] },
      { currency: 'SEK', endings: ['9'] }
    ]
  ) {}

  public records(): readonly CatalogRecord[] {
    return this.catalog.recordsOfType('price');
  }

  public forBook(bookId: string): readonly CatalogRecord[] {
    const editions = new Set(this.catalog.editionsForBook(bookId).map(({ id }) => id));
    return this.records().filter((record) => editions.has(String(record.fields['edition-id'])));
  }

  public previewCreate(input: PriceInput): PricePreview {
    return this.makePreview('create', fieldsFromInput(input));
  }

  /** Revising copies unchanged scope fields but always creates a fresh effective-dated snapshot. */
  public previewRevision(sourcePriceId: string, input: PriceInput): PricePreview {
    const source = this.requirePrice(sourcePriceId);
    return this.makePreview(
      'revise',
      {
        ...fieldsFromInput(input),
        'supersedes-price-id': source.id
      },
      source.id
    );
  }

  /** Seeds target markets only from explicit, dated, sourced local multiplication assumptions. */
  public previewSeed(sourcePriceId: string, targets: readonly SeedTarget[]): PriceSeedPreview {
    const source = this.requirePrice(sourcePriceId);
    const amount = String(source.fields.amount);
    const rows = targets.map((target) => {
      const rate = normalizeDecimal(target.rate);
      const converted = applyRate(amount, rate, target.ending);
      return this.makePreview(
        'seed',
        {
          ...source.fields,
          territory: target.territory.trim().toUpperCase(),
          currency: target.currency.trim().toUpperCase(),
          amount: converted,
          'effective-from': target.rateDate,
          source: `Seeded from ${String(source.fields.currency)} ${amount}; ${target.rateSource.trim()}`,
          assumption: {
            basePriceId: source.id,
            baseAmount: amount,
            baseCurrency: source.fields.currency,
            rate,
            rateDate: target.rateDate,
            rateSource: target.rateSource.trim()
          }
        },
        source.id
      );
    });
    return { sourcePriceId, rows, disclosure: PRICE_HEURISTIC_DISCLOSURE };
  }

  /** Applies only an error-free reviewed snapshot and rechecks current catalog conflicts. */
  public async apply(preview: PricePreview): Promise<CatalogRecord> {
    const fresh = this.makePreview(preview.mode, preview.fields, preview.sourcePriceId);
    const errors = fresh.diagnostics.filter(({ severity }) => severity === 'error');
    if (errors.length > 0) throw new Error(errors.map(({ message }) => message).join(' '));
    this.assertUniqueEffectiveScope(fresh.fields);
    const now = this.clock.now().toISOString();
    const label = [
      fresh.fields['edition-id'],
      fresh.fields.platform,
      fresh.fields.territory,
      fresh.fields.currency,
      fresh.fields['effective-from']
    ].join('-');
    const loaded = await this.repository.create(
      this.layout.collisionSafePath('price', label, this.catalog.knownPaths()),
      {
        envelope: {
          pmId: `pm-price-${safeId(this.ids.generate())}`,
          pmType: 'price',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields: fresh.fields,
        body: '# Price notes\n\nThis effective-dated snapshot is append-only pricing history.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
    const record = this.catalog.recordById(loaded.envelope.pmId);
    if (record === undefined) throw new Error('Created price did not enter the catalog.');
    return record;
  }

  public history(record: CatalogRecord): readonly CatalogRecord[] {
    const scope = scopeKey(record.fields);
    return this.records()
      .filter((candidate) => scopeKey(candidate.fields) === scope)
      .sort((left, right) =>
        String(right.fields['effective-from']).localeCompare(String(left.fields['effective-from']))
      );
  }

  private makePreview(
    mode: PricePreview['mode'],
    fields: Readonly<Record<string, unknown>>,
    sourcePriceId?: string
  ): PricePreview {
    const peers = this.records().map((record) => ({
      currency: String(record.fields.currency),
      amount: String(record.fields.amount)
    }));
    const diagnostics = validatePriceRecord(fields, {
      knownEditionIds: new Set(this.catalog.snapshot().editions.map(({ id }) => id)),
      oddEndings: this.oddEndings,
      comparisonAmounts: peers
    });
    return {
      mode,
      fields,
      diagnostics,
      disclosure: PRICE_HEURISTIC_DISCLOSURE,
      ...(sourcePriceId === undefined ? {} : { sourcePriceId })
    };
  }

  private assertUniqueEffectiveScope(fields: Readonly<Record<string, unknown>>): void {
    const key = `${scopeKey(fields)}:${String(fields['effective-from'])}`;
    if (
      this.records().some(
        (record) => `${scopeKey(record.fields)}:${String(record.fields['effective-from'])}` === key
      )
    )
      throw new Error('A price snapshot already exists for this scope and effective date.');
  }

  private requirePrice(id: string): CatalogRecord {
    const record = this.catalog.recordById(id);
    if (record?.type !== 'price') throw new Error('Choose a valid source price.');
    return record;
  }
}

function fieldsFromInput(input: PriceInput): Readonly<Record<string, unknown>> {
  return {
    'edition-id': input.editionId,
    platform: input.platform.trim(),
    territory: input.territory.trim().toUpperCase(),
    currency: input.currency.trim().toUpperCase(),
    amount: normalizeDecimal(input.amount),
    'tax-included': input.taxIncluded,
    ...(input.taxRate === undefined || input.taxRate.trim() === ''
      ? {}
      : { 'tax-rate': normalizeDecimal(input.taxRate) }),
    'effective-from': input.effectiveFrom,
    ...(input.effectiveTo === undefined || input.effectiveTo.trim() === ''
      ? {}
      : { 'effective-to': input.effectiveTo }),
    source: input.source.trim(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.printCost === undefined || input.printCost.trim() === ''
      ? {}
      : { 'print-cost': normalizeDecimal(input.printCost) })
  };
}

function scopeKey(fields: Readonly<Record<string, unknown>>): string {
  return [fields['edition-id'], fields.platform, fields.territory, fields.currency]
    .map(String)
    .join(':');
}

/** Multiplies decimal text using integer scaling and rounds half-up to two places. */
function applyRate(amount: string, rate: string, ending?: string): string {
  const parse = (value: string): { integer: bigint; scale: number } => {
    const [whole = '0', fraction = ''] = normalizeDecimal(value).split('.');
    return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length };
  };
  const left = parse(amount);
  const right = parse(rate);
  const product = left.integer * right.integer;
  const divisor = 10n ** BigInt(left.scale + right.scale);
  const cents = (product * 100n + divisor / 2n) / divisor;
  const result = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  if (!ending?.trim()) return result;
  const normalizedEnding = ending.trim().replace(/^\./u, '');
  if (!/^\d{1,2}$/u.test(normalizedEnding))
    throw new Error('Ending must contain one or two digits.');
  return `${cents / 100n}.${normalizedEnding.padStart(2, '0')}`;
}

function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
