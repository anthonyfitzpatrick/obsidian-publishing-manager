/** Pure HIS-001/HIS-002 rules for readable, bounded, append-only operational evidence. */
import type { ManagedRecordEnvelope } from '../records/record-envelope';

export interface HistoryRecordSnapshot {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type HistoryAction = 'created' | 'updated' | 'archived' | 'restored';

export interface HistoryEventDraft {
  readonly bookId?: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly entityLabel: string;
  readonly actorLabel: string;
  readonly action: HistoryAction;
  readonly timestamp: string;
  readonly summary: string;
  readonly beforeSummary?: string;
  readonly afterSummary?: string;
  readonly changedFields: readonly string[];
}

const PRIVATE_FIELDS = new Set([
  'notes',
  'quote',
  'permission-notes',
  'provenance',
  'source-values',
  'summary',
  'body'
]);
const VALUE_FIELDS = new Set([
  'title',
  'name',
  'label',
  'status',
  'type',
  'medium',
  'date',
  'publication-date',
  'deadline',
  'platform',
  'territory',
  'country',
  'currency',
  'amount',
  'rating',
  'source',
  'follow-up-status',
  'publication-state'
]);

/** Describes one repository mutation without copying bodies, quotes, notes, or structured payloads. */
export function describeHistoryMutation(
  action: HistoryAction,
  actorLabel: string,
  timestamp: string,
  before: HistoryRecordSnapshot | undefined,
  after: HistoryRecordSnapshot,
  bookId?: string
): HistoryEventDraft {
  const changedFields = changed(before?.fields, after.fields);
  const entityLabel = labelFor(after);
  const verb = action === 'updated' ? 'Updated' : capitalize(action);
  const fieldSuffix = changedFields.length > 0 ? `: ${changedFields.join(', ')}` : '';
  return {
    ...(bookId === undefined ? {} : { bookId }),
    entityId: after.envelope.pmId,
    entityType: after.envelope.pmType,
    entityLabel,
    actorLabel: bounded(actorLabel.trim() || 'Local user', 80),
    action,
    timestamp,
    summary: bounded(`${verb} ${after.envelope.pmType} “${entityLabel}”${fieldSuffix}`, 300),
    ...(before === undefined ? {} : { beforeSummary: snapshot(before.fields, changedFields) }),
    afterSummary: snapshot(after.fields, changedFields),
    changedFields
  };
}

export function validateHistoryEvent(value: HistoryEventDraft): void {
  if (!value.entityId.trim() || !value.entityType.trim())
    throw new Error('History entity is required.');
  if (!value.actorLabel.trim()) throw new Error('History actor label is required.');
  if (Number.isNaN(Date.parse(value.timestamp))) throw new Error('History timestamp is invalid.');
  if (!value.summary.trim() || value.summary.length > 300)
    throw new Error('History summary must contain at most 300 characters.');
  for (const evidence of [value.beforeSummary, value.afterSummary])
    if (evidence !== undefined && evidence.length > 500)
      throw new Error('History before/after evidence must contain at most 500 characters.');
}

function changed(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>
): readonly string[] {
  if (before === undefined) return Object.keys(after).sort();
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .sort();
}

function snapshot(fields: Readonly<Record<string, unknown>>, names: readonly string[]): string {
  const parts = names.slice(0, 20).map((field) => {
    if (PRIVATE_FIELDS.has(field)) return `${field}: changed (content withheld)`;
    const value = fields[field];
    if (
      !VALUE_FIELDS.has(field) ||
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    )
      return `${field}: ${value === undefined ? 'not set' : 'changed'}`;
    return `${field}: ${bounded(String(value), 80)}`;
  });
  if (names.length > 20) parts.push(`${names.length - 20} more fields changed`);
  return bounded(parts.join(' · ') || 'No managed field value changed.', 500);
}

function labelFor(record: HistoryRecordSnapshot): string {
  for (const key of ['title', 'name', 'label', 'source', 'value']) {
    const value = record.fields[key];
    if (typeof value === 'string' && value.trim()) return bounded(value.trim(), 100);
  }
  return record.envelope.pmId;
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
