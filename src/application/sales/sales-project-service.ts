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
import { validateRecordSchema } from '../../domain/records/schema-validation';
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
  /** Exact internal target identity used by duplicate/overlap and partition routing. */
  readonly platformTargetId?: string;
  readonly publicationLocation?: string;
  readonly country?: string;
  readonly currency?: string;
  readonly sourceId?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

interface PartitionedSalesRow {
  readonly id: string;
  readonly createdAt: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A bounded partition keeps canonical Markdown editable while avoiding one note/object per line. */
const MAX_PARTITION_ROWS = 1_000;
// Leave headroom beneath the global 1 MiB frontmatter boundary for the partition envelope/header.
const MAX_PARTITION_BYTES = 786_432;
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
    if (this.canUsePartitionSummaries(input))
      return this.partitionPage(input, safeOffset, safeLimit);
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
    if (page !== undefined && this.canUsePartitionSummaries(input))
      return this.partitionAnalytics(input, page);
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
    const candidates = [
      ...this.matchingLines({
        sourceId: normalized.sourceId,
        isbn: input.isbn,
        platformTargetId: normalized.platformTargetId,
        country: normalized.country,
        startDate: normalized.startDate,
        endDate: normalized.endDate
      })
    ];
    const exact = candidates
      .filter((line) => line.fields['entry-key'] === keys.entryKey)
      .map(({ id }) => id);
    const overlap = candidates
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
    const fields = {
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
    };
    return this.appendPartitionedLine(fields, value.startDate, value.endDate);
  }
  public async correct(input: SalesCorrectionInput): Promise<CatalogRecord> {
    const line = this.findLineById(input.lineId);
    if (line?.type !== 'sales-line') throw new Error('Choose one accepted sales line.');
    if (!input.reason.trim() || !input.ownerLabel.trim())
      throw new Error('Correction reason and owner label are required.');
    const partition = this.catalog
      .recordsOfType('sales-partition')
      .find(({ path }) => path === line.path);
    return this.createRecord('sales-correction', `${input.kind}-${line.id}`, {
      'sales-line-id': line.id,
      ...(partition === undefined ? {} : { 'sales-partition-id': partition.id }),
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
    if (page !== undefined && this.canUsePartitionSummaries(input))
      return this.partitionAggregates(input, page);
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

  /** Header summaries are authoritative only when no legacy rows, corrections, or partial dates apply. */
  private canUsePartitionSummaries(input: SalesQuery): boolean {
    const corrections = this.catalog.recordsOfType('sales-correction');
    return (
      input.startDate === undefined &&
      input.endDate === undefined &&
      this.catalog.recordsPageOfType('sales-line', 0, 1).total === 0 &&
      corrections.every((correction) => {
        const partitionId = correction.fields['sales-partition-id'];
        return (
          typeof partitionId === 'string' &&
          this.catalog.recordById(partitionId)?.type === 'sales-partition'
        );
      })
    );
  }

  /** Resolves every relationship filter from bounded partition headers without expanding rows. */
  private matchingPartitions(input: SalesQuery): readonly CatalogRecord[] {
    const normalizedIsbn = input.isbn?.trim() ? normalizeIsbn(input.isbn).isbn13 : undefined;
    return this.catalog.recordsOfType('sales-partition').filter((partition) => {
      const edition = this.catalog.recordById(String(partition.fields['edition-id']));
      const book =
        edition === undefined
          ? undefined
          : this.catalog.recordById(String(edition.fields['book-id']));
      const isbn = this.catalog.recordById(String(partition.fields['isbn-id']));
      const target = this.catalog.recordById(String(partition.fields['platform-target-id']));
      return (
        (input.bookId === undefined || book?.id === input.bookId) &&
        (input.seriesId === undefined || book?.fields['series-id'] === input.seriesId) &&
        (input.editionId === undefined || edition?.id === input.editionId) &&
        (normalizedIsbn === undefined || isbn?.fields.value === normalizedIsbn) &&
        (input.formatId === undefined || partition.fields['format-id'] === input.formatId) &&
        (input.platformTargetId === undefined || target?.id === input.platformTargetId) &&
        (input.platform === undefined || target?.fields.platform === input.platform) &&
        (input.publicationLocation === undefined ||
          target?.fields['publication-location'] === input.publicationLocation) &&
        (input.country === undefined || partition.fields.country === input.country.toUpperCase()) &&
        (input.currency === undefined ||
          partition.fields.currency === input.currency.toUpperCase()) &&
        (input.sourceId === undefined || partition.fields['source-id'] === input.sourceId)
      );
    });
  }

  /** Uses exact header counts to skip complete shards and parse only the requested visible page. */
  private partitionPage(
    input: SalesQuery,
    offset: number,
    limit: number
  ): { readonly lines: readonly CatalogRecord[]; readonly total: number } {
    const partitions = this.matchingPartitions(input);
    const total = partitions.reduce((sum, item) => sum + Number(item.fields['line-count']), 0);
    const lines: CatalogRecord[] = [];
    let cursor = 0;
    for (const partition of partitions) {
      const count = Number(partition.fields['line-count']);
      if (cursor + count <= offset) {
        cursor += count;
        continue;
      }
      let local = 0;
      for (const row of decodePartitionRows(partition)) {
        if (cursor + local >= offset && lines.length < limit)
          lines.push(toPartitionLine(partition, row));
        local += 1;
      }
      cursor += count;
      if (lines.length >= limit) break;
    }
    return { lines, total };
  }

  /** Builds charts and exact totals from partition headers, expanding only the evidence page. */
  private partitionAnalytics(
    input: SalesQuery,
    page: { readonly offset: number; readonly limit: number }
  ): SalesAnalytics {
    const partitions = this.matchingPartitions(input);
    const trend = new Map<string, number>();
    const books = new Map<string, number>();
    const locations = new Map<string, number>();
    const countries = new Map<string, number>();
    const corrections = this.partitionCorrectionsById();
    let units = 0;
    let returns = 0;
    let lineCount = 0;
    const add = (map: Map<string, number>, key: string, value: number) =>
      map.set(key, (map.get(key) ?? 0) + value);
    for (const partition of partitions) {
      const adjusted = adjustedPartitionSummary(
        partition.fields,
        corrections.get(partition.id) ?? []
      );
      const partitionUnits = Number(adjusted.units);
      const partitionReturns = Number(adjusted.returns);
      const net = partitionUnits - partitionReturns;
      units += partitionUnits;
      returns += partitionReturns;
      lineCount += Number(partition.fields['line-count']);
      add(trend, String(partition.fields.period), net);
      const edition = this.catalog.recordById(String(partition.fields['edition-id']));
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
      const target = this.catalog.recordById(String(partition.fields['platform-target-id']));
      const platform =
        typeof target?.fields.platform === 'string' ? target.fields.platform : 'Unknown';
      const location =
        typeof target?.fields['publication-location'] === 'string'
          ? target.fields['publication-location']
          : 'Unknown';
      add(locations, `${platform} · ${location}`, net);
      add(countries, String(partition.fields.country), net);
    }
    const ordered = (values: Map<string, number>) =>
      [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      lines: this.partitionPage(input, Math.max(0, page.offset), Math.max(1, page.limit)).lines,
      lineCount,
      units,
      returns,
      trend: ordered(trend),
      books: ordered(books),
      locations: ordered(locations),
      countries: ordered(countries)
    };
  }

  /** Produces currency totals from headers and associates only visible rows with their group. */
  private partitionAggregates(
    input: SalesQuery,
    page: { readonly offset: number; readonly limit: number }
  ): readonly SalesAggregateGroup[] {
    const partitions = this.matchingPartitions(input);
    const corrections = this.partitionCorrectionsById();
    const visible = this.partitionPage(
      input,
      Math.max(0, page.offset),
      Math.max(1, page.limit)
    ).lines;
    const groups = new Map<string, Omit<SalesAggregateGroup, 'currency' | 'lines'>>();
    for (const partition of partitions) {
      const currency = String(partition.fields.currency);
      const adjusted = adjustedPartitionSummary(
        partition.fields,
        corrections.get(partition.id) ?? []
      );
      const previous = groups.get(currency) ?? {
        units: 0,
        returns: 0,
        netUnits: 0,
        lineCount: 0
      };
      const units = previous.units + Number(adjusted.units);
      const returns = previous.returns + Number(adjusted.returns);
      groups.set(currency, {
        units,
        returns,
        netUnits: units - returns,
        lineCount: Number(previous.lineCount) + Number(partition.fields['line-count']),
        ...sumOptionalMoney(previous, adjusted, 'grossRevenue', 'gross-revenue'),
        ...sumOptionalMoney(previous, adjusted, 'netRevenue', 'net-revenue'),
        ...sumOptionalMoney(previous, adjusted, 'proceeds', 'proceeds')
      });
    }
    return [...groups.entries()]
      .map(([currency, group]) => ({
        currency,
        ...group,
        lines: visible.filter((line) => line.fields.currency === currency)
      }))
      .sort((left, right) => left.currency.localeCompare(right.currency));
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
    for (const line of this.iterateSalesLines(input)) {
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
        (input.platformTargetId === undefined ||
          line.fields['platform-target-id'] === input.platformTargetId) &&
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

  /**
   * Streams legacy one-note lines and the rows of only potentially matching bounded partitions.
   * Partition headers reject unrelated source/product/location/month groups before JSONL parsing,
   * so a duplicate preview never expands the entire million-line ledger.
   */
  private *iterateSalesLines(input: SalesQuery): IterableIterator<CatalogRecord> {
    yield* this.catalog.iterateRecordsOfType('sales-line');
    const normalizedIsbn = input.isbn?.trim() ? normalizeIsbn(input.isbn).isbn13 : undefined;
    for (const partition of this.catalog.iterateRecordsOfType('sales-partition')) {
      if (
        (input.sourceId !== undefined && partition.fields['source-id'] !== input.sourceId) ||
        (input.platformTargetId !== undefined &&
          partition.fields['platform-target-id'] !== input.platformTargetId) ||
        (input.country !== undefined && partition.fields.country !== input.country.toUpperCase()) ||
        (input.currency !== undefined &&
          partition.fields.currency !== input.currency.toUpperCase()) ||
        (input.startDate !== undefined &&
          String(partition.fields['end-date-max']) < input.startDate) ||
        (input.endDate !== undefined && String(partition.fields['start-date-min']) > input.endDate)
      )
        continue;
      if (normalizedIsbn !== undefined) {
        const isbn = this.catalog.recordById(String(partition.fields['isbn-id']));
        if (isbn?.fields.value !== normalizedIsbn) continue;
      }
      for (const row of decodePartitionRows(partition)) yield toPartitionLine(partition, row);
    }
  }

  /** Finds a logical row whether it is a legacy note or an immutable partition member. */
  private findLineById(lineId: string): CatalogRecord | undefined {
    const legacy = this.catalog.recordById(lineId);
    if (legacy?.type === 'sales-line') return legacy;
    for (const partition of this.catalog.iterateRecordsOfType('sales-partition'))
      for (const row of decodePartitionRows(partition))
        if (row.id === lineId) return toPartitionLine(partition, row);
    return undefined;
  }

  /**
   * Appends one immutable row through the repository's optimistic transaction boundary. A
   * partition is capped by both row count and encoded bytes; overflow creates the next shard.
   */
  private async appendPartitionedLine(
    fields: Readonly<Record<string, unknown>>,
    startDate: string,
    endDate: string
  ): Promise<CatalogRecord> {
    const createdAt = this.clock.now().toISOString();
    const row: PartitionedSalesRow = {
      id: `pm-sales-line-${safeId(this.ids.generate())}`,
      createdAt,
      fields
    };
    const encodedRow = JSON.stringify(row);
    if (encodedBytes(encodedRow) > MAX_PARTITION_BYTES)
      throw new Error('Sales row is too large for canonical partition storage.');
    const period = startDate.slice(0, 7);
    const partitionKey = [
      fields['source-id'],
      fields['isbn-id'],
      fields['platform-target-id'],
      fields.country,
      fields.currency,
      period
    ].join('|');
    const candidates = this.catalog
      .recordsOfType('sales-partition')
      .filter(({ fields: candidate }) => candidate['partition-key'] === partitionKey)
      .sort((left, right) => Number(right.fields.shard) - Number(left.fields.shard));
    const latest = candidates[0];
    const currentRows = typeof latest?.fields.rows === 'string' ? latest.fields.rows : '';
    const nextRows = currentRows ? `${currentRows}\n${encodedRow}` : encodedRow;
    const canAppend =
      latest !== undefined &&
      Number(latest.fields['line-count']) < MAX_PARTITION_ROWS &&
      encodedBytes(nextRows) <= MAX_PARTITION_BYTES;

    if (!canAppend) {
      const shard = latest === undefined ? 1 : Number(latest.fields.shard) + 1;
      const partition = await this.createRecord(
        'sales-partition',
        `${period}-${String(fields.country)}-${String(fields.currency)}-${shard}`,
        {
          'partition-key': partitionKey,
          'source-id': fields['source-id'],
          'isbn-id': fields['isbn-id'],
          'edition-id': fields['edition-id'],
          ...(fields['format-id'] === undefined ? {} : { 'format-id': fields['format-id'] }),
          'platform-target-id': fields['platform-target-id'],
          country: fields.country,
          currency: fields.currency,
          period,
          shard,
          'line-count': 1,
          'start-date-min': startDate,
          'end-date-max': endDate,
          units: Number(fields.units),
          returns: Number(fields.returns),
          ...(typeof fields['gross-revenue'] === 'string'
            ? { 'gross-revenue': fields['gross-revenue'] }
            : {}),
          ...(typeof fields['net-revenue'] === 'string'
            ? { 'net-revenue': fields['net-revenue'] }
            : {}),
          ...(typeof fields.proceeds === 'string' ? { proceeds: fields.proceeds } : {}),
          rows: encodedRow
        }
      );
      return toPartitionLine(partition, row);
    }

    const loaded = await this.repository.load(latest.path);
    const saved = await this.repository.save(
      loaded,
      {
        fields: {
          rows: nextRows,
          'line-count': Number(latest.fields['line-count']) + 1,
          'start-date-min':
            String(latest.fields['start-date-min']).localeCompare(startDate) <= 0
              ? latest.fields['start-date-min']
              : startDate,
          'end-date-max':
            String(latest.fields['end-date-max']).localeCompare(endDate) >= 0
              ? latest.fields['end-date-max']
              : endDate,
          units: Number(latest.fields.units) + Number(fields.units),
          returns: Number(latest.fields.returns) + Number(fields.returns),
          ...partitionMoneyPatch(latest.fields, fields)
        }
      },
      createdAt
    );
    this.catalog.accept(saved, 'modified');
    const partition = this.catalog.recordById(saved.envelope.pmId);
    if (partition === undefined) throw new Error('Updated sales partition left the catalog.');
    return toPartitionLine(partition, row);
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

  /** Groups sparse immutable corrections by partition so header fast paths stay exact. */
  private partitionCorrectionsById(): ReadonlyMap<string, readonly CatalogRecord[]> {
    const result = new Map<string, CatalogRecord[]>();
    for (const correction of this.catalog.iterateRecordsOfType('sales-correction')) {
      const partitionId = correction.fields['sales-partition-id'];
      if (typeof partitionId !== 'string') continue;
      result.set(partitionId, [...(result.get(partitionId) ?? []), correction]);
    }
    return result;
  }

  private async createRecord(
    type: 'sales-source' | 'sales-partition' | 'sales-line' | 'sales-correction',
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

/** Parses at most one bounded shard and rejects externally edited or prototype-shaped rows. */
function* decodePartitionRows(partition: CatalogRecord): IterableIterator<PartitionedSalesRow> {
  const source = partition.fields.rows;
  if (typeof source !== 'string' || encodedBytes(source) > MAX_PARTITION_BYTES)
    throw new Error(`Sales partition ${partition.id} has invalid row storage.`);
  let count = 0;
  let start = 0;
  while (start < source.length) {
    const end = source.indexOf('\n', start);
    const text = source.slice(start, end < 0 ? source.length : end);
    start = end < 0 ? source.length : end + 1;
    if (!text) continue;
    count += 1;
    if (count > MAX_PARTITION_ROWS)
      throw new Error(`Sales partition ${partition.id} exceeds its row limit.`);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`Sales partition ${partition.id} contains malformed JSONL.`);
    }
    if (!isRecord(value) || containsUnsafeKey(value))
      throw new Error(`Sales partition ${partition.id} contains an unsafe row.`);
    const id = value.id;
    const createdAt = value.createdAt;
    const fields = value.fields;
    if (
      typeof id !== 'string' ||
      !/^pm-sales-line-[a-z0-9-]{8,200}$/u.test(id) ||
      typeof createdAt !== 'string' ||
      !Number.isFinite(Date.parse(createdAt)) ||
      !isRecord(fields)
    )
      throw new Error(`Sales partition ${partition.id} contains an invalid row envelope.`);
    const diagnostics = validateRecordSchema({
      envelope: {
        pmId: id,
        pmType: 'sales-line',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt,
        updatedAt: createdAt
      },
      fields
    });
    if (diagnostics.length > 0)
      throw new Error(`Sales partition ${partition.id} contains an invalid sales row.`);
    yield { id, createdAt, fields };
  }
  if (count !== Number(partition.fields['line-count']))
    throw new Error(`Sales partition ${partition.id} line count does not match its rows.`);
}

/** Presents a partition member through the existing read-only sales-line view contract. */
function toPartitionLine(partition: CatalogRecord, row: PartitionedSalesRow): CatalogRecord {
  return {
    path: partition.path,
    id: row.id,
    type: 'sales-line',
    schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
    archived: partition.archived,
    sourceRevision: partition.sourceRevision,
    createdAt: row.createdAt,
    fields: row.fields
  };
}

/** UTF-8 rather than JavaScript code units is the persisted schema limit authority. */
function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Updates currency-safe header summaries without coercing decimal text through floating point. */
function partitionMoneyPatch(
  current: Readonly<Record<string, unknown>>,
  added: Readonly<Record<string, unknown>>
): Readonly<Record<string, string>> {
  const patch: Record<string, string> = {};
  for (const field of ['gross-revenue', 'net-revenue', 'proceeds'] as const) {
    const value = added[field];
    if (typeof value !== 'string') continue;
    patch[field] =
      typeof current[field] === 'string' ? sumDecimals([current[field], value]) : value;
  }
  return patch;
}

/** Applies sparse correction deltas to one header without expanding any of its logical rows. */
function adjustedPartitionSummary(
  header: Readonly<Record<string, unknown>>,
  corrections: readonly CatalogRecord[]
): Readonly<Record<string, unknown>> {
  const adjusted: Record<string, unknown> = {
    ...header,
    units:
      Number(header.units) +
      corrections.reduce(
        (sum, item) =>
          sum + Number((item.fields.adjustment as Readonly<Record<string, unknown>>).units ?? 0),
        0
      ),
    returns:
      Number(header.returns) +
      corrections.reduce(
        (sum, item) =>
          sum + Number((item.fields.adjustment as Readonly<Record<string, unknown>>).returns ?? 0),
        0
      )
  };
  for (const field of ['gross-revenue', 'net-revenue', 'proceeds'] as const) {
    const values = [
      ...(typeof header[field] === 'string' ? [header[field]] : []),
      ...corrections.flatMap((item) => {
        const value = (item.fields.adjustment as Readonly<Record<string, unknown>>)[field];
        return typeof value === 'string' ? [value] : [];
      })
    ];
    if (values.length > 0) adjusted[field] = sumDecimals(values);
  }
  return adjusted;
}

/** Returns one optional decimal aggregate patch while preserving the group's prior properties. */
function sumOptionalMoney(
  current: Readonly<Record<string, unknown>>,
  added: Readonly<Record<string, unknown>>,
  property: 'grossRevenue' | 'netRevenue' | 'proceeds',
  field: 'gross-revenue' | 'net-revenue' | 'proceeds'
): Readonly<Record<string, string>> {
  const value = added[field];
  if (typeof value !== 'string')
    return typeof current[property] === 'string' ? { [property]: current[property] } : {};
  return {
    [property]:
      typeof current[property] === 'string' ? sumDecimals([current[property], value]) : value
  };
}

/** Prevents hostile JSON keys from crossing the parsed-data boundary at any nesting level. */
function containsUnsafeKey(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some((item) => containsUnsafeKey(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      containsUnsafeKey(child, depth + 1)
  );
}
