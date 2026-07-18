/**
 * Defines narrow application ports for canonical Markdown records. The repository depends on
 * text and frontmatter capabilities rather than Obsidian classes, keeping domain/application
 * tests deterministic while the production adapter remains the only layer that touches Vault
 * and FileManager APIs. No port exposes operating-system paths or Node filesystem behavior.
 */

import type { VaultPath } from '../../domain/storage/vault-path';
import type { ManagedRecordEnvelope } from '../../domain/records/record-envelope';

/** Parsed canonical note with frontmatter values and body kept as separate ownership regions. */
export interface ParsedMarkdownDocument {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** Codec boundary allows production to use Obsidian's supported YAML parser/serializer. */
export interface MarkdownFrontmatterCodec {
  /** Parses one complete managed note without changing its body. */
  parse(source: string): ParsedMarkdownDocument;
  /** Serializes frontmatter and appends the supplied body unchanged. */
  serialize(document: ParsedMarkdownDocument): string;
}

/**
 * Minimum vault operations required by the record repository. `process` must provide one
 * read-transform-write transaction so conflict comparison and the final write see the same
 * source revision. Implementations return the resulting text for deterministic follow-up state.
 */
export interface VaultTextPort {
  /** Reports whether any vault entry already owns the safe target. */
  exists(path: VaultPath): Promise<boolean>;
  /** Reads one safe vault-relative text file. */
  read(path: VaultPath): Promise<string>;
  /** Creates one new file and never overwrites an existing target. */
  create(path: VaultPath, source: string): Promise<void>;
  /** Atomically transforms the latest source and returns the resulting text. */
  process(path: VaultPath, transform: (current: string) => string): Promise<string>;
  /** Ensures a safe vault-relative folder hierarchy exists. */
  ensureFolder(path: VaultPath): Promise<void>;
}

/** Hydrated canonical record plus the exact revision required for the next optimistic save. */
export interface LoadedManagedRecord {
  readonly path: VaultPath;
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly sourceRevision: string;
}

/** New record supplied after identity generation and business validation. */
export interface NewManagedRecord {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Explicit patch; `undefined` removes only the named non-envelope field. */
export interface ManagedRecordPatch {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/**
 * Application-facing canonical repository contract. Implementations must use host-supported vault
 * APIs, preserve unknown data, and enforce optimistic revisions; callers never depend on an
 * Obsidian class or infrastructure implementation.
 */
export interface ManagedRecordRepositoryPort {
  /** Loads a current-schema record with an optimistic source revision. */
  load(path: VaultPath): Promise<LoadedManagedRecord>;
  /** Creates a validated record at a caller-selected collision-free path. */
  create(path: VaultPath, record: NewManagedRecord): Promise<LoadedManagedRecord>;
  /** Atomically applies an explicit lossless patch when the source revision still matches. */
  save(
    loaded: LoadedManagedRecord,
    patch: ManagedRecordPatch,
    updatedAt: string
  ): Promise<LoadedManagedRecord>;
  /** Changes only archival envelope state while retaining identity and user-owned note content. */
  setArchivedAt(
    loaded: LoadedManagedRecord,
    archivedAt: string | undefined,
    updatedAt: string
  ): Promise<LoadedManagedRecord>;
}

/**
 * Narrow read-only inspection capability for catalog and migration preflight. It accepts a
 * supported envelope without requiring the current field schema, allowing future or damaged
 * records to become actionable diagnostics instead of disappearing from the catalog.
 */
export interface ManagedRecordInspectionPort {
  /** Loads envelope, complete field bag, body, and source revision without current-schema coercion. */
  inspect(path: VaultPath): Promise<LoadedManagedRecord>;
}
