/** SAL-001–SAL-014 application service over one local immutable sales ledger. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import { normalizeIsbn } from '../../domain/isbn/isbn-record';
import {
  normalizeSalesInput,
  periodsOverlap,
  salesKeys,
  sumDecimals,
  type SalesCorrectionKind,
  type SalesEntryKind,
  type SalesPreview
} from '../../domain/sales/sales-ledger';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';

export interface SalesEntryInput {
  readonly sourceId: string;
  readonly isbn: string;
  readonly platformTargetId: string;
  readonly country: string;
  readonly kind: SalesEntryKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly units: number;
  readonly returns: number;
  readonly currency: string;
  readonly money: Readonly<Record<string, string | undefined>>;
  readonly externalReference?: string;
}
export interface SalesCorrectionInput {
  readonly lineId: string;
  readonly kind: SalesCorrectionKind;
  readonly reason: string;
  readonly ownerLabel: string;
  readonly adjustment: Readonly<Record<string, string | number>>;
}
export interface SalesAggregateGroup {
  readonly currency: string;
  readonly units: number;
  readonly returns: number;
  readonly netUnits: number;
  readonly grossRevenue?: string;
  readonly netRevenue?: string;
  readonly proceeds?: string;
  readonly lines: readonly CatalogRecord[];
  /** Exact contributing count remains available when `lines` is only the visible page. */
  readonly lineCount?: number;
}
export interface SalesQuery {
  readonly bookId?: string;
  readonly seriesId?: string;
  readonly editionId?: string;
  readonly isbn?: string;
  readonly formatId?: string;
  readonly platform?: string;
  readonly publicationLocation?: string;
  readonly country?: string;
  readonly currency?: string;
  readonly sourceId?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}
export interface SalesAnalytics {
  readonly lines: readonly CatalogRecord[];
  /** Exact matching count remains separate from the bounded drill-down evidence page. */
  readonly lineCount?: number;
  readonly units: number;
  readonly returns: number;
  readonly trend: readonly (readonly [string, number])[];
  readonly books: readonly (readonly [string, number])[];
  readonly locations: readonly (readonly [string, number])[];
  readonly countries: readonly (readonly [string, number])[];
}

const SOURCE_PRESETS = [
  {
    label: 'Direct manual sale',
    kind: 'direct',
    defaults: { 'date-grain': 'day', 'sign-convention': 'positive-sales' }
  },
  {
    label: 'Retailer channel',
    kind: 'retailer',
    defaults: { 'date-grain': 'period', 'sign-convention': 'positive-sales' }
  },
  {
    label: 'Distributor channel',
    kind: 'distributor',
    defaults: { 'date-grain': 'period', 'sign-convention': 'positive-sales' }
  },
  {
    label: 'Library or licensing channel',
    kind: 'library',
    defaults: { 'date-grain': 'period', 'sign-convention': 'positive-sales' }
  }
] as const;

export class SalesProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}
  public sources(): readonly CatalogRecord[] {
    return this.catalog.recordsOfType('sales-source');
  }
  /** Reads user-owned defaults from the source note; unknown keys remain harmless Markdown data. */
  public sourceDefaults(sourceId: string): Readonly<Record<string, unknown>> {
    const source = this.catalog.recordById(sourceId);
    return source?.type === 'sales-source' && isRecord(source.fields.defaults)
      ? source.fields.defaults
      : {};
  }
  public lines(bookId?: string): readonly CatalogRecord[] {
    return [...this.matchingLines(bookId === undefined ? {} : { bookId })];
  }
  /** Resolves every filter through canonical relationships; no label is guessed. */
  public query(input: SalesQuery): readonly CatalogRecord[] {
    return [...this.matchingLines(input)];
  }

  /** Materializes only the requested drill-down rows while still reporting an exact total. */
  public queryPage(
    input: SalesQuery,
    offset: number,
    limit: number
  ): { readonly lines: readonly CatalogRecord[]; readonly total: number } {
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.floor(limit));
    const lines: CatalogRecord[] = [];
    let total = 0;
    for (const line of this.matchingLines(input)) {
      if (total >= safeOffset && lines.length < safeLimit) lines.push(line);
      total += 1;
    }
    return { lines, total };
  }
  /** Produces disposable, inspectable counts; the returned lines are the drill-down evidence. */
  public analytics(
    input: SalesQuery = {},
    page?: { readonly offset: number; readonly limit: number }
  ): SalesAnalytics {
    const allCorrections = this.correctionsByLineId();
    const visibleLines: CatalogRecord[] = [];
    let lineCount = 0;
    let units = 0;
    let returns = 0;
    const trend = new Map<string, number>();
    const books = new Map<string, number>();
    const locations = new Map<string, number>();
    const countries = new Map<string, number>();
    const adjusted = (line: CatalogRecord, field: 'units' | 'returns'): number =>
      Number(line.fields[field] ?? 0) +
      (allCorrections.get(line.id) ?? []).reduce(
        (sum, item) =>
          sum + Number((item.fields.adjustment as Record<string, unknown>)[field] ?? 0),
        0
      );
    const add = (map: Map<string, number>, key: string, value: number) =>
      map.set(key, (map.get(key) ?? 0) + value);
    for (const line of this.matchingLines(input)) {
      if (
        page === undefined ||
        (lineCount >= Math.max(0, page.offset) && visibleLines.length < Math.max(1, page.limit))
      )
        visibleLines.push(line);
      const adjustedUnits = adjusted(line, 'units');
      const adjustedReturns = adjusted(line, 'returns');
      const net = adjustedUnits - adjustedReturns;
      units += adjustedUnits;
      returns += adjustedReturns;
      add(trend, String(line.fields['start-date']).slice(0, 7), net);
      const edition = this.catalog.recordById(String(line.fields['edition-id']));
      const book =
        edition === undefined
          ? undefined
          : this.catalog.recordById(String(edition.fields['book-id']));
      add(
        books,
        typeof book?.fields.title === 'string'
          ? book.fields.title
          : (book?.id ?? 'Unresolved book'),
        net
      );
      const target = this.catalog.recordById(String(line.fields['platform-target-id']));
      const platform =
        typeof target?.fields.platform === 'string' ? target.fields.platform : 'Unknown';
      const location =
        typeof target?.fields['publication-location'] === 'string'
          ? target.fields['publication-location']
          : 'Unknown';
      add(locations, `${platform} · ${location}`, net);
      add(countries, String(line.fields.country), net);
      lineCount += 1;
    }
    const ordered = (values: Map<string, number>) =>
      [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      lines: visibleLines,
      ...(page === undefined ? {} : { lineCount }),
      units,
      returns,
      trend: ordered(trend),
      books: ordered(books),
      locations: ordered(locations),
      countries: ordered(countries)
    };
  }
  public corrections(lineId?: string): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType('sales-correction')
      .filter((item) => lineId === undefined || item.fields['sales-line-id'] === lineId);
  }
  public async installSourcePresets(): Promise<readonly CatalogRecord[]> {
    const existing = new Set(this.sources().map((source) => String(source.fields.kind)));
    const created: CatalogRecord[] = [];
    for (const preset of SOURCE_PRESETS)
      if (!existing.has(preset.kind))
        created.push(
          await this.createRecord('sales-source', preset.label, {
            ...preset,
            notes: 'Local reusable entry preset. No credentials, endpoint, or network behavior.'
          })
        );
    return created;
  }
  public preview(input: SalesEntryInput): SalesPreview {
    const isbn = normalizeIsbn(input.isbn);
    const matches = this.catalog
      .recordsOfType('isbn')
      .filter((item) => item.fields.value === isbn.isbn13);
    if (matches.length !== 1)
      throw new Error('ISBN must resolve to exactly one canonical pool record.');
    const isbnRecord = matches[0]!;
    const editionId = isbnRecord.fields['edition-id'];
    if (
      typeof editionId !== 'string' ||
      !['assigned', 'published'].includes(String(isbnRecord.fields.status))
    )
      throw new Error('ISBN must be assigned or published before recording a sale.');
    const target = this.catalog.recordById(input.platformTargetId);
    if (target?.type !== 'platform-target' || target.fields['edition-id'] !== editionId)
      throw new Error('Publication location must belong to the ISBN edition.');
    if (this.catalog.recordById(input.sourceId)?.type !== 'sales-source')
      throw new Error('Choose a valid local sales source.');
    const normalized = normalizeSalesInput({
      sourceId: input.sourceId,
      isbnId: isbnRecord.id,
      editionId,
      ...(typeof isbnRecord.fields['format-id'] === 'string'
        ? { formatId: isbnRecord.fields['format-id'] }
        : {}),
      platformTargetId: target.id,
      country: input.country,
      kind: input.kind,
      startDate: input.startDate,
      endDate: input.endDate,
      units: input.units,
      returns: input.returns,
      currency: input.currency,
      money: input.money,
      ...(input.externalReference?.trim()
        ? { externalReference: input.externalReference.trim() }
        : {}),
      sourceValues: {
        isbn: input.isbn,
        country: input.country,
        currency: input.currency,
        startDate: input.startDate,
        endDate: input.endDate,
        units: input.units,
        returns: input.returns,
        money: input.money
      }
    });
    const keys = salesKeys(normalized);
    const exact = this.lines()
      .filter((line) => line.fields['entry-key'] === keys.entryKey)
      .map(({ id }) => id);
    const overlap = this.lines()
      .filter(
        (line) =>
          line.fields['source-id'] === normalized.sourceId &&
          line.fields['isbn-id'] === normalized.isbnId &&
          line.fields['platform-target-id'] === normalized.platformTargetId &&
          line.fields.country === normalized.country &&
          periodsOverlap(
            String(line.fields['start-date']),
            String(line.fields['end-date']),
            normalized.startDate,
            normalized.endDate
          ) &&
          line.fields['entry-key'] !== keys.entryKey
      )
      .map(({ id }) => id);
    return {
      normalized,
      ...keys,
      exactDuplicateIds: exact,
      overlappingIds: overlap,
      warnings: overlap.length
        ? [
            'Coverage overlaps accepted local sales evidence; explicitly reconcile before counting both.'
          ]
        : []
    };
  }
  public async record(input: SalesEntryInput, acceptOverlap = false): Promise<CatalogRecord> {
    const preview = this.preview(input);
    if (preview.exactDuplicateIds.length)
      throw new Error('Exact duplicate sales entry is already accepted.');
    if (preview.overlappingIds.length && !acceptOverlap)
      throw new Error('Overlapping coverage requires explicit acceptance.');
    const value = preview.normalized;
    return this.createRecord('sales-line', `${value.startDate}-${value.country}-${value.isbnId}`, {
      'source-id': value.sourceId,
      'isbn-id': value.isbnId,
      'edition-id': value.editionId,
      ...(value.formatId === undefined ? {} : { 'format-id': value.formatId }),
      'platform-target-id': value.platformTargetId,
      country: value.country,
      kind: value.kind,
      'start-date': value.startDate,
      'end-date': value.endDate,
      units: value.units,
      returns: value.returns,
      'net-units': value.units - value.returns,
      currency: value.currency,
      ...value.money,
      ...(value.externalReference === undefined
        ? {}
        : { 'external-reference': value.externalReference }),
      'entry-key': preview.entryKey,
      'coverage-key': preview.coverageKey,
      status: 'accepted',
      provenance: {
        method: 'manual-entry',
        recordedAt: this.clock.now().toISOString(),
        overlapAccepted: acceptOverlap,
        previewWarnings: preview.warnings
      },
      'source-values': value.sourceValues
    });
  }
  public async correct(input: SalesCorrectionInput): Promise<CatalogRecord> {
    const line = this.catalog.recordById(input.lineId);
    if (line?.type !== 'sales-line') throw new Error('Choose one accepted sales line.');
    if (!input.reason.trim() || !input.ownerLabel.trim())
      throw new Error('Correction reason and owner label are required.');
    return this.createRecord('sales-correction', `${input.kind}-${line.id}`, {
      'sales-line-id': line.id,
      kind: input.kind,
      reason: input.reason.trim(),
      timestamp: this.clock.now().toISOString(),
      adjustment: input.adjustment,
      'owner-label': input.ownerLabel.trim()
    });
  }
  public aggregates(
    query: string | SalesQuery = {},
    page?: { readonly offset: number; readonly limit: number }
  ): readonly SalesAggregateGroup[] {
    interface Accumulator {
      units: number;
      returns: number;
      grossRevenue?: string;
      netRevenue?: string;
      proceeds?: string;
      lineCount: number;
      lines: CatalogRecord[];
    }
    const groups = new Map<string, Accumulator>();
    const corrections = this.correctionsByLineId();
    let globalIndex = 0;
    const input = typeof query === 'string' ? { bookId: query } : query;
    const addMoney = (current: string | undefined, value: unknown): string | undefined =>
      typeof value !== 'string'
        ? current
        : current === undefined
          ? value
          : sumDecimals([current, value]);
    for (const line of this.matchingLines(input)) {
      const currency = String(line.fields.currency);
      const group = groups.get(currency) ?? {
        units: 0,
        returns: 0,
        lineCount: 0,
        lines: []
      };
      const includeLine =
        page === undefined ||
        (globalIndex >= Math.max(0, page.offset) &&
          globalIndex < Math.max(0, page.offset) + Math.max(1, page.limit));
      if (includeLine) group.lines.push(line);
      const lineCorrections = corrections.get(line.id) ?? [];
      group.units +=
        Number(line.fields.units ?? 0) +
        lineCorrections.reduce(
          (sum, item) =>
            sum + Number((item.fields.adjustment as Record<string, unknown>).units ?? 0),
          0
        );
      group.returns +=
        Number(line.fields.returns ?? 0) +
        lineCorrections.reduce(
          (sum, item) =>
            sum + Number((item.fields.adjustment as Record<string, unknown>).returns ?? 0),
          0
        );
      for (const field of ['gross-revenue', 'net-revenue', 'proceeds'] as const) {
        const property =
          field === 'gross-revenue'
            ? 'grossRevenue'
            : field === 'net-revenue'
              ? 'netRevenue'
              : 'proceeds';
        let value = addMoney(group[property], line.fields[field]);
        for (const correction of lineCorrections)
          value = addMoney(value, (correction.fields.adjustment as Record<string, unknown>)[field]);
        if (value !== undefined) {
          if (field === 'gross-revenue') group.grossRevenue = value;
          else if (field === 'net-revenue') group.netRevenue = value;
          else group.proceeds = value;
        }
      }
      group.lineCount += 1;
      groups.set(currency, group);
      globalIndex += 1;
    }
    return [...groups.entries()]
      .map(([currency, group]) => ({
        currency,
        units: group.units,
        returns: group.returns,
        netUnits: group.units - group.returns,
        ...(group.grossRevenue === undefined ? {} : { grossRevenue: group.grossRevenue }),
        ...(group.netRevenue === undefined ? {} : { netRevenue: group.netRevenue }),
        ...(group.proceeds === undefined ? {} : { proceeds: group.proceeds }),
        lines: group.lines,
        ...(page === undefined ? {} : { lineCount: group.lineCount })
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  /**
   * Streams accepted rows and resolves relationship filters through indexed stable identities.
   * Keeping this as one shared iterator ensures UI pages, analytics, exports, and duplicate checks
   * cannot drift into subtly different attribution rules.
   */
  private *matchingLines(input: SalesQuery): IterableIterator<CatalogRecord> {
    const normalizedIsbn = input.isbn?.trim() ? normalizeIsbn(input.isbn).isbn13 : undefined;
    const bookEditionIds =
      input.bookId === undefined
        ? undefined
        : new Set(this.catalog.editionsForBook(input.bookId).map(({ id }) => id));
    for (const line of this.catalog.iterateRecordsOfType('sales-line')) {
      if (line.fields.status !== 'accepted') continue;
      if (bookEditionIds !== undefined && !bookEditionIds.has(String(line.fields['edition-id'])))
        continue;
      const edition = this.catalog.recordById(String(line.fields['edition-id']));
      const book =
        edition === undefined
          ? undefined
          : this.catalog.recordById(String(edition.fields['book-id']));
      const isbn = this.catalog.recordById(String(line.fields['isbn-id']));
      const target = this.catalog.recordById(String(line.fields['platform-target-id']));
      if (
        (input.seriesId === undefined || book?.fields['series-id'] === input.seriesId) &&
        (input.editionId === undefined || line.fields['edition-id'] === input.editionId) &&
        (normalizedIsbn === undefined || isbn?.fields.value === normalizedIsbn) &&
        (input.formatId === undefined || line.fields['format-id'] === input.formatId) &&
        (input.platform === undefined || target?.fields.platform === input.platform) &&
        (input.publicationLocation === undefined ||
          target?.fields['publication-location'] === input.publicationLocation) &&
        (input.country === undefined || line.fields.country === input.country.toUpperCase()) &&
        (input.currency === undefined || line.fields.currency === input.currency.toUpperCase()) &&
        (input.sourceId === undefined || line.fields['source-id'] === input.sourceId) &&
        (input.startDate === undefined || String(line.fields['end-date']) >= input.startDate) &&
        (input.endDate === undefined || String(line.fields['start-date']) <= input.endDate)
      )
        yield line;
    }
  }

  /** Builds one correction lookup per operation instead of rescanning the ledger for every row. */
  private correctionsByLineId(): ReadonlyMap<string, readonly CatalogRecord[]> {
    const result = new Map<string, CatalogRecord[]>();
    for (const correction of this.catalog.iterateRecordsOfType('sales-correction')) {
      const lineId = String(correction.fields['sales-line-id']);
      result.set(lineId, [...(result.get(lineId) ?? []), correction]);
    }
    return result;
  }

  private async createRecord(
    type: 'sales-source' | 'sales-line' | 'sales-correction',
    label: string,
    fields: Readonly<Record<string, unknown>>
  ): Promise<CatalogRecord> {
    const now = this.clock.now().toISOString();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(type, label, this.catalog.knownPaths()),
      {
        envelope: {
          pmId: `pm-${type}-${safeId(this.ids.generate())}`,
          pmType: type,
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields,
        body: `# ${label}\n\nLocal canonical sales evidence.\n`
      }
    );
    this.catalog.accept(loaded, 'created');
    const result = this.catalog.recordById(loaded.envelope.pmId);
    if (result === undefined) throw new Error('Created sales record did not enter the catalog.');
    return result;
  }
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
