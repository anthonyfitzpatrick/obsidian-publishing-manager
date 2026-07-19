/**
 * Performs storage-level validation for the versioned DAT-002 schema catalog. It deliberately
 * reports every field problem in one pass so diagnostics can guide a human repair. Referential
 * existence and richer publishing rules belong to later services and are not guessed here.
 */

import type { ManagedRecordEnvelope } from './record-envelope';
import { getRecordSchema, type RecordFieldDefinition } from './schema-catalog';
import { inspectUntrustedData } from '../security/untrusted-data';
import { normalizeVaultPath } from '../storage/vault-path';

/** Field diagnostic suitable for user-facing repair guidance and deterministic tests. */
export interface SchemaDiagnostic {
  readonly code:
    | 'schema.future-version'
    | 'schema.invalid-field'
    | 'schema.missing-field'
    | 'schema.resource-limit';
  readonly field: string;
  readonly message: string;
}

/** Complete storage record presented to schema validation after envelope validation succeeds. */
export interface ManagedRecordData {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Validates required fields and primitive shapes while preserving unknown fields untouched. */
export function validateRecordSchema(record: ManagedRecordData): readonly SchemaDiagnostic[] {
  const schema = getRecordSchema(record.envelope.pmType);
  if (record.envelope.pmSchema > schema.version) {
    return [
      {
        code: 'schema.future-version',
        field: 'pm-schema',
        message: `Record schema ${record.envelope.pmSchema} is newer than supported version ${schema.version}; open read-only.`
      }
    ];
  }

  const diagnostics: SchemaDiagnostic[] = inspectUntrustedData(record.fields).map((issue) => ({
    code: 'schema.resource-limit' as const,
    field: issue.path,
    message: issue.message
  }));
  for (const [field, definition] of Object.entries(schema.fields)) {
    const value = record.fields[field];
    if (value === undefined) {
      if (definition.required) {
        diagnostics.push({
          code: 'schema.missing-field',
          field,
          message: `Required ${record.envelope.pmType} field "${field}" is missing.`
        });
      }
      continue;
    }

    if (!matchesKind(value, definition)) {
      diagnostics.push({
        code: 'schema.invalid-field',
        field,
        message: `Field "${field}" must be ${describeKind(definition)}.`
      });
    }
  }
  return diagnostics;
}

/** Checks only safe structural categories; domain semantics are intentionally separate. */
function matchesKind(value: unknown, definition: RecordFieldDefinition): boolean {
  switch (definition.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'string-list':
      return (
        Array.isArray(value) &&
        value.length <= (definition.maximumItems ?? 1_000) &&
        value.every(
          (item) =>
            typeof item === 'string' && utf8Bytes(item) <= (definition.maximumItemBytes ?? 2_048)
        )
      );
    case 'date':
      return isCalendarDate(value);
    case 'datetime':
      return isCanonicalInstant(value);
    case 'decimal':
      return (
        typeof value === 'string' &&
        utf8Bytes(value) <= (definition.maximumBytes ?? 100) &&
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)
      );
    case 'string':
      return (
        typeof value === 'string' &&
        utf8Bytes(value) <= (definition.maximumBytes ?? 32_768) &&
        (definition.relationship === undefined || isManagedId(value)) &&
        (definition.allowedValues === undefined || definition.allowedValues.includes(value)) &&
        matchesFormat(value, definition.format)
      );
  }
}

function matchesFormat(value: string, format: RecordFieldDefinition['format']): boolean {
  if (format === undefined) return true;
  if (format === 'country') return /^[A-Z]{2}$/u.test(value);
  if (format === 'currency') return /^[A-Z]{3}$/u.test(value);
  if (format === 'http-url') {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }
  if (format === 'token') return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
  try {
    return normalizeVaultPath(value) === value;
  } catch {
    return false;
  }
}

function isManagedId(value: string): boolean {
  return /^pm-[a-z0-9][a-z0-9-]{7,127}$/u.test(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || utf8Bytes(value) > 40 || !value.endsWith('Z')) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Produces a human-readable type label and retains relationship information. */
function describeKind(definition: RecordFieldDefinition): string {
  return definition.relationship === undefined
    ? `a ${definition.kind}`
    : `a ${definition.kind} reference to ${definition.relationship}`;
}
