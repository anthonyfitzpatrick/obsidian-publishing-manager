/**
 * Declares version-one schemas for every DAT-002 record family. These descriptors intentionally
 * define storage-level field contracts rather than all future business rules: later milestones
 * may add richer validators without changing the envelope or pretending unfinished features are
 * implemented. The catalog is versioned, deterministic, and suitable for migration preflight.
 */

import { CURRENT_RECORD_SCHEMA_VERSION } from './record-envelope';
import { MANAGED_RECORD_TYPES, type ManagedRecordType } from './record-types';

/** Primitive and structured value categories understood by storage validation. */
export type SchemaValueKind =
  'boolean' | 'date' | 'datetime' | 'decimal' | 'integer' | 'object' | 'string' | 'string-list';

/** Field-level storage contract; domain-specific semantics are layered on later. */
export interface RecordFieldDefinition {
  readonly kind: SchemaValueKind;
  readonly required: boolean;
  readonly relationship?: ManagedRecordType;
}

/** Versioned descriptor used by validation, diagnostics, migrations, and schema fingerprints. */
export interface RecordSchemaDefinition {
  readonly type: ManagedRecordType;
  readonly version: number;
  readonly fields: Readonly<Record<string, RecordFieldDefinition>>;
}

const requiredString = (): RecordFieldDefinition => ({
  kind: 'string',
  required: true
});
const optionalString = (): RecordFieldDefinition => ({
  kind: 'string',
  required: false
});
const relation = (relationship: ManagedRecordType, required: boolean): RecordFieldDefinition => ({
  kind: 'string',
  required,
  relationship
});

/** Canonical v1 schema catalog. Keys match the persisted `pm-type` discriminator exactly. */
export const RECORD_SCHEMAS = {
  series: schema('series', {
    name: requiredString(),
    'ordering-policy': optionalString()
  }),
  book: schema('book', {
    title: requiredString(),
    status: requiredString(),
    'primary-language': requiredString(),
    'series-id': relation('series', false),
    'series-position': { kind: 'integer', required: false },
    summary: optionalString()
  }),
  edition: schema('edition', {
    'book-id': relation('book', true),
    type: requiredString(),
    'custom-type': optionalString(),
    medium: requiredString(),
    revision: { kind: 'integer', required: true },
    status: requiredString(),
    'publication-date': { kind: 'date', required: false },
    cover: optionalString(),
    'retail-links': { kind: 'object', required: false },
    notes: optionalString(),
    'source-edition-id': relation('edition', false),
    'trim-width': { kind: 'decimal', required: false },
    'trim-height': { kind: 'decimal', required: false },
    'trim-unit': optionalString(),
    'page-count': { kind: 'integer', required: false },
    narrator: optionalString(),
    'duration-minutes': { kind: 'integer', required: false },
    'audio-metadata': { kind: 'object', required: false }
  }),
  format: schema('format', {
    'edition-id': relation('edition', true),
    kind: requiredString(),
    category: requiredString(),
    label: optionalString(),
    'file-path': optionalString(),
    accessibility: { kind: 'object', required: false },
    metadata: { kind: 'object', required: false },
    'asset-reference-id': relation('asset-reference', false)
  }),
  'platform-target': schema('platform-target', {
    'edition-id': relation('edition', true),
    'profile-id': relation('platform-profile', true),
    platform: requiredString(),
    territory: requiredString(),
    'publication-location': requiredString(),
    aliases: { kind: 'string-list', required: false },
    intent: { kind: 'boolean', required: true },
    checklist: { kind: 'object', required: true },
    'metadata-ready': { kind: 'boolean', required: true },
    'assets-ready': { kind: 'boolean', required: true },
    'pricing-ready': { kind: 'boolean', required: true },
    'upload-date': { kind: 'date', required: false },
    'review-state': requiredString(),
    'publication-state': requiredString(),
    'retail-links': { kind: 'object', required: false },
    notes: optionalString(),
    'last-verified': { kind: 'date', required: false },
    'profile-version': { kind: 'integer', required: true }
  }),
  'platform-profile': schema('platform-profile', {
    slug: requiredString(),
    label: requiredString(),
    version: { kind: 'integer', required: true },
    'reviewed-at': { kind: 'date', required: true },
    'official-url': requiredString(),
    requirements: { kind: 'object', required: true },
    notes: optionalString()
  }),
  'readiness-override': schema('readiness-override', {
    'rule-code': requiredString(),
    'scope-kind': requiredString(),
    'scope-id': requiredString(),
    reason: requiredString(),
    'owner-label': requiredString(),
    'created-at': { kind: 'datetime', required: true },
    'expires-at': { kind: 'datetime', required: false }
  }),
  'metadata-set': schema('metadata-set', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    scope: requiredString(),
    values: { kind: 'object', required: true },
    'bisac-version': requiredString(),
    'thema-version': requiredString()
  }),
  isbn: schema('isbn', {
    value: requiredString(),
    'isbn-10': optionalString(),
    status: requiredString(),
    'edition-id': relation('edition', false),
    'format-id': relation('format', false),
    publisher: optionalString(),
    imprint: optionalString(),
    'acquisition-note': optionalString(),
    'assigned-at': { kind: 'datetime', required: false },
    'published-at': { kind: 'datetime', required: false },
    notes: optionalString(),
    corrections: { kind: 'object', required: false }
  }),
  price: schema('price', {
    'edition-id': relation('edition', true),
    platform: requiredString(),
    territory: requiredString(),
    currency: requiredString(),
    amount: { kind: 'decimal', required: true },
    'tax-included': { kind: 'boolean', required: true },
    'tax-rate': { kind: 'decimal', required: false },
    'effective-from': { kind: 'date', required: true },
    'effective-to': { kind: 'date', required: false },
    source: requiredString(),
    notes: optionalString(),
    'print-cost': { kind: 'decimal', required: false },
    assumption: { kind: 'object', required: false },
    'supersedes-price-id': relation('price', false)
  }),
  workflow: schema('workflow', {
    'book-id': relation('book', true),
    name: requiredString(),
    status: requiredString(),
    'template-id': requiredString(),
    'template-version': { kind: 'integer', required: true },
    'template-baseline': { kind: 'object', required: true },
    stages: { kind: 'object', required: true }
  }),
  task: schema('task', {
    'book-id': relation('book', true),
    'workflow-id': relation('workflow', true),
    'stage-id': requiredString(),
    'edition-id': relation('edition', false),
    title: requiredString(),
    status: requiredString(),
    priority: requiredString(),
    required: { kind: 'boolean', required: true },
    deadline: { kind: 'date', required: false },
    'estimate-minutes': { kind: 'integer', required: false },
    'actual-minutes': { kind: 'integer', required: false },
    owner: optionalString(),
    notes: optionalString(),
    attachments: { kind: 'string-list', required: false },
    checklist: { kind: 'object', required: true },
    'manual-blockers': { kind: 'string-list', required: false },
    'linked-metadata': { kind: 'object', required: false },
    'retailer-action': { kind: 'boolean', required: false },
    'retailer-confirmed': { kind: 'boolean', required: false },
    'depends-on': {
      kind: 'string-list',
      required: false,
      relationship: 'task'
    }
  }),
  launch: schema('launch', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    'publication-date': { kind: 'date', required: true },
    'template-id': requiredString(),
    'template-version': { kind: 'integer', required: true },
    'reflow-mode': requiredString(),
    milestones: { kind: 'object', required: true },
    'critical-path': { kind: 'string-list', required: true }
  }),
  review: schema('review', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    source: requiredString(),
    'source-link': optionalString(),
    date: { kind: 'date', required: true },
    rating: { kind: 'decimal', required: false },
    quote: optionalString(),
    reference: optionalString(),
    'permission-status': requiredString(),
    'permission-notes': optionalString(),
    'follow-up-date': { kind: 'date', required: false },
    'follow-up-status': requiredString(),
    notes: optionalString()
  }),
  'asset-reference': schema('asset-reference', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    'format-id': relation('format', false),
    path: requiredString(),
    role: requiredString(),
    'modified-time': { kind: 'datetime', required: false },
    size: { kind: 'integer', required: false },
    fingerprint: optionalString(),
    'source-fingerprint': optionalString(),
    notes: optionalString(),
    'externally-managed': { kind: 'boolean', required: false }
  }),
  'history-event': schema('history-event', {
    'entity-id': requiredString(),
    'entity-type': requiredString(),
    action: requiredString(),
    timestamp: { kind: 'datetime', required: true },
    summary: requiredString()
  }),
  'sales-source': schema('sales-source', {
    label: requiredString(),
    kind: requiredString(),
    defaults: { kind: 'object', required: false },
    notes: optionalString()
  }),
  'sales-line': schema('sales-line', {
    'source-id': relation('sales-source', true),
    'isbn-id': relation('isbn', true),
    'edition-id': relation('edition', true),
    'format-id': relation('format', false),
    'platform-target-id': relation('platform-target', true),
    country: requiredString(),
    kind: requiredString(),
    'start-date': { kind: 'date', required: true },
    'end-date': { kind: 'date', required: true },
    units: { kind: 'integer', required: true },
    returns: { kind: 'integer', required: true },
    'net-units': { kind: 'integer', required: true },
    currency: requiredString(),
    'gross-revenue': { kind: 'decimal', required: false },
    'net-revenue': { kind: 'decimal', required: false },
    tax: { kind: 'decimal', required: false },
    fees: { kind: 'decimal', required: false },
    discounts: { kind: 'decimal', required: false },
    proceeds: { kind: 'decimal', required: false },
    'external-reference': optionalString(),
    'entry-key': requiredString(),
    'coverage-key': requiredString(),
    provenance: { kind: 'object', required: true },
    'source-values': { kind: 'object', required: true },
    status: requiredString()
  }),
  'sales-correction': schema('sales-correction', {
    'sales-line-id': relation('sales-line', true),
    kind: requiredString(),
    reason: requiredString(),
    timestamp: { kind: 'datetime', required: true },
    adjustment: { kind: 'object', required: true },
    'owner-label': requiredString()
  })
} as const satisfies Record<ManagedRecordType, RecordSchemaDefinition>;

/** Retrieves a schema without allowing unknown record types to fall through silently. */
export function getRecordSchema(type: ManagedRecordType): RecordSchemaDefinition {
  return RECORD_SCHEMAS[type];
}

/** Deterministic signature invalidates derived indexes when a storage contract changes. */
export function getSchemaCatalogFingerprint(): string {
  const canonical = MANAGED_RECORD_TYPES.map((type) => RECORD_SCHEMAS[type]);
  return stableFingerprint(JSON.stringify(canonical));
}

/** Constructs a v1 descriptor while keeping every catalog entry structurally identical. */
function schema(
  type: ManagedRecordType,
  fields: Readonly<Record<string, RecordFieldDefinition>>
): RecordSchemaDefinition {
  return { type, version: CURRENT_RECORD_SCHEMA_VERSION, fields };
}

/**
 * Small deterministic non-cryptographic fingerprint for cache invalidation. It is not used for
 * security or user identity; its only promise is stable output for identical catalog text.
 */
function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `schema-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
