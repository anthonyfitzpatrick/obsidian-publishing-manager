/** HIS-001–HIS-003 canonical append-only capture, filtering, and recoverable failure queue. */
import type { BookCatalog } from '../catalog/book-catalog';
import type {
  LoadedManagedRecord,
  ManagedRecordRepositoryPort
} from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import {
  describeHistoryMutation,
  validateHistoryEvent,
  type HistoryAction,
  type HistoryEventDraft
} from '../../domain/history/history-event';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { HistoryPreferencesService } from './history-preferences-service';

export interface HistoryFilters {
  readonly action?: string;
  readonly entityType?: string;
  readonly actor?: string;
  readonly search?: string;
  readonly from?: string;
  readonly to?: string;
}

interface PendingCapture {
  readonly action: HistoryAction;
  readonly before?: LoadedManagedRecord;
  readonly after: LoadedManagedRecord;
}

export class HistoryProjectService {
  private readonly pending: PendingCapture[] = [];
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly preferences: HistoryPreferencesService
  ) {}

  /** Records committed changes; capture failure never invites the caller to repeat the real write. */
  public async capture(
    action: HistoryAction,
    before: LoadedManagedRecord | undefined,
    after: LoadedManagedRecord
  ): Promise<void> {
    if (after.envelope.pmType === 'history-event') return;
    const mutation: PendingCapture = { action, ...(before === undefined ? {} : { before }), after };
    try {
      await this.append(mutation);
    } catch {
      this.pending.push(mutation);
    }
  }

  public failedCaptureCount(): number {
    return this.pending.length;
  }

  /** Retries only missing history evidence; the completed source mutation is never repeated. */
  public async retryFailedCaptures(): Promise<void> {
    const queued = this.pending.splice(0);
    for (const mutation of queued) {
      try {
        await this.append(mutation);
      } catch {
        this.pending.push(mutation);
      }
    }
  }

  public eventsForBook(bookId: string, filters: HistoryFilters = {}): readonly CatalogRecord[] {
    const retentionDays = this.preferences.current().retentionDays;
    const earliest =
      retentionDays === 0
        ? undefined
        : new Date(this.clock.now().getTime() - retentionDays * 86_400_000).toISOString();
    const search = filters.search?.trim().toLowerCase();
    const actor = filters.actor?.trim().toLowerCase();
    return this.catalog
      .recordsOfType('history-event')
      .filter((record) => {
        const timestamp = text(record.fields.timestamp);
        return (
          record.fields['book-id'] === bookId &&
          !record.archived &&
          (earliest === undefined || timestamp >= earliest) &&
          (filters.action === undefined || record.fields.action === filters.action) &&
          (filters.entityType === undefined ||
            record.fields['entity-type'] === filters.entityType) &&
          (actor === undefined ||
            text(record.fields['actor-label']).toLowerCase().includes(actor)) &&
          (search === undefined || searchable(record).includes(search)) &&
          (filters.from === undefined || timestamp.slice(0, 10) >= filters.from) &&
          (filters.to === undefined || timestamp.slice(0, 10) <= filters.to)
        );
      })
      .sort(
        (left, right) =>
          text(right.fields.timestamp).localeCompare(text(left.fields.timestamp)) ||
          left.id.localeCompare(right.id)
      );
  }

  private async append(mutation: PendingCapture): Promise<void> {
    const bookId = this.resolveBookId(mutation.after);
    if (bookId === undefined) return;
    const timestamp = this.clock.now().toISOString();
    const draft = describeHistoryMutation(
      mutation.action,
      this.preferences.current().actorLabel,
      timestamp,
      mutation.before,
      mutation.after,
      bookId
    );
    await this.store(draft);
  }

  private async store(event: HistoryEventDraft): Promise<void> {
    validateHistoryEvent(event);
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(
        'history-event',
        `${event.timestamp} ${event.action} ${event.entityLabel}`,
        this.catalog.knownPaths()
      ),
      {
        envelope: {
          pmId: `pm-history-${safeId(this.ids.generate())}`,
          pmType: 'history-event',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: event.timestamp,
          updatedAt: event.timestamp
        },
        fields: {
          ...(event.bookId === undefined ? {} : { 'book-id': event.bookId }),
          'entity-id': event.entityId,
          'entity-type': event.entityType,
          'entity-label': event.entityLabel,
          'actor-label': event.actorLabel,
          action: event.action,
          timestamp: event.timestamp,
          summary: event.summary,
          ...(event.beforeSummary === undefined ? {} : { 'before-summary': event.beforeSummary }),
          ...(event.afterSummary === undefined ? {} : { 'after-summary': event.afterSummary }),
          'changed-fields': event.changedFields
        },
        body: '# History event\n\nAppend-only operational evidence. Do not place private content in this note.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
  }

  private resolveBookId(record: LoadedManagedRecord): string | undefined {
    if (record.envelope.pmType === 'book') return record.envelope.pmId;
    const direct = record.fields['book-id'];
    if (typeof direct === 'string') return direct;
    const editionId = record.fields['edition-id'];
    if (typeof editionId === 'string') {
      const edition = this.catalog.recordById(editionId);
      return typeof edition?.fields['book-id'] === 'string' ? edition.fields['book-id'] : undefined;
    }
    const salesLineId = record.fields['sales-line-id'];
    if (typeof salesLineId === 'string') {
      const line = this.catalog.recordById(salesLineId);
      const lineEdition = line?.fields['edition-id'];
      const edition =
        typeof lineEdition === 'string' ? this.catalog.recordById(lineEdition) : undefined;
      return typeof edition?.fields['book-id'] === 'string' ? edition.fields['book-id'] : undefined;
    }
    if (record.envelope.pmType === 'readiness-override') {
      const scopeKind = record.fields['scope-kind'];
      const scopeId = record.fields['scope-id'];
      if (scopeKind === 'book' && typeof scopeId === 'string') return scopeId;
      if (scopeKind === 'edition' && typeof scopeId === 'string') {
        const edition = this.catalog.recordById(scopeId);
        return typeof edition?.fields['book-id'] === 'string'
          ? edition.fields['book-id']
          : undefined;
      }
    }
    return undefined;
  }
}

function searchable(record: CatalogRecord): string {
  return ['summary', 'entity-label', 'entity-type', 'actor-label', 'action', 'changed-fields']
    .map((field) => JSON.stringify(record.fields[field] ?? ''))
    .join(' ')
    .toLowerCase();
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
