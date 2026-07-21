/**
 * Machine-readable privacy inventory shared by regression tests and human documentation. It names
 * every persistence boundary without granting any read, write, delete, network, or host capability.
 */
import { MANAGED_RECORD_TYPES } from '../records/record-types';

/** Canonical publishing records are readable user-owned Markdown inside the configured vault root. */
export const CANONICAL_VAULT_RECORD_TYPES = MANAGED_RECORD_TYPES;

/** Non-record vault artifacts remain readable and are created only through explicit local actions. */
export const ADDITIONAL_VAULT_DATA_CLASSES = [
  'managed operation journals',
  'explicit Markdown/CSV/ICS exports',
  'template Markdown bodies'
] as const;

/** These are the only top-level values Publishing Manager intentionally owns in Obsidian data.json. */
export const LOCAL_PLUGIN_DATA_BLOCKS = [
  'classificationLicense',
  'dashboard',
  'history',
  'settings',
  'settingsOperationJournals',
  'settingsStorageMoveRecovery'
] as const;

/** Sensitive transient material is discarded with the running plugin and is never a hidden store. */
export const SESSION_ONLY_DATA_CLASSES = [
  'unsaved form and book drafts',
  'derived catalog indexes and diagnostics',
  'readiness and dashboard projections',
  'integration discovery state and correlation identifiers'
] as const;

/** Referenced production assets remain user-owned vault files; only their paths/evidence are stored. */
export const REFERENCED_NOT_OWNED_DATA_CLASSES = [
  'manuscripts',
  'covers',
  'EPUB and print files',
  'press-kit and media assets'
] as const;

/** Exact optional local exchange allowlists; neither contract includes credentials or network URLs. */
export const OPTIONAL_INTEGRATION_FIELD_EXCHANGES = {
  metadataVisuals: {
    inboundRequest: [
      'contractId',
      'contractVersion',
      'consumerId',
      'consumerVersion',
      'correlationId',
      'requestKind',
      'bookId',
      'editionId'
    ],
    outboundRequired: [
      'contractId',
      'contractVersion',
      'entitySchemaVersion',
      'correlationId',
      'generatedAt',
      'bookId',
      'editionId',
      'route'
    ],
    outboundOptionalGroups: [
      'effective-metadata',
      'relationships',
      'workflow-categories',
      'dates',
      'readiness'
    ]
  }
} as const;

/** Stable release invariant used by privacy documentation and automated policy checks. */
export const PRIVACY_STORAGE_POLICY = {
  projectData: 'vault',
  preferences: 'obsidian-local-plugin-data',
  transientData: 'memory-only',
  networkTransmission: 'none',
  telemetry: 'none',
  disableMutation: 'none',
  uninstallMutation: 'none'
} as const;
