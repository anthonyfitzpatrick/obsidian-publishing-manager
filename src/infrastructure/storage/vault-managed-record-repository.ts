/**
 * Implements canonical managed-record persistence over an Obsidian-only text port. The repository
 * is responsible for lossless ownership boundaries: envelope and explicitly changed managed
 * fields may change, while unknown frontmatter and unrelated Markdown body remain intact. Saves
 * use an atomic transform with optimistic revision comparison so external edits never lose a race.
 */

import type {
  LoadedManagedRecord,
  ManagedRecordInspectionPort,
  ManagedRecordPatch,
  ManagedRecordRepositoryPort,
  MarkdownFrontmatterCodec,
  NewManagedRecord,
  VaultTextPort
} from '../../application/storage/record-storage-ports';
import {
  ENVELOPE_FRONTMATTER_KEYS,
  serializeEnvelope,
  validateEnvelope,
  type ManagedRecordEnvelope
} from '../../domain/records/record-envelope';
import { validateRecordSchema } from '../../domain/records/schema-validation';
import { fingerprintSource } from '../../domain/storage/source-fingerprint';
import { parentVaultPath, type VaultPath } from '../../domain/storage/vault-path';

/** Base repository failure with a stable machine-readable classification. */
export class ManagedRecordRepositoryError extends Error {
  /** Preserves a stable error code while keeping the message useful to recovery UI. */
  public constructor(
    public readonly code:
      'record-conflict' | 'record-exists' | 'record-invalid-envelope' | 'record-invalid-schema',
    message: string
  ) {
    super(message);
    this.name = 'ManagedRecordRepositoryError';
  }
}

/** Repository that enforces DAT-004 through DAT-006 at every persistence boundary. */
export class VaultManagedRecordRepository
  implements ManagedRecordRepositoryPort, ManagedRecordInspectionPort
{
  /** Binds platform-free record semantics to an Obsidian text port and frontmatter codec. */
  public constructor(
    private readonly vault: VaultTextPort,
    private readonly codec: MarkdownFrontmatterCodec
  ) {}

  /** Loads, validates, and fingerprints one canonical note without mutating it. */
  public async load(path: VaultPath): Promise<LoadedManagedRecord> {
    const source = await this.vault.read(path);
    return this.hydrate(path, source);
  }

  /**
   * Loads an envelope and lossless field/body snapshot without requiring the current schema. This
   * narrow escape hatch exists only for migration preflight; normal application reads must use
   * `load` so older/future schemas cannot leak into feature behavior.
   */
  public async loadForMigration(path: VaultPath): Promise<LoadedManagedRecord> {
    const source = await this.vault.read(path);
    return this.hydrate(path, source, false);
  }

  /** Catalog-facing alias names the read-only intent without exposing migration vocabulary. */
  public async inspect(path: VaultPath): Promise<LoadedManagedRecord> {
    return this.loadForMigration(path);
  }

  /** Creates a collision-safe new note after validating its complete v1 contract. */
  public async create(path: VaultPath, record: NewManagedRecord): Promise<LoadedManagedRecord> {
    if (await this.vault.exists(path)) {
      throw new ManagedRecordRepositoryError(
        'record-exists',
        `Refusing to overwrite existing vault path ${path}.`
      );
    }

    assertSchemaValid(record.envelope, record.fields);
    const source = this.codec.serialize({
      frontmatter: { ...record.fields, ...serializeEnvelope(record.envelope) },
      body: record.body ?? ''
    });
    const parent = parentVaultPath(path);
    if (parent !== undefined) {
      await this.vault.ensureFolder(parent);
    }
    await this.vault.create(path, source);
    return this.hydrate(path, source);
  }

  /**
   * Applies a minimal atomic patch. The current source is compared inside `process`; an external
   * change raises a conflict before any transformation. A semantic no-op returns the original
   * source and retains its update timestamp and revision.
   */
  public async save(
    loaded: LoadedManagedRecord,
    patch: ManagedRecordPatch,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const result = await this.vault.process(loaded.path, (currentSource) => {
      if (fingerprintSource(currentSource) !== loaded.sourceRevision) {
        throw new ManagedRecordRepositoryError(
          'record-conflict',
          `Record changed outside Publishing Manager: ${loaded.path}. Reload before saving.`
        );
      }

      const currentDocument = this.codec.parse(currentSource);
      const envelope = requireEnvelope(currentDocument.frontmatter);
      const currentFields = extractManagedFields(currentDocument.frontmatter);
      const nextFields = applyFieldPatch(currentFields, patch.fields ?? {});
      const nextBody = patch.body ?? currentDocument.body;

      if (recordsEqual(currentFields, nextFields) && nextBody === currentDocument.body) {
        return currentSource;
      }

      const nextEnvelope: ManagedRecordEnvelope = { ...envelope, updatedAt };
      assertSchemaValid(nextEnvelope, nextFields);
      return this.codec.serialize({
        // Unknown keys survive because the new envelope and explicit field changes are merged
        // over the complete current frontmatter rather than reconstructing a known-key subset.
        frontmatter: mergeFrontmatter(
          currentDocument.frontmatter,
          patch.fields ?? {},
          nextEnvelope
        ),
        body: nextBody
      });
    });
    return this.hydrate(loaded.path, result);
  }

  /**
   * Archives or restores one record by changing only its envelope. The same optimistic transform
   * protects external edits, and an unchanged archive state remains a semantic no-op.
   */
  public async setArchivedAt(
    loaded: LoadedManagedRecord,
    archivedAt: string | undefined,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const result = await this.vault.process(loaded.path, (currentSource) => {
      if (fingerprintSource(currentSource) !== loaded.sourceRevision) {
        throw new ManagedRecordRepositoryError(
          'record-conflict',
          `Record changed outside Publishing Manager: ${loaded.path}. Reload before changing archival state.`
        );
      }

      const currentDocument = this.codec.parse(currentSource);
      const envelope = requireEnvelope(currentDocument.frontmatter);
      if (envelope.archivedAt === archivedAt) {
        return currentSource;
      }
      const activeEnvelope: ManagedRecordEnvelope = {
        pmId: envelope.pmId,
        pmType: envelope.pmType,
        pmSchema: envelope.pmSchema,
        createdAt: envelope.createdAt,
        updatedAt
      };
      const nextEnvelope: ManagedRecordEnvelope = {
        ...activeEnvelope,
        ...(archivedAt === undefined ? {} : { archivedAt })
      };
      const frontmatter: Record<string, unknown> = {
        ...currentDocument.frontmatter,
        ...serializeEnvelope(nextEnvelope)
      };
      if (archivedAt === undefined) {
        delete frontmatter['pm-archived'];
      }
      return this.codec.serialize({ frontmatter, body: currentDocument.body });
    });
    return this.hydrate(loaded.path, result);
  }

  /**
   * Applies one migration result through the same atomic conflict boundary as normal saves. Only
   * the migration runner may intentionally advance `pm-schema`; future or backward versions are
   * rejected by schema validation and preflight before this method is called.
   */
  public async migrate(
    loaded: LoadedManagedRecord,
    nextSchemaVersion: number,
    nextFields: Readonly<Record<string, unknown>>,
    updatedAt: string
  ): Promise<LoadedManagedRecord> {
    const result = await this.vault.process(loaded.path, (currentSource) => {
      if (fingerprintSource(currentSource) !== loaded.sourceRevision) {
        throw new ManagedRecordRepositoryError(
          'record-conflict',
          `Record changed after migration preflight: ${loaded.path}. Rerun preflight.`
        );
      }
      const currentDocument = this.codec.parse(currentSource);
      const envelope = requireEnvelope(currentDocument.frontmatter);
      const nextEnvelope: ManagedRecordEnvelope = {
        ...envelope,
        pmSchema: nextSchemaVersion,
        updatedAt
      };
      assertSchemaValid(nextEnvelope, nextFields);
      return this.codec.serialize({
        // The migration runner supplies a complete field bag and preserves unknown keys itself.
        // Reconstructing from that bag allows retired legacy fields to be removed intentionally.
        frontmatter: { ...nextFields, ...serializeEnvelope(nextEnvelope) },
        body: currentDocument.body
      });
    });
    return this.hydrate(loaded.path, result);
  }

  /** Converts raw text into a record only after envelope and storage schema validation. */
  private hydrate(
    path: VaultPath,
    source: string,
    requireCurrentSchema = true
  ): LoadedManagedRecord {
    const document = this.codec.parse(source);
    const envelope = requireEnvelope(document.frontmatter);
    const fields = extractManagedFields(document.frontmatter);
    if (requireCurrentSchema) {
      assertSchemaValid(envelope, fields);
    }
    return {
      path,
      envelope,
      fields,
      body: document.body,
      sourceRevision: fingerprintSource(source)
    };
  }
}

/** Rejects malformed envelopes with all diagnostic messages retained for repair guidance. */
function requireEnvelope(frontmatter: Readonly<Record<string, unknown>>): ManagedRecordEnvelope {
  const result = validateEnvelope(frontmatter);
  if (!result.valid) {
    throw new ManagedRecordRepositoryError(
      'record-invalid-envelope',
      result.diagnostics.map(({ message }) => message).join(' ')
    );
  }
  return result.envelope;
}

/** Unknown frontmatter remains part of the field bag so round trips cannot discard it. */
function extractManagedFields(
  frontmatter: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const envelopeKeys: ReadonlySet<string> = new Set(ENVELOPE_FRONTMATTER_KEYS);
  return Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !envelopeKeys.has(key)));
}

/** Validates known fields while intentionally permitting unknown extension keys. */
function assertSchemaValid(
  envelope: ManagedRecordEnvelope,
  fields: Readonly<Record<string, unknown>>
): void {
  const diagnostics = validateRecordSchema({ envelope, fields });
  if (diagnostics.length > 0) {
    throw new ManagedRecordRepositoryError(
      'record-invalid-schema',
      diagnostics.map(({ message }) => message).join(' ')
    );
  }
}

/** Applies only named changes; undefined is an explicit deletion request. */
function applyFieldPatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Applies explicit field deletions to the complete frontmatter before restoring the authoritative
 * envelope. This preserves every untouched unknown key while ensuring `undefined` really removes
 * the named field instead of being accidentally resurrected by object spread order.
 */
function mergeFrontmatter(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  envelope: ManagedRecordEnvelope
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return { ...merged, ...serializeEnvelope(envelope) };
}

/** Deterministic deep comparison prevents timestamp-only writes for semantic no-ops. */
function recordsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
