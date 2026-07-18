/**
 * Owns the identity and lifecycle metadata shared by every canonical record. The envelope is
 * deliberately small and independent of filenames so records survive vault moves and human
 * renaming. Validation accepts untrusted frontmatter and returns explicit diagnostics rather
 * than coercing damaged user data or silently inventing timestamps.
 */

import { isManagedRecordType, type ManagedRecordType } from './record-types';

/** Current envelope/schema generation for records first introduced in M1. */
export const CURRENT_RECORD_SCHEMA_VERSION = 1 as const;

/** Canonical in-memory representation of the persisted `pm-*` envelope keys. */
export interface ManagedRecordEnvelope {
  readonly pmId: string;
  readonly pmType: ManagedRecordType;
  readonly pmSchema: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

/** Stable diagnostic emitted when untrusted frontmatter violates an envelope invariant. */
export interface EnvelopeDiagnostic {
  readonly code:
    | 'envelope.invalid-archive-time'
    | 'envelope.invalid-created-time'
    | 'envelope.invalid-id'
    | 'envelope.invalid-schema'
    | 'envelope.invalid-type'
    | 'envelope.invalid-updated-time'
    | 'envelope.updated-before-created';
  readonly field: string;
  readonly message: string;
}

/** Result keeps invalid user data out of domain records without throwing away diagnostics. */
export type EnvelopeValidationResult =
  | { readonly valid: true; readonly envelope: ManagedRecordEnvelope }
  | {
      readonly valid: false;
      readonly diagnostics: readonly EnvelopeDiagnostic[];
    };

/** Persisted frontmatter keys controlled by the shared envelope contract. */
export const ENVELOPE_FRONTMATTER_KEYS = [
  'pm-id',
  'pm-type',
  'pm-schema',
  'pm-created',
  'pm-updated',
  'pm-archived'
] as const;

/** Converts a validated in-memory envelope into its human-readable frontmatter shape. */
export function serializeEnvelope(
  envelope: ManagedRecordEnvelope
): Readonly<Record<string, unknown>> {
  return {
    'pm-id': envelope.pmId,
    'pm-type': envelope.pmType,
    'pm-schema': envelope.pmSchema,
    'pm-created': envelope.createdAt,
    'pm-updated': envelope.updatedAt,
    ...(envelope.archivedAt === undefined ? {} : { 'pm-archived': envelope.archivedAt })
  };
}

/**
 * Validates the envelope embedded in arbitrary parsed frontmatter. The function never trims,
 * rewrites, or defaults user values because doing so could hide corruption or identity drift.
 */
export function validateEnvelope(
  frontmatter: Readonly<Record<string, unknown>>
): EnvelopeValidationResult {
  const diagnostics: EnvelopeDiagnostic[] = [];
  const pmId = frontmatter['pm-id'];
  const pmType = frontmatter['pm-type'];
  const pmSchema = frontmatter['pm-schema'];
  const createdAt = frontmatter['pm-created'];
  const updatedAt = frontmatter['pm-updated'];
  const archivedAt = frontmatter['pm-archived'];

  if (typeof pmId !== 'string' || !/^pm-[a-z0-9][a-z0-9-]{7,127}$/u.test(pmId)) {
    diagnostics.push({
      code: 'envelope.invalid-id',
      field: 'pm-id',
      message: 'Managed record ID must be an opaque pm-prefixed lowercase identifier.'
    });
  }

  if (!isManagedRecordType(pmType)) {
    diagnostics.push({
      code: 'envelope.invalid-type',
      field: 'pm-type',
      message: 'Managed record type is missing or unsupported.'
    });
  }

  if (typeof pmSchema !== 'number' || !Number.isSafeInteger(pmSchema) || pmSchema < 0) {
    diagnostics.push({
      code: 'envelope.invalid-schema',
      field: 'pm-schema',
      message: 'Managed record schema must be a non-negative safe integer.'
    });
  }

  if (!isIsoInstant(createdAt)) {
    diagnostics.push({
      code: 'envelope.invalid-created-time',
      field: 'pm-created',
      message: 'Creation timestamp must be an ISO 8601 UTC instant.'
    });
  }

  if (!isIsoInstant(updatedAt)) {
    diagnostics.push({
      code: 'envelope.invalid-updated-time',
      field: 'pm-updated',
      message: 'Update timestamp must be an ISO 8601 UTC instant.'
    });
  }

  if (archivedAt !== undefined && !isIsoInstant(archivedAt)) {
    diagnostics.push({
      code: 'envelope.invalid-archive-time',
      field: 'pm-archived',
      message: 'Archive timestamp must be omitted or an ISO 8601 UTC instant.'
    });
  }

  if (isIsoInstant(createdAt) && isIsoInstant(updatedAt) && updatedAt < createdAt) {
    diagnostics.push({
      code: 'envelope.updated-before-created',
      field: 'pm-updated',
      message: 'Update timestamp cannot be earlier than the creation timestamp.'
    });
  }

  if (diagnostics.length > 0) {
    return { valid: false, diagnostics };
  }

  // Every field has been narrowed above. The local assertions communicate that relationship
  // to TypeScript without weakening the public boundary to `any` or coercing input values.
  const envelope: ManagedRecordEnvelope = {
    pmId: pmId as string,
    pmType: pmType as ManagedRecordType,
    pmSchema: pmSchema as number,
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt as string })
  };
  return { valid: true, envelope };
}

/** Accepts only canonical UTC instants so lexical ordering remains meaningful and portable. */
function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
