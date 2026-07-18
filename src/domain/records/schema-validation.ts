/**
 * Performs storage-level validation for the versioned DAT-002 schema catalog. It deliberately
 * reports every field problem in one pass so diagnostics can guide a human repair. Referential
 * existence and richer publishing rules belong to later services and are not guessed here.
 */

import type { ManagedRecordEnvelope } from './record-envelope';
import { getRecordSchema, type RecordFieldDefinition } from './schema-catalog';

/** Field diagnostic suitable for user-facing repair guidance and deterministic tests. */
export interface SchemaDiagnostic {
  readonly code: 'schema.future-version' | 'schema.invalid-field' | 'schema.missing-field';
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

  const diagnostics: SchemaDiagnostic[] = [];
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
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'decimal':
      return typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value);
    case 'string':
      return typeof value === 'string';
  }
}

/** Produces a human-readable type label and retains relationship information. */
function describeKind(definition: RecordFieldDefinition): string {
  return definition.relationship === undefined
    ? `a ${definition.kind}`
    : `a ${definition.kind} reference to ${definition.relationship}`;
}
