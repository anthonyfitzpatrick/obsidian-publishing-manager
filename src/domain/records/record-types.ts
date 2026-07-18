/**
 * Defines the complete vocabulary of canonical Publishing Manager records introduced by
 * DAT-002. Keeping this list in the domain layer gives validation, migrations, indexes,
 * repositories, and future UI code one dependency-free authority for persisted type names.
 * The string values are storage contracts: renaming one requires a migration rather than a
 * TypeScript-only refactor.
 */

/** Every record type supported by the first version of the canonical storage contract. */
export const MANAGED_RECORD_TYPES = [
  'series',
  'book',
  'edition',
  'format',
  'platform-target',
  'metadata-set',
  'isbn',
  'task',
  'launch',
  'review',
  'asset-reference',
  'history-event',
  'sales-source',
  'sales-line',
  'sales-correction'
] as const;

/** Stable persisted discriminator used by envelopes, schema lookup, and indexes. */
export type ManagedRecordType = (typeof MANAGED_RECORD_TYPES)[number];

/**
 * Returns whether untrusted frontmatter contains a recognized record discriminator.
 * The explicit membership check prevents arbitrary strings from crossing into domain code.
 */
export function isManagedRecordType(value: unknown): value is ManagedRecordType {
  return typeof value === 'string' && MANAGED_RECORD_TYPES.some((type) => type === value);
}
