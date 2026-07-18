/**
 * Maintains the disposable M1 catalog from canonical Markdown records. Every update is reconciled
 * from repository text rather than trusted event payloads. Invalid and future records remain
 * visible as repair-oriented diagnostics, while duplicate identities and unresolved relationships
 * are recomputed deterministically after each incremental create, modify, rename, or delete.
 */

import type { Clock } from '../../domain/foundation/clock';
import { validateBookProject } from '../../domain/books/book-project';
import {
  type BookCatalogSnapshot,
  type CatalogActivity,
  type CatalogActivityAction,
  type CatalogAvailability,
  type CatalogDiagnostic,
  type CatalogRecord,
  type NextMilestoneSummary
} from '../../domain/catalog/catalog-model';
import { validateRecordSchema } from '../../domain/records/schema-validation';
import type { VaultPath } from '../../domain/storage/vault-path';
import type {
  LoadedManagedRecord,
  ManagedRecordInspectionPort
} from '../storage/record-storage-ports';

/** Callback used by views without exposing mutable catalog collections. */
export type BookCatalogSubscriber = (snapshot: BookCatalogSnapshot) => void;

/** Stateful projection with bounded local activity and immutable public snapshots. */
export class BookCatalog {
  private readonly recordsByPath = new Map<VaultPath, CatalogRecord>();
  private readonly directDiagnosticsByPath = new Map<VaultPath, readonly CatalogDiagnostic[]>();
  private readonly recentActivity: CatalogActivity[] = [];
  private readonly subscribers = new Set<BookCatalogSubscriber>();
  private availability: CatalogAvailability = { state: 'loading' };

  /** Binds inspection to a deterministic clock; neither dependency grants write capability. */
  public constructor(
    private readonly inspection: ManagedRecordInspectionPort,
    private readonly clock: Clock
  ) {}

  /** Rebuilds the disposable projection without manufacturing user activity on plugin reload. */
  public async initialize(paths: readonly VaultPath[]): Promise<void> {
    this.availability = {
      state: 'rebuilding',
      message: 'Rebuilding the local catalog from managed Markdown records.'
    };
    this.publish();
    this.recordsByPath.clear();
    this.directDiagnosticsByPath.clear();
    for (const path of [...paths].sort()) {
      await this.inspectPath(path);
    }
    this.availability = { state: 'ready' };
    this.publish();
  }

  /** Marks catalog access unavailable while retaining any last safe partial projection. */
  public markUnavailable(message: string): void {
    this.availability = { state: 'unavailable', message };
    this.publish();
  }

  /** Marks an unexpected catalog failure separately from expected record diagnostics. */
  public markError(message: string): void {
    this.availability = { state: 'error', message };
    this.publish();
  }

  /** Reconciles one created or modified path and records activity only when its source changed. */
  public async reconcile(
    path: VaultPath,
    action: Extract<CatalogActivityAction, 'created' | 'modified'>
  ): Promise<void> {
    const previous = this.recordsByPath.get(path);
    const next = await this.inspectPath(path);
    if (next !== undefined && previous?.sourceRevision !== next.sourceRevision) {
      this.recordActivity(action, next);
    }
    this.publish();
  }

  /** Accepts a repository result immediately; the matching vault event becomes a no-op later. */
  public accept(
    loaded: LoadedManagedRecord,
    action: Extract<CatalogActivityAction, 'archived' | 'created' | 'modified' | 'restored'>
  ): void {
    const previous = this.recordsByPath.get(loaded.path);
    const record = toCatalogRecord(loaded);
    this.recordsByPath.set(loaded.path, record);
    this.directDiagnosticsByPath.set(loaded.path, inspectRecord(record));
    if (previous?.sourceRevision !== record.sourceRevision) {
      this.recordActivity(action, record);
    }
    this.publish();
  }

  /** Reconciles a rename by removing the stale path and inspecting the authoritative new path. */
  public async rename(previousPath: VaultPath, nextPath: VaultPath): Promise<void> {
    const previous = this.recordsByPath.get(previousPath);
    this.recordsByPath.delete(previousPath);
    this.directDiagnosticsByPath.delete(previousPath);
    const next = await this.inspectPath(nextPath);
    if (next !== undefined) {
      this.recordActivity('renamed', next, previousPath);
    } else if (previous !== undefined) {
      this.recordActivity('renamed', { ...previous, path: nextPath }, previousPath);
    }
    this.publish();
  }

  /** Removes a deleted path while retaining a bounded human-readable activity receipt. */
  public remove(path: VaultPath): void {
    const previous = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    this.directDiagnosticsByPath.delete(path);
    if (previous !== undefined) {
      this.recordActivity('deleted', previous);
    }
    this.publish();
  }

  /** Returns every known path, including invalid notes, so create collision checks stay safe. */
  public knownPaths(): ReadonlySet<string> {
    return new Set([...this.recordsByPath.keys(), ...this.directDiagnosticsByPath.keys()]);
  }

  /** Resolves one valid projected record by stable identity, rejecting ambiguous duplicates. */
  public recordById(id: string): CatalogRecord | undefined {
    const matches = [...this.recordsByPath.values()].filter((record) => record.id === id);
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Reports whether a proposed explicit series position is already occupied by another book. */
  public isSeriesPositionOccupied(
    seriesId: string,
    position: number,
    exceptBookId?: string
  ): boolean {
    return [...this.recordsByPath.values()].some(
      (record) =>
        record.type === 'book' &&
        record.id !== exceptBookId &&
        record.fields['series-id'] === seriesId &&
        record.fields['series-position'] === position
    );
  }

  /** Returns valid books in deterministic series position/title/identity order. */
  public orderedBooks(seriesId?: string): readonly CatalogRecord[] {
    return this.snapshot()
      .books.filter((record) => seriesId === undefined || record.fields['series-id'] === seriesId)
      .sort(compareBooks);
  }

  /** Produces an immutable view that can be regenerated from the vault at any time. */
  public snapshot(): BookCatalogSnapshot {
    const diagnostics = this.collectDiagnostics();
    const books = [...this.recordsByPath.values()]
      .filter((record) => record.type === 'book' && !hasPathError(record.path, diagnostics))
      .sort(compareBooks);
    return {
      availability: this.availability,
      books,
      diagnostics,
      recentActivity: [...this.recentActivity],
      nextMilestone: nextMilestoneFor(books, diagnostics)
    };
  }

  /** Subscribes to minimal state replacement and returns an explicit unsubscriber. */
  public subscribe(subscriber: BookCatalogSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot());
    return () => this.subscribers.delete(subscriber);
  }

  /** Inspects one path and converts all recoverable failures to diagnostics. */
  private async inspectPath(path: VaultPath): Promise<CatalogRecord | undefined> {
    try {
      const loaded = await this.inspection.inspect(path);
      const record = toCatalogRecord(loaded);
      this.recordsByPath.set(path, record);
      this.directDiagnosticsByPath.set(path, inspectRecord(record));
      return record;
    } catch (error) {
      this.recordsByPath.delete(path);
      this.directDiagnosticsByPath.set(path, [diagnoseInspectionFailure(path, error)]);
      return undefined;
    }
  }

  /** Combines direct parse/schema failures with cross-record identity and link diagnostics. */
  private collectDiagnostics(): readonly CatalogDiagnostic[] {
    const diagnostics = [...this.directDiagnosticsByPath.values()].flat();
    const records = [...this.recordsByPath.values()];
    const byId = new Map<string, CatalogRecord[]>();
    for (const record of records) {
      byId.set(record.id, [...(byId.get(record.id) ?? []), record]);
    }

    for (const [id, matches] of byId) {
      if (matches.length > 1) {
        for (const record of matches) {
          diagnostics.push({
            code: 'catalog.duplicate-id',
            severity: 'error',
            path: record.path,
            entityId: id,
            field: 'pm-id',
            message: `Stable identity ${id} is used by ${matches.length} records.`,
            suggestedAction: 'Open each listed note and use guided identity repair before editing.'
          });
        }
      }
    }

    for (const record of records.filter((candidate) => candidate.type === 'book')) {
      const seriesId = record.fields['series-id'];
      if (typeof seriesId === 'string') {
        const series = byId.get(seriesId) ?? [];
        if (series.length !== 1 || series[0]?.type !== 'series') {
          diagnostics.push({
            code: 'catalog.unresolved-link',
            severity: 'error',
            path: record.path,
            entityId: record.id,
            field: 'series-id',
            message: `Series reference ${seriesId} does not resolve to one series record.`,
            suggestedAction: 'Create or repair the referenced series, then reload this book.'
          });
        }
      }

      const position = record.fields['series-position'];
      if (typeof seriesId === 'string' && typeof position === 'number') {
        const conflicts = records.filter(
          (candidate) =>
            candidate.type === 'book' &&
            candidate.fields['series-id'] === seriesId &&
            candidate.fields['series-position'] === position
        );
        if (conflicts.length > 1) {
          diagnostics.push({
            code: 'catalog.series-position-conflict',
            severity: 'error',
            path: record.path,
            entityId: record.id,
            field: 'series-position',
            message: `Series position ${position} is assigned to ${conflicts.length} books.`,
            suggestedAction: 'Assign each book a unique positive position within the series.'
          });
        }
      }
    }

    return diagnostics.sort((left, right) =>
      `${left.path}:${left.code}:${left.field ?? ''}`.localeCompare(
        `${right.path}:${right.code}:${right.field ?? ''}`
      )
    );
  }

  /** Stores newest activity first and bounds memory without persisting private note content. */
  private recordActivity(
    action: CatalogActivityAction,
    record: CatalogRecord,
    previousPath?: VaultPath
  ): void {
    const title = record.type === 'book' ? record.fields.title : record.fields.name;
    this.recentActivity.unshift({
      action,
      occurredAt: this.clock.now().toISOString(),
      path: record.path,
      entityId: record.id,
      ...(typeof title === 'string' ? { title } : {}),
      ...(previousPath === undefined ? {} : { previousPath })
    });
    this.recentActivity.splice(50);
  }

  /** Publishes fresh immutable snapshots after the complete reconciliation is consistent. */
  private publish(): void {
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

/** Reduces a repository snapshot to the fields required for lightweight catalog queries. */
function toCatalogRecord(loaded: LoadedManagedRecord): CatalogRecord {
  return {
    path: loaded.path,
    id: loaded.envelope.pmId,
    type: loaded.envelope.pmType,
    schemaVersion: loaded.envelope.pmSchema,
    archived: loaded.envelope.archivedAt !== undefined,
    sourceRevision: loaded.sourceRevision,
    fields: loaded.fields
  };
}

/** Produces direct schema/domain diagnostics while retaining valid envelope identity. */
function inspectRecord(record: CatalogRecord): readonly CatalogDiagnostic[] {
  const schemaDiagnostics = validateRecordSchema({
    envelope: {
      pmId: record.id,
      pmType: record.type,
      pmSchema: record.schemaVersion,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      ...(record.archived ? { archivedAt: '2000-01-01T00:00:00.000Z' } : {})
    },
    fields: record.fields
  });
  const diagnostics: CatalogDiagnostic[] = schemaDiagnostics.map((diagnostic) => ({
    code:
      diagnostic.code === 'schema.future-version'
        ? 'catalog.unsupported-future-schema'
        : 'catalog.malformed-schema',
    severity: 'error',
    path: record.path,
    entityId: record.id,
    field: diagnostic.field,
    message: diagnostic.message,
    suggestedAction:
      diagnostic.code === 'schema.future-version'
        ? 'Open this vault with a compatible Publishing Manager version; do not downgrade the note.'
        : 'Open the note and repair the named field; Publishing Manager will revalidate it automatically.'
  }));

  if (record.type === 'book' && schemaDiagnostics.length === 0) {
    diagnostics.push(
      ...validateBookProject(record.fields).map((diagnostic) => ({
        code: 'catalog.invalid-book' as const,
        severity: 'error' as const,
        path: record.path,
        entityId: record.id,
        field: String(diagnostic.field),
        message: diagnostic.message,
        suggestedAction: 'Open this book and correct the highlighted identity or summary field.'
      }))
    );
  }
  return diagnostics;
}

/** Converts parse/envelope exceptions without including YAML or note-body content. */
function diagnoseInspectionFailure(path: VaultPath, error: unknown): CatalogDiagnostic {
  const message = error instanceof Error ? error.message : 'The managed note could not be read.';
  const malformedFrontmatter =
    error instanceof Error &&
    (error.name === 'InvalidFrontmatterDocumentError' ||
      /frontmatter|YAML|test frontmatter/iu.test(message));
  return {
    code: malformedFrontmatter ? 'catalog.malformed-frontmatter' : 'catalog.malformed-envelope',
    severity: 'error',
    path,
    message,
    suggestedAction: malformedFrontmatter
      ? 'Repair the opening YAML frontmatter block, then save the note to trigger revalidation.'
      : 'Repair the pm-id, pm-type, pm-schema, and timestamp envelope fields shown by the diagnostic.'
  };
}

/** Keeps books in stable explicit-series order with identity as the final tie-breaker. */
function compareBooks(left: CatalogRecord, right: CatalogRecord): number {
  const leftSeries = typeof left.fields['series-id'] === 'string' ? left.fields['series-id'] : '';
  const rightSeries =
    typeof right.fields['series-id'] === 'string' ? right.fields['series-id'] : '';
  const seriesOrder = leftSeries.localeCompare(rightSeries);
  if (seriesOrder !== 0) return seriesOrder;
  const leftPosition =
    typeof left.fields['series-position'] === 'number'
      ? left.fields['series-position']
      : Number.MAX_SAFE_INTEGER;
  const rightPosition =
    typeof right.fields['series-position'] === 'number'
      ? right.fields['series-position']
      : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  const leftTitle = typeof left.fields.title === 'string' ? left.fields.title : '';
  const rightTitle = typeof right.fields.title === 'string' ? right.fields.title : '';
  const titleOrder = leftTitle.localeCompare(rightTitle);
  return titleOrder === 0 ? left.id.localeCompare(right.id) : titleOrder;
}

/** Excludes records with any direct or relational error from normal book queries. */
function hasPathError(path: VaultPath, diagnostics: readonly CatalogDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.path === path && diagnostic.severity === 'error'
  );
}

/** Chooses the next useful publishing action from the current catalog evidence. */
function nextMilestoneFor(
  books: readonly CatalogRecord[],
  diagnostics: readonly CatalogDiagnostic[]
): NextMilestoneSummary {
  if (diagnostics.some(({ severity }) => severity === 'error')) {
    return {
      code: 'repair-catalog',
      title: 'Repair catalog diagnostics',
      explanation:
        'Resolve malformed, duplicate, or unresolved records before adding dependent publishing data.'
    };
  }
  if (!books.some((book) => !book.archived)) {
    return {
      code: 'create-first-book',
      title: 'Create the first active book',
      explanation:
        'A stable book project is the anchor for editions, workflow, identifiers, and launch work.'
    };
  }
  return {
    code: 'add-first-edition',
    title: 'Define the first edition',
    explanation: 'The active book is ready for its first marketable edition in M2.'
  };
}
