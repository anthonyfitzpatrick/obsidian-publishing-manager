/** Proves the complete canonical type vocabulary and every persistence/exchange boundary are named. */
import { describe, expect, it } from 'vitest';

import {
  CANONICAL_VAULT_RECORD_TYPES,
  LOCAL_PLUGIN_DATA_BLOCKS,
  OPTIONAL_INTEGRATION_FIELD_EXCHANGES,
  PRIVACY_STORAGE_POLICY,
  REFERENCED_NOT_OWNED_DATA_CLASSES,
  SESSION_ONLY_DATA_CLASSES
} from '../../src/domain/privacy/data-handling-inventory';
import { MANAGED_RECORD_TYPES } from '../../src/domain/records/record-types';

describe('privacy data-handling inventory', () => {
  it('covers every canonical record type as user-owned vault data', () => {
    expect(CANONICAL_VAULT_RECORD_TYPES).toBe(MANAGED_RECORD_TYPES);
    expect(new Set(CANONICAL_VAULT_RECORD_TYPES)).toEqual(new Set(MANAGED_RECORD_TYPES));
    expect(PRIVACY_STORAGE_POLICY.projectData).toBe('vault');
    expect(PRIVACY_STORAGE_POLICY.preferences).toBe('obsidian-local-plugin-data');
  });

  it('names every intentional plugin-data block and prevents hidden persistence claims', () => {
    expect(LOCAL_PLUGIN_DATA_BLOCKS).toEqual([
      'classificationLicense',
      'dashboard',
      'history',
      'settings',
      'settingsOperationJournals',
      'settingsStorageMoveRecovery'
    ]);
    expect(SESSION_ONLY_DATA_CLASSES).toContain('unsaved form and book drafts');
    expect(REFERENCED_NOT_OWNED_DATA_CLASSES).toContain('manuscripts');
    expect(PRIVACY_STORAGE_POLICY.networkTransmission).toBe('none');
    expect(PRIVACY_STORAGE_POLICY.telemetry).toBe('none');
  });

  it('keeps optional exchanges explicit, local, stable-ID-based, and credential-free', () => {
    const serialized = JSON.stringify(OPTIONAL_INTEGRATION_FIELD_EXCHANGES);
    for (const required of ['correlationId', 'bookId', 'contractVersion'])
      expect(serialized).toContain(required);
    for (const prohibited of [
      'credential',
      'password',
      'token',
      'manuscriptBody',
      'assetBytes',
      'sales'
    ])
      expect(serialized.toLowerCase()).not.toContain(prohibited.toLowerCase());
  });

  it('declares disable and uninstall as mutation-free lifecycle events', () => {
    expect(PRIVACY_STORAGE_POLICY.disableMutation).toBe('none');
    expect(PRIVACY_STORAGE_POLICY.uninstallMutation).toBe('none');
  });
});
