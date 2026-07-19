/**
 * EXP-001–EXP-008 application coordinator. It gathers one book's canonical graph, removes or
 * reports sensitive fields, plans exactly one local text file, and writes those previewed bytes
 * only after every source revision and target collision has been checked again.
 */
import type { BookCatalog } from '../catalog/book-catalog';
import type { CalendarProjectService } from '../calendar/calendar-project-service';
import type { ReadinessProjectService } from '../readiness/readiness-project-service';
import type { SalesProjectService } from '../sales/sales-project-service';
import type { ManagedRecordInspectionPort, VaultTextPort } from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import { getRecordSchema } from '../../domain/records/schema-catalog';
import type { ManagedRecordType } from '../../domain/records/record-types';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import { joinVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import {
  PUBLISHING_CSV_DATASETS,
  PUBLISHING_EXPORT_GENERATOR_VERSION,
  PUBLISHING_EXPORT_SCHEMA_VERSION,
  serializeCsvTable,
  serializeJsonProject,
  serializeMarkdownDossier,
  serializePublishingIcs,
  type ExportMetadata,
  type PortableExportRecord,
  type PublishingCsvDataset,
  type PublishingExportFormat
} from '../../domain/exports/publishing-export';
import { sumDecimals } from '../../domain/sales/sales-ledger';

export interface PublishingExportRequest {
  readonly bookId: string;
  readonly format: PublishingExportFormat;
  readonly csvDataset?: PublishingCsvDataset;
  readonly includeSensitive: boolean;
}

export interface PublishingExportPreview {
  readonly request: PublishingExportRequest;
  readonly generatedAt: string;
  readonly target: VaultPath;
  readonly collisionDetected: boolean;
  readonly overwriteBehavior: 'never';
  readonly mediaType: string;
  readonly byteLength: number;
  readonly content: string;
  readonly warnings: readonly string[];
  readonly sensitiveFields: readonly string[];
  readonly unresolvedReferences: readonly string[];
  readonly linkedBinaryAssets: readonly string[];
  readonly sourceRevisions: Readonly<Record<string, string>>;
}

interface SanitizedGraph {
  readonly records: readonly PortableExportRecord[];
  readonly sensitiveFields: readonly string[];
}

const SENSITIVE_KEYS = new Set([
  'acquisition-note',
  'after-summary',
  'before-summary',
  'credential',
  'credentials',
  'notes',
  'password',
  'permission-notes',
  'private',
  'provenance',
  'quote',
  'reason',
  'secret',
  'source-values',
  'token'
]);

const CSV_COLUMNS: Readonly<Record<PublishingCsvDataset, readonly string[]>> = {
  tasks: [
    'id',
    'book-id',
    'workflow-id',
    'stage-id',
    'edition-id',
    'title',
    'status',
    'priority',
    'required',
    'deadline',
    'owner',
    'depends-on'
  ],
  isbns: [
    'id',
    'value',
    'isbn-10',
    'status',
    'edition-id',
    'format-id',
    'publisher',
    'imprint',
    'assigned-at',
    'published-at'
  ],
  prices: [
    'id',
    'edition-id',
    'platform',
    'territory',
    'currency',
    'amount',
    'tax-included',
    'tax-rate',
    'effective-from',
    'effective-to',
    'source',
    'supersedes-price-id'
  ],
  platforms: [
    'id',
    'edition-id',
    'profile-id',
    'platform',
    'territory',
    'publication-location',
    'intent',
    'review-state',
    'publication-state',
    'last-verified',
    'profile-version'
  ],
  editions: [
    'id',
    'book-id',
    'type',
    'custom-type',
    'medium',
    'revision',
    'status',
    'publication-date',
    'preorder-date'
  ],
  'canonical-sales-lines': [
    'id',
    'source-id',
    'isbn-id',
    'edition-id',
    'format-id',
    'platform-target-id',
    'country',
    'kind',
    'start-date',
    'end-date',
    'units',
    'returns',
    'net-units',
    'currency',
    'gross-revenue',
    'net-revenue',
    'tax',
    'fees',
    'discounts',
    'proceeds',
    'external-reference',
    'entry-key',
    'coverage-key',
    'status'
  ],
  'attributed-sales-aggregates': [
    'country',
    'currency',
    'platform',
    'publication-location',
    'lines',
    'units',
    'returns',
    'net-units',
    'gross-revenue',
    'net-revenue',
    'proceeds'
  ]
};

export class PublishingExportService {
  public readonly csvDatasets = PUBLISHING_CSV_DATASETS;
  public constructor(
    private readonly catalog: BookCatalog,
    private readonly inspection: ManagedRecordInspectionPort,
    private readonly readiness: ReadinessProjectService,
    private readonly sales: SalesProjectService,
    private readonly calendar: CalendarProjectService,
    private readonly vaultText: VaultTextPort,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock
  ) {}

  /**
   * Produces a complete byte-for-byte preview. The preview is deliberately immutable and contains
   * the exact target, collision decision, privacy report, unresolved links, and source revisions.
   */
  public async preview(request: PublishingExportRequest): Promise<PublishingExportPreview> {
    const book = this.catalog.recordById(request.bookId);
    if (book?.type !== 'book' || book.archived)
      throw new Error('Choose one active book to export.');
    if (
      request.format === 'csv' &&
      (request.csvDataset === undefined || !PUBLISHING_CSV_DATASETS.includes(request.csvDataset))
    )
      throw new Error('Choose one supported CSV table.');
    const generatedAt = this.clock.now().toISOString();
    const scoped = this.scopedGraph(book);
    const graph = sanitizeGraph(scoped, request.includeSensitive);
    const editionIds = new Set(this.catalog.editionsForBook(book.id).map(({ id }) => id));
    const diagnosticUnresolved = this.catalog
      .snapshot()
      .diagnostics.filter(({ code, entityId }) => {
        if (code !== 'catalog.unresolved-link' || entityId === undefined) return false;
        const record = this.catalog.recordById(entityId);
        return record !== undefined && belongsToBook(record, book.id, editionIds);
      })
      .map(
        ({ entityId, field, message }) =>
          `${entityId ?? 'unknown'}.${field ?? 'relationship'}: ${message}`
      );
    const unresolvedReferences = unique([...unresolved(graph.records), ...diagnosticUnresolved]);
    const linkedBinaryAssets = scoped
      .filter(({ type }) => type === 'asset-reference')
      .flatMap(({ fields }) => (typeof fields.path === 'string' ? [fields.path] : []))
      .sort();
    const diagnosticWarnings = this.catalog
      .snapshot()
      .diagnostics.filter(
        ({ entityId, path }) =>
          (entityId !== undefined && scoped.some(({ id }) => id === entityId)) || path === book.path
      )
      .map(({ code, message }) => `${code}: ${message}`);
    const warnings = unique([
      ...diagnosticWarnings,
      ...unresolvedReferences.map((item) => `Unresolved export relationship: ${item}`),
      ...(graph.sensitiveFields.length > 0
        ? [
            request.includeSensitive
              ? `${graph.sensitiveFields.length} sensitive field paths are included by explicit choice.`
              : `${graph.sensitiveFields.length} sensitive field paths were excluded.`
          ]
        : []),
      ...(linkedBinaryAssets.length > 0
        ? [
            `${linkedBinaryAssets.length} linked binary asset paths are references only; no binary bytes are embedded or copied.`
          ]
        : [])
    ]);
    const metadata = exportMetadata(book, generatedAt, warnings);
    const { extension, mediaType, content, label } = await this.serialize(
      request,
      book,
      graph.records,
      metadata
    );
    const folder = joinVaultPath(this.layout.rootPath(), 'Exports/Projects');
    const base = slug(`${String(book.fields.title)}-${label}-${generatedAt.slice(0, 10)}`);
    const planned = await this.availablePath(folder, base, extension);
    return {
      request: { ...request },
      generatedAt,
      target: planned.path,
      collisionDetected: planned.collisionDetected,
      overwriteBehavior: 'never',
      mediaType,
      byteLength: new TextEncoder().encode(content).byteLength,
      content,
      warnings,
      sensitiveFields: graph.sensitiveFields,
      unresolvedReferences,
      linkedBinaryAssets,
      sourceRevisions: Object.fromEntries(
        scoped.map(({ id, sourceRevision }) => [id, sourceRevision])
      )
    };
  }

  /**
   * Applies only the exact preview. All checks happen before the single create call, so a failure
   * can leave an empty folder but never a partial or misleading export file.
   */
  public async apply(preview: PublishingExportPreview): Promise<VaultPath> {
    const exportRoot = joinVaultPath(this.layout.rootPath(), 'Exports/Projects');
    if (!preview.target.startsWith(`${exportRoot}/`)) throw new Error('Export target is unsafe.');
    for (const [id, revision] of Object.entries(preview.sourceRevisions)) {
      const current = this.catalog.recordById(id);
      if (current?.sourceRevision !== revision)
        throw new Error('Canonical project data changed after preview. Preview the export again.');
      try {
        if ((await this.inspection.inspect(current.path)).sourceRevision !== revision)
          throw new Error(
            'Canonical project data changed after preview. Preview the export again.'
          );
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith('Canonical project data changed'))
          throw cause;
        throw new Error('A canonical project source is unavailable. Preview the export again.');
      }
    }
    if (await this.vaultText.exists(preview.target))
      throw new Error(
        'The previewed export target now exists. Preview again; exports never overwrite.'
      );
    await this.vaultText.ensureFolder(exportRoot);
    await this.vaultText.create(preview.target, preview.content);
    return preview.target;
  }

  private async serialize(
    request: PublishingExportRequest,
    book: CatalogRecord,
    records: readonly PortableExportRecord[],
    metadata: ExportMetadata
  ): Promise<{
    readonly extension: string;
    readonly mediaType: string;
    readonly content: string;
    readonly label: string;
  }> {
    if (request.format === 'markdown') {
      const evaluation = await this.readiness.evaluateBook(book.id);
      return {
        extension: 'md',
        mediaType: 'text/markdown',
        label: 'dossier',
        content: serializeMarkdownDossier({
          metadata,
          book: records.find(({ id }) => id === book.id)!,
          records: records.filter(({ id }) => id !== book.id),
          readiness: {
            state: evaluation.state,
            score: evaluation.score,
            confidence: evaluation.confidence,
            rulePackCode: evaluation.rulePackCode,
            rulePackVersion: evaluation.rulePackVersion,
            results: evaluation.results.map((result) => ({
              code: result.code,
              version: result.version,
              state: result.state,
              severity: result.severity,
              evidence: result.evidence.summary,
              ...(result.remedy === undefined ? {} : { remedy: result.remedy })
            }))
          }
        })
      };
    }
    if (request.format === 'json')
      return {
        extension: 'json',
        mediaType: 'application/json',
        label: 'project',
        content: serializeJsonProject({ metadata, records })
      };
    if (request.format === 'ics') {
      const events = this.calendar.events(new Set([book.id]));
      return {
        extension: 'ics',
        mediaType: 'text/calendar',
        label: 'schedule',
        content: serializePublishingIcs(
          metadata,
          events.map(({ id, date, title, kind, record }) => ({
            id,
            date,
            title,
            kind,
            recordId: record.id
          }))
        )
      };
    }
    const dataset = request.csvDataset!;
    return {
      extension: 'csv',
      mediaType: 'text/csv',
      label: dataset,
      content: serializeCsvTable({
        metadata,
        dataset,
        columns: CSV_COLUMNS[dataset],
        rows: this.csvRows(dataset, book.id, records)
      })
    };
  }

  /** Collects the book graph, then closes over schema-declared relationships such as profiles. */
  private scopedGraph(book: CatalogRecord): readonly CatalogRecord[] {
    const editionIds = new Set(this.catalog.editionsForBook(book.id).map(({ id }) => id));
    const records = allRecords(this.catalog);
    const salesLineIds = new Set(
      records
        .filter(
          (record) =>
            record.type === 'sales-line' && editionIds.has(String(record.fields['edition-id']))
        )
        .map(({ id }) => id)
    );
    const platformTargetIds = new Set(
      records
        .filter(
          (record) =>
            record.type === 'platform-target' && editionIds.has(String(record.fields['edition-id']))
        )
        .map(({ id }) => id)
    );
    const initial = records.filter((record) => {
      if (record.id === book.id) return true;
      if (record.type === 'series') return record.id === book.fields['series-id'];
      if (record.fields['book-id'] === book.id) return true;
      if (
        typeof record.fields['edition-id'] === 'string' &&
        editionIds.has(record.fields['edition-id'])
      )
        return true;
      if (record.type === 'isbn' && editionIds.has(String(record.fields['edition-id'])))
        return true;
      if (record.type === 'sales-line' && editionIds.has(String(record.fields['edition-id'])))
        return true;
      if (
        record.type === 'sales-correction' &&
        salesLineIds.has(String(record.fields['sales-line-id']))
      )
        return true;
      if (record.type === 'readiness-override')
        return (
          record.fields['scope-id'] === book.id ||
          editionIds.has(String(record.fields['scope-id'])) ||
          platformTargetIds.has(String(record.fields['scope-id']))
        );
      return false;
    });
    const selected = new Map(initial.map((record) => [record.id, record]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of [...selected.values()]) {
        for (const reference of relationshipIds(record)) {
          const related = this.catalog.recordById(reference);
          if (related !== undefined && !selected.has(related.id)) {
            selected.set(related.id, related);
            changed = true;
          }
        }
      }
    }
    return [...selected.values()].sort((a, b) =>
      `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)
    );
  }

  private csvRows(
    dataset: PublishingCsvDataset,
    bookId: string,
    records: readonly PortableExportRecord[]
  ): readonly Readonly<Record<string, unknown>>[] {
    if (dataset === 'attributed-sales-aggregates') return this.salesAggregateRows(bookId);
    const type: ManagedRecordType =
      dataset === 'tasks'
        ? 'task'
        : dataset === 'isbns'
          ? 'isbn'
          : dataset === 'prices'
            ? 'price'
            : dataset === 'platforms'
              ? 'platform-target'
              : dataset === 'editions'
                ? 'edition'
                : 'sales-line';
    return records
      .filter((record) => record.type === type)
      .map((record) => ({ id: record.id, ...record.fields }));
  }

  /** Sales aggregation retains attribution and currency boundaries rather than guessing exchange. */
  private salesAggregateRows(bookId: string): readonly Readonly<Record<string, unknown>>[] {
    const groups = new Map<string, CatalogRecord[]>();
    for (const line of this.sales.lines(bookId)) {
      const target = this.catalog.recordById(String(line.fields['platform-target-id']));
      const key = [
        line.fields.country,
        line.fields.currency,
        target?.fields.platform ?? 'Unresolved',
        target?.fields['publication-location'] ?? 'Unresolved'
      ].join('|');
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, lines]) => {
        const [country, currency, platform, publicationLocation] = key.split('|');
        const corrections = lines.flatMap((line) => this.sales.corrections(line.id));
        const adjustedNumber = (field: string) =>
          lines.reduce((sum, line) => sum + Number(line.fields[field] ?? 0), 0) +
          corrections.reduce(
            (sum, correction) => sum + Number(object(correction.fields.adjustment)[field] ?? 0),
            0
          );
        const adjustedMoney = (field: string): string | undefined => {
          const values = [
            ...lines.flatMap((line) =>
              typeof line.fields[field] === 'string' ? [line.fields[field]] : []
            ),
            ...corrections.flatMap((correction) => {
              const value = object(correction.fields.adjustment)[field];
              return typeof value === 'string' ? [value] : [];
            })
          ];
          return values.length === 0 ? undefined : sumDecimals(values);
        };
        const units = adjustedNumber('units');
        const returns = adjustedNumber('returns');
        return {
          country,
          currency,
          platform,
          'publication-location': publicationLocation,
          lines: lines.length,
          units,
          returns,
          'net-units': units - returns,
          'gross-revenue': adjustedMoney('gross-revenue'),
          'net-revenue': adjustedMoney('net-revenue'),
          proceeds: adjustedMoney('proceeds')
        };
      });
  }

  private async availablePath(
    folder: VaultPath,
    base: string,
    extension: string
  ): Promise<{ readonly path: VaultPath; readonly collisionDetected: boolean }> {
    let suffix = 1;
    let path = joinVaultPath(folder, `${base}.${extension}`);
    const collisionDetected = await this.vaultText.exists(path);
    while (await this.vaultText.exists(path)) {
      suffix += 1;
      path = joinVaultPath(folder, `${base}-${suffix}.${extension}`);
    }
    return { path, collisionDetected };
  }
}

function exportMetadata(
  book: CatalogRecord,
  generatedAt: string,
  warnings: readonly string[]
): ExportMetadata {
  return {
    generatorVersion: PUBLISHING_EXPORT_GENERATOR_VERSION,
    schemaVersion: PUBLISHING_EXPORT_SCHEMA_VERSION,
    generatedAt,
    scope: { type: 'book', id: book.id, label: String(book.fields.title) },
    warnings
  };
}

function allRecords(catalog: BookCatalog): readonly CatalogRecord[] {
  const types: readonly ManagedRecordType[] = [
    'series',
    'book',
    'edition',
    'format',
    'platform-target',
    'platform-profile',
    'readiness-override',
    'metadata-set',
    'isbn',
    'price',
    'workflow',
    'task',
    'launch',
    'review',
    'asset-reference',
    'history-event',
    'sales-source',
    'sales-line',
    'sales-correction'
  ];
  return types.flatMap((type) => catalog.recordsOfType(type));
}

function relationshipIds(record: CatalogRecord | PortableExportRecord): readonly string[] {
  return Object.entries(getRecordSchema(record.type as ManagedRecordType).fields).flatMap(
    ([field, definition]) => {
      if (definition.relationship === undefined) return [];
      const value = record.fields[field];
      if (typeof value === 'string') return [value];
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    }
  );
}

function sanitizeGraph(
  records: readonly CatalogRecord[],
  includeSensitive: boolean
): SanitizedGraph {
  const sensitiveFields: string[] = [];
  const portable = records.map((record) => ({
    id: record.id,
    type: record.type,
    schemaVersion: record.schemaVersion,
    fields: sanitizeValue(
      record.fields,
      `${record.type}:${record.id}`,
      sensitiveFields,
      includeSensitive
    ) as Readonly<Record<string, unknown>>
  }));
  return { records: portable, sensitiveFields: [...new Set(sensitiveFields)].sort() };
}

function sanitizeValue(
  value: unknown,
  path: string,
  found: string[],
  includeSensitive: boolean
): unknown {
  if (Array.isArray(value))
    return value.map((item, index) =>
      sanitizeValue(item, `${path}[${index}]`, found, includeSensitive)
    );
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    const nextPath = `${path}.${key}`;
    if (isSensitiveKey(key)) {
      found.push(nextPath);
      if (includeSensitive) result[key] = sanitizeValue(item, nextPath, found, true);
    } else result[key] = sanitizeValue(item, nextPath, found, includeSensitive);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.has(normalized) || /(?:credential|password|secret|token)/u.test(normalized);
}

function unresolved(records: readonly PortableExportRecord[]): readonly string[] {
  const identities = new Set(records.map(({ id }) => id));
  return unique(
    records.flatMap((record) =>
      relationshipIds(record)
        .filter((id) => !identities.has(id))
        .map((id) => `${record.type}:${record.id} → ${id}`)
    )
  );
}

/** Determines whether a diagnostic record belongs to the requested book without guessing labels. */
function belongsToBook(
  record: CatalogRecord,
  bookId: string,
  editionIds: ReadonlySet<string>
): boolean {
  return (
    record.id === bookId ||
    record.fields['book-id'] === bookId ||
    editionIds.has(String(record.fields['edition-id']))
  );
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 100) || 'publishing-export'
  );
}
