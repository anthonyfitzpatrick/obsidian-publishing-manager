/**
 * Protects DAT-001 and DAT-002 as durable storage contracts. These tests focus on identity,
 * timestamps, complete schema coverage, future-version handling, and unknown-field tolerance—the
 * properties that later feature code must be able to trust without inspecting raw frontmatter.
 */

import { describe, expect, it } from 'vitest';

import {
  CURRENT_RECORD_SCHEMA_VERSION,
  serializeEnvelope,
  validateEnvelope,
  type ManagedRecordEnvelope
} from '../../src/domain/records/record-envelope';
import { MANAGED_RECORD_TYPES } from '../../src/domain/records/record-types';
import {
  getRecordSchema,
  getSchemaCatalogFingerprint
} from '../../src/domain/records/schema-catalog';
import { validateRecordSchema } from '../../src/domain/records/schema-validation';

const VALID_ENVELOPE: ManagedRecordEnvelope = {
  pmId: 'pm-book-00000001',
  pmType: 'book',
  pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z'
};

describe('record envelope', () => {
  it('round-trips every canonical persisted envelope key', () => {
    const result = validateEnvelope({
      ...serializeEnvelope(VALID_ENVELOPE),
      'pm-archived': '2026-07-19T12:00:00.000Z'
    });

    expect(result).toEqual({
      valid: true,
      envelope: { ...VALID_ENVELOPE, archivedAt: '2026-07-19T12:00:00.000Z' }
    });
  });

  it('reports identity, type, schema, timestamp, and ordering failures together', () => {
    const result = validateEnvelope({
      'pm-id': '../book',
      'pm-type': 'unknown',
      'pm-schema': -1,
      'pm-created': '2026-07-19T12:00:00.000Z',
      'pm-updated': '2026-07-18T12:00:00.000Z',
      'pm-archived': 'not-a-date'
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        'envelope.invalid-id',
        'envelope.invalid-type',
        'envelope.invalid-schema',
        'envelope.invalid-archive-time',
        'envelope.updated-before-created'
      ]);
    }
  });
});

describe('versioned schema catalog', () => {
  it('defines exactly one versioned schema for every canonical record type', () => {
    const schemas = MANAGED_RECORD_TYPES.map((type) => getRecordSchema(type));

    expect(schemas.map(({ type }) => type)).toEqual(MANAGED_RECORD_TYPES);
    expect(schemas.every(({ version }) => version === CURRENT_RECORD_SCHEMA_VERSION)).toBe(true);
    expect(new Set(schemas.map(({ type }) => type)).size).toBe(MANAGED_RECORD_TYPES.length);
    expect(getSchemaCatalogFingerprint()).toMatch(/^schema-[0-9a-f]{8}$/u);
  });

  it('validates known book fields while preserving unknown extension fields', () => {
    const diagnostics = validateRecordSchema({
      envelope: VALID_ENVELOPE,
      fields: {
        title: 'The Fictional Meridian',
        status: 'active',
        'primary-language': 'en',
        'future-safe-extension': { retained: true }
      }
    });

    expect(diagnostics).toEqual([]);
  });

  it('marks unsupported future schemas read-only instead of interpreting them', () => {
    const diagnostics = validateRecordSchema({
      envelope: { ...VALID_ENVELOPE, pmSchema: 99 },
      fields: { title: 'Future record' }
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'schema.future-version',
        field: 'pm-schema'
      })
    ]);
  });
});
