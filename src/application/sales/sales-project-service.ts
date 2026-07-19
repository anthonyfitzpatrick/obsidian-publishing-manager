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
    const all = this.catalog
      .recordsOfType('sales-line')
      .filter((line) => line.fields.status === 'accepted');
    if (bookId === undefined) return all;
    const editionIds = new Set(this.catalog.editionsForBook(bookId).map(({ id }) => id));
    return all.filter((line) => editionIds.has(String(line.fields['edition-id'])));
  }
  /** Resolves every filter through canonical relationships; no label is guessed. */
  public query(input: SalesQuery): readonly CatalogRecord[] {
    const normalizedIsbn = input.isbn?.trim() ? normalizeIsbn(input.isbn).isbn13 : undefined;
    return this.lines(input.bookId).filter((line) => {
      const edition = this.catalog.recordById(String(line.fields['edition-id']));
      const book =
        edition === undefined
          ? undefined
          : this.catalog.recordById(String(edition.fields['book-id']));
      const isbn = this.catalog.recordById(String(line.fields['isbn-id']));
      const target = this.catalog.recordById(String(line.fields['platform-target-id']));
      return (
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
      );
    });
  }
  /** Produces disposable, inspectable counts; the returned lines are the drill-down evidence. */
  public analytics(input: SalesQuery = {}): SalesAnalytics {
    const lines = this.query(input);
    const adjusted = (line: CatalogRecord, field: 'units' | 'returns'): number =>
      Number(line.fields[field] ?? 0) +
      this.corrections(line.id).reduce(
        (sum, item) =>
          sum + Number((item.fields.adjustment as Record<string, unknown>)[field] ?? 0),
        0
      );
    const by = (label: (line: CatalogRecord) => string) => {
      const values = new Map<string, number>();
      for (const line of lines) {
        const key = label(line);
        values.set(
          key,
          (values.get(key) ?? 0) + adjusted(line, 'units') - adjusted(line, 'returns')
        );
      }
      return [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    return {
      lines,
      units: lines.reduce((sum, line) => sum + adjusted(line, 'units'), 0),
      returns: lines.reduce((sum, line) => sum + adjusted(line, 'returns'), 0),
      trend: by((line) => String(line.fields['start-date']).slice(0, 7)),
      books: by((line) => {
        const edition = this.catalog.recordById(String(line.fields['edition-id']));
        const book =
          edition === undefined
            ? undefined
            : this.catalog.recordById(String(edition.fields['book-id']));
        return typeof book?.fields.title === 'string'
          ? book.fields.title
          : (book?.id ?? 'Unresolved book');
      }),
      locations: by((line) => {
        const target = this.catalog.recordById(String(line.fields['platform-target-id']));
        const platform =
          typeof target?.fields.platform === 'string' ? target.fields.platform : 'Unknown';
        const location =
          typeof target?.fields['publication-location'] === 'string'
            ? target.fields['publication-location']
            : 'Unknown';
        return `${platform} · ${location}`;
      }),
      countries: by((line) => String(line.fields.country))
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
  public aggregates(query: string | SalesQuery = {}): readonly SalesAggregateGroup[] {
    const groups = new Map<string, CatalogRecord[]>();
    for (const line of typeof query === 'string' ? this.lines(query) : this.query(query))
      groups.set(String(line.fields.currency), [
        ...(groups.get(String(line.fields.currency)) ?? []),
        line
      ]);
    return [...groups.entries()]
      .map(([currency, lines]) => {
        const corrections = lines.flatMap((line) => this.corrections(line.id));
        const adjustedNumber = (field: string) =>
          lines.reduce((sum, line) => sum + Number(line.fields[field] ?? 0), 0) +
          corrections.reduce(
            (sum, item) =>
              sum + Number((item.fields.adjustment as Record<string, unknown>)[field] ?? 0),
            0
          );
        const adjustedMoney = (field: string): string | undefined => {
          const values = [
            ...lines.flatMap((line) =>
              typeof line.fields[field] === 'string' ? [line.fields[field]] : []
            ),
            ...corrections.flatMap((item) => {
              const value = (item.fields.adjustment as Record<string, unknown>)[field];
              return typeof value === 'string' ? [value] : [];
            })
          ];
          return values.length ? sumDecimals(values) : undefined;
        };
        const units = adjustedNumber('units');
        const returns = adjustedNumber('returns');
        const grossRevenue = adjustedMoney('gross-revenue');
        const netRevenue = adjustedMoney('net-revenue');
        const proceeds = adjustedMoney('proceeds');
        return {
          currency,
          units,
          returns,
          netUnits: units - returns,
          ...(grossRevenue === undefined ? {} : { grossRevenue }),
          ...(netRevenue === undefined ? {} : { netRevenue }),
          ...(proceeds === undefined ? {} : { proceeds }),
          lines
        };
      })
      .sort((a, b) => a.currency.localeCompare(b.currency));
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
