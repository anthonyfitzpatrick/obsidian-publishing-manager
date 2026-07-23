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
  readonly allowedValues?: readonly string[];
  readonly format?: 'country' | 'currency' | 'http-url' | 'token' | 'vault-path';
  readonly kind: SchemaValueKind;
  readonly maximumBytes?: number;
  readonly maximumItemBytes?: number;
  readonly maximumItems?: number;
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
const constrainedString = (
  required: boolean,
  options: Pick<RecordFieldDefinition, 'allowedValues' | 'format' | 'maximumBytes'>
): RecordFieldDefinition => ({ kind: 'string', required, ...options });
const relation = (relationship: ManagedRecordType, required: boolean): RecordFieldDefinition => ({
  kind: 'string',
  required,
  relationship
});

/** Canonical v1 schema catalog. Keys match the persisted `pm-type` discriminator exactly. */
export const RECORD_SCHEMAS = {
  series: schema('series', {
    name: requiredString(),
    'ordering-policy': optionalString(),
    // Series cover art follows the same local-vault path contract as a Project cover.
    cover: constrainedString(false, { format: 'vault-path', maximumBytes: 1_024 })
  }),
  book: schema('book', {
    title: requiredString(),
    status: constrainedString(true, {
      allowedValues: ['planned', 'active', 'ready', 'published', 'suspended', 'archived']
    }),
    'primary-language': constrainedString(true, { format: 'token', maximumBytes: 40 }),
    'series-id': relation('series', false),
    'series-position': { kind: 'integer', required: false },
    summary: optionalString(),
    cover: constrainedString(false, { format: 'vault-path', maximumBytes: 1_024 })
  }),
  edition: schema('edition', {
    'book-id': relation('book', true),
    type: constrainedString(true, {
      allowedValues: [
        'paperback',
        'hardcover',
        'ebook',
        'audiobook',
        'screenplay',
        'large-print',
        'special-edition',
        'collector-edition',
        'box-set',
        'custom'
      ]
    }),
    'custom-type': optionalString(),
    medium: constrainedString(true, { allowedValues: ['print', 'digital', 'audio', 'mixed'] }),
    revision: { kind: 'integer', required: true },
    status: constrainedString(true, {
      allowedValues: ['planned', 'active', 'ready', 'published', 'suspended', 'archived']
    }),
    'publication-date': { kind: 'date', required: false },
    cover: optionalString(),
    'full-cover': constrainedString(false, { format: 'vault-path', maximumBytes: 1_024 }),
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
    category: constrainedString(true, { allowedValues: ['print', 'digital', 'audio'] }),
    label: optionalString(),
    'file-path': constrainedString(false, { format: 'vault-path', maximumBytes: 1_024 }),
    accessibility: { kind: 'object', required: false },
    metadata: { kind: 'object', required: false },
    'asset-reference-id': relation('asset-reference', false)
  }),
  'platform-target': schema('platform-target', {
    'edition-id': relation('edition', true),
    'profile-id': relation('platform-profile', true),
    platform: requiredString(),
    territory: constrainedString(true, { format: 'country', maximumBytes: 2 }),
    'publication-location': requiredString(),
    aliases: { kind: 'string-list', required: false },
    intent: { kind: 'boolean', required: true },
    checklist: { kind: 'object', required: true },
    'metadata-ready': { kind: 'boolean', required: true },
    'assets-ready': { kind: 'boolean', required: true },
    'pricing-ready': { kind: 'boolean', required: true },
    'upload-date': { kind: 'date', required: false },
    'review-state': constrainedString(true, {
      allowedValues: ['not-submitted', 'submitted', 'in-review', 'approved', 'changes-requested']
    }),
    'publication-state': constrainedString(true, {
      allowedValues: ['not-planned', 'preorder', 'published', 'unpublished']
    }),
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
    'official-url': constrainedString(true, { format: 'http-url', maximumBytes: 2_048 }),
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
    status: constrainedString(true, {
      allowedValues: ['available', 'reserved', 'assigned', 'published', 'retired']
    }),
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
    territory: constrainedString(true, { format: 'country', maximumBytes: 2 }),
    currency: constrainedString(true, { format: 'currency', maximumBytes: 3 }),
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
    status: constrainedString(true, { allowedValues: ['active', 'archived'] }),
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
    status: constrainedString(true, {
      allowedValues: ['not-started', 'active', 'done', 'cancelled']
    }),
    priority: constrainedString(true, { allowedValues: ['low', 'normal', 'high', 'urgent'] }),
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
    'reflow-mode': constrainedString(true, {
      allowedValues: ['all-unpinned', 'future-incomplete', 'anchor-only']
    }),
    milestones: { kind: 'object', required: true },
    'critical-path': { kind: 'string-list', required: true }
  }),
  review: schema('review', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    source: requiredString(),
    'source-link': constrainedString(false, { format: 'http-url', maximumBytes: 2_048 }),
    date: { kind: 'date', required: true },
    rating: { kind: 'decimal', required: false },
    quote: optionalString(),
    reference: optionalString(),
    'permission-status': constrainedString(true, {
      allowedValues: ['unknown', 'not-required', 'obtained', 'restricted']
    }),
    'permission-notes': optionalString(),
    'follow-up-date': { kind: 'date', required: false },
    'follow-up-status': constrainedString(true, {
      allowedValues: ['none', 'open', 'done', 'dismissed']
    }),
    notes: optionalString()
  }),
  template: schema('template', {
    kind: requiredString(),
    name: requiredString(),
    description: optionalString(),
    version: { kind: 'integer', required: true },
    source: requiredString(),
    'source-template-id': optionalString(),
    applicability: { kind: 'object', required: true },
    defaults: { kind: 'object', required: true },
    'required-fields': { kind: 'string-list', required: true },
    variables: { kind: 'object', required: true },
    extensions: { kind: 'object', required: false }
  }),
  'asset-reference': schema('asset-reference', {
    'book-id': relation('book', true),
    'edition-id': relation('edition', false),
    'format-id': relation('format', false),
    path: constrainedString(true, { format: 'vault-path', maximumBytes: 1_024 }),
    role: requiredString(),
    'modified-time': { kind: 'datetime', required: false },
    size: { kind: 'integer', required: false },
    fingerprint: optionalString(),
    'source-fingerprint': optionalString(),
    notes: optionalString(),
    'externally-managed': { kind: 'boolean', required: false }
  }),
  'history-event': schema('history-event', {
    'book-id': relation('book', false),
    'entity-id': requiredString(),
    'entity-type': requiredString(),
    'entity-label': requiredString(),
    'actor-label': requiredString(),
    action: requiredString(),
    timestamp: { kind: 'datetime', required: true },
    summary: requiredString(),
    'before-summary': optionalString(),
    'after-summary': optionalString(),
    'changed-fields': { kind: 'string-list', required: true }
  }),
  'sales-source': schema('sales-source', {
    label: requiredString(),
    kind: requiredString(),
    defaults: { kind: 'object', required: false },
    notes: optionalString()
  }),
  'sales-partition': schema('sales-partition', {
    /** One bounded canonical Markdown note owns at most 1,000 immutable JSONL sales rows. */
    'partition-key': constrainedString(true, { maximumBytes: 512 }),
    'source-id': relation('sales-source', true),
    'isbn-id': relation('isbn', true),
    'edition-id': relation('edition', true),
    'format-id': relation('format', false),
    'platform-target-id': relation('platform-target', true),
    country: constrainedString(true, { format: 'country', maximumBytes: 2 }),
    currency: constrainedString(true, { format: 'currency', maximumBytes: 3 }),
    period: constrainedString(true, { format: 'token', maximumBytes: 7 }),
    shard: { kind: 'integer', required: true },
    'line-count': { kind: 'integer', required: true },
    'start-date-min': { kind: 'date', required: true },
    'end-date-max': { kind: 'date', required: true },
    units: { kind: 'integer', required: true },
    returns: { kind: 'integer', required: true },
    'gross-revenue': { kind: 'decimal', required: false },
    'net-revenue': { kind: 'decimal', required: false },
    proceeds: { kind: 'decimal', required: false },
    rows: constrainedString(true, { maximumBytes: 786_432 })
  }),
  'sales-line': schema('sales-line', {
    'source-id': relation('sales-source', true),
    'isbn-id': relation('isbn', true),
    'edition-id': relation('edition', true),
    'format-id': relation('format', false),
    'platform-target-id': relation('platform-target', true),
    country: constrainedString(true, { format: 'country', maximumBytes: 2 }),
    kind: constrainedString(true, { allowedValues: ['transaction', 'period-summary'] }),
    'start-date': { kind: 'date', required: true },
    'end-date': { kind: 'date', required: true },
    units: { kind: 'integer', required: true },
    returns: { kind: 'integer', required: true },
    'net-units': { kind: 'integer', required: true },
    currency: constrainedString(true, { format: 'currency', maximumBytes: 3 }),
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
    status: constrainedString(true, { allowedValues: ['accepted', 'superseded', 'void'] })
  }),
  'sales-correction': schema('sales-correction', {
    // A correction may point to a legacy sales-line note or a row inside a sales partition.
    'sales-line-id': requiredString(),
    kind: constrainedString(true, {
      allowedValues: ['correction', 'refund', 'return', 'reversal']
    }),
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
