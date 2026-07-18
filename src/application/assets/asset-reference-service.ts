/**
 * Coordinates AST-001–AST-008 without taking ownership of production files. Every mutation changes
 * only a canonical Markdown reference. Metadata reads are cheap; full binary reads occur solely in
 * the explicit fingerprint methods and honor the shared cancellation contract before persistence.
 */

import type { BookCatalog } from '../catalog/book-catalog';
import type {
  ContentFingerprintPort,
  ManagedRecordRepositoryPort,
  VaultAssetPort
} from '../storage/record-storage-ports';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import type { CancellationToken } from '../../domain/foundation/cancellation';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import {
  assessAssetFreshness,
  hydrateAssetReference,
  validateAssetReference,
  type AssetFreshnessAssessment,
  type AssetReference,
  type AssetRole
} from '../../domain/assets/asset-reference';

export interface LinkAssetInput {
  readonly bookId: string;
  readonly editionId?: string;
  readonly formatId?: string;
  readonly path: string;
  readonly role: AssetRole;
  readonly sourceFingerprint?: string;
  readonly notes?: string;
  readonly externallyManaged?: boolean;
}

export interface AssetInspection {
  readonly asset: AssetReference;
  readonly assessment: AssetFreshnessAssessment;
  readonly observedModifiedTime?: string;
  readonly observedSize?: number;
}

export interface AssetPathRepairPreview {
  readonly assetId: string;
  readonly recordPath: VaultPath;
  readonly currentPath: string;
  readonly proposedPath?: VaultPath;
  readonly targetExists: boolean;
  readonly status: 'ready' | 'unchanged' | 'invalid' | 'missing-target';
  readonly explanation: string;
}

export class AssetReferenceServiceError extends Error {
  public constructor(
    public readonly code:
      | 'asset-invalid'
      | 'asset-link-invalid'
      | 'asset-not-found'
      | 'asset-target-missing'
      | 'record-type-invalid',
    message: string
  ) {
    super(message);
    this.name = 'AssetReferenceServiceError';
  }
}

export class AssetReferenceService {
  private readonly subscribers = new Set<() => void>();

  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly files: VaultAssetPort,
    private readonly fingerprints: ContentFingerprintPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Links one existing file and captures a cheap metadata baseline without reading its content. */
  public async link(input: LinkAssetInput): Promise<AssetReference> {
    this.assertRelationships(input);
    const path = normalizeVaultPath(input.path);
    const observation = await this.files.inspect(path);
    if (!observation.exists)
      throw new AssetReferenceServiceError(
        'asset-target-missing',
        `No vault file exists at ${path}. Link an existing file or restore it first.`
      );
    const fields = storageFields(input, observation.modifiedTime, observation.size);
    assertValid(fields);
    const now = this.now();
    const recordPath = this.layout.collisionSafePath(
      'asset-reference',
      `${roleLabel(input.role)} ${fileName(path)}`,
      this.catalog.knownPaths()
    );
    const loaded = await this.repository.create(recordPath, {
      envelope: {
        pmId: createAssetId(this.ids.generate()),
        pmType: 'asset-reference',
        pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now
      },
      fields,
      body: '# Asset reference notes\n\nThe linked production file remains in its original vault location.\n'
    });
    this.catalog.accept(loaded, 'created');
    this.publish();
    return hydrateAssetReference(loaded);
  }

  /** Repoints one retained identity after validating the new target; no asset bytes are copied. */
  public async relink(recordPath: VaultPath, nextPathInput: string): Promise<AssetReference> {
    const loaded = await this.requireAsset(recordPath);
    const nextPath = normalizeVaultPath(nextPathInput);
    const observation = await this.files.inspect(nextPath);
    if (!observation.exists)
      throw new AssetReferenceServiceError(
        'asset-target-missing',
        `No vault file exists at ${nextPath}.`
      );
    const saved = await this.repository.save(
      loaded,
      {
        fields: {
          path: nextPath,
          'modified-time': observation.modifiedTime,
          size: observation.size,
          fingerprint: undefined
        }
      },
      this.now()
    );
    this.catalog.accept(saved, 'modified');
    this.publish();
    return hydrateAssetReference(saved);
  }

  /** Computes current derived state from live host evidence; it never writes merely for viewing. */
  public async inspect(record: CatalogRecord): Promise<AssetInspection> {
    if (record.type !== 'asset-reference')
      throw new AssetReferenceServiceError(
        'record-type-invalid',
        'The selected catalog record is not an asset reference.'
      );
    const asset = hydrateCatalogAsset(record);
    const observation = await this.files.inspect(normalizeVaultPath(asset.path));
    return {
      asset,
      assessment: assessAssetFreshness(asset, observation),
      ...(observation.modifiedTime === undefined
        ? {}
        : { observedModifiedTime: observation.modifiedTime }),
      ...(observation.size === undefined ? {} : { observedSize: observation.size })
    };
  }

  /** Refreshes only metadata baseline evidence; content remains unread. */
  public async acceptCurrentMetadata(recordPath: VaultPath): Promise<AssetReference> {
    const loaded = await this.requireAsset(recordPath);
    const asset = hydrateAssetReference(loaded);
    const observation = await this.files.inspect(normalizeVaultPath(asset.path));
    if (!observation.exists)
      throw new AssetReferenceServiceError(
        'asset-target-missing',
        `No vault file exists at ${asset.path}.`
      );
    const saved = await this.repository.save(
      loaded,
      {
        fields: {
          'modified-time': observation.modifiedTime,
          size: observation.size,
          fingerprint: undefined
        }
      },
      this.now()
    );
    this.catalog.accept(saved, 'modified');
    this.publish();
    return hydrateAssetReference(saved);
  }

  /** Opt-in binary read establishes a cached SHA-256 baseline and remains cancellable. */
  public async captureFingerprint(
    recordPath: VaultPath,
    cancellation: CancellationToken
  ): Promise<AssetReference> {
    cancellation.throwIfCancellationRequested();
    const loaded = await this.requireAsset(recordPath);
    const asset = hydrateAssetReference(loaded);
    const path = normalizeVaultPath(asset.path);
    const observation = await this.files.inspect(path);
    if (!observation.exists)
      throw new AssetReferenceServiceError(
        'asset-target-missing',
        `No vault file exists at ${path}.`
      );
    cancellation.throwIfCancellationRequested();
    const content = await this.files.readBinary(path);
    cancellation.throwIfCancellationRequested();
    const fingerprint = await this.fingerprints.sha256(content);
    cancellation.throwIfCancellationRequested();
    const saved = await this.repository.save(
      loaded,
      {
        fields: { fingerprint, 'modified-time': observation.modifiedTime, size: observation.size }
      },
      this.now()
    );
    this.catalog.accept(saved, 'modified');
    this.publish();
    return hydrateAssetReference(saved);
  }

  /** Explicit verification reads content but retains the cached baseline for honest comparison. */
  public async verifyFingerprint(
    record: CatalogRecord,
    cancellation: CancellationToken
  ): Promise<AssetInspection> {
    const asset = hydrateCatalogAsset(record);
    const path = normalizeVaultPath(asset.path);
    const observation = await this.files.inspect(path);
    if (!observation.exists) return { asset, assessment: assessAssetFreshness(asset, observation) };
    cancellation.throwIfCancellationRequested();
    const content = await this.files.readBinary(path);
    cancellation.throwIfCancellationRequested();
    const verifiedFingerprint = await this.fingerprints.sha256(content);
    cancellation.throwIfCancellationRequested();
    return {
      asset,
      assessment: assessAssetFreshness(asset, { ...observation, verifiedFingerprint }),
      ...(observation.modifiedTime === undefined
        ? {}
        : { observedModifiedTime: observation.modifiedTime }),
      ...(observation.size === undefined ? {} : { observedSize: observation.size })
    };
  }

  /** Updates exact resolvable references after an Obsidian rename/move event. */
  public async handleRename(previousPathInput: string, nextPathInput: string): Promise<number> {
    let previousPath: VaultPath;
    let nextPath: VaultPath;
    try {
      previousPath = normalizeVaultPath(previousPathInput);
      nextPath = normalizeVaultPath(nextPathInput);
    } catch {
      return 0;
    }
    const matches = this.catalog
      .recordsOfType('asset-reference')
      .filter((record) => record.fields.path === previousPath);
    for (const match of matches) {
      const loaded = await this.requireAsset(match.path);
      const saved = await this.repository.save(loaded, { fields: { path: nextPath } }, this.now());
      this.catalog.accept(saved, 'modified');
    }
    if (matches.length > 0) this.publish();
    return matches.length;
  }

  /** Produces a non-mutating folder-prefix repair plan so every target is reviewable first. */
  public async previewPathRepair(
    bookId: string,
    previousPrefix: string,
    nextPrefix: string
  ): Promise<readonly AssetPathRepairPreview[]> {
    const records = this.catalog
      .recordsOfType('asset-reference')
      .filter(
        (record) =>
          record.fields['book-id'] === bookId &&
          typeof record.fields.path === 'string' &&
          (record.fields.path === previousPrefix ||
            record.fields.path.startsWith(`${previousPrefix}/`))
      );
    const previews: AssetPathRepairPreview[] = [];
    for (const record of records) {
      const currentPath = record.fields.path as string;
      let proposedPath: VaultPath;
      try {
        proposedPath = normalizeVaultPath(
          `${nextPrefix}${currentPath.slice(previousPrefix.length)}`
        );
      } catch {
        previews.push({
          assetId: record.id,
          recordPath: record.path,
          currentPath,
          targetExists: false,
          status: 'invalid',
          explanation: 'The proposed vault path is unsafe.'
        });
        continue;
      }
      if (proposedPath === currentPath) {
        previews.push({
          assetId: record.id,
          recordPath: record.path,
          currentPath,
          proposedPath,
          targetExists: true,
          status: 'unchanged',
          explanation: 'The proposed path is unchanged.'
        });
        continue;
      }
      const evidence = await this.files.inspect(proposedPath);
      previews.push({
        assetId: record.id,
        recordPath: record.path,
        currentPath,
        proposedPath,
        targetExists: evidence.exists,
        status: evidence.exists ? 'ready' : 'missing-target',
        explanation: evidence.exists
          ? 'Target exists; review and relink this reference.'
          : 'No file exists at the proposed target.'
      });
    }
    return previews;
  }

  public subscribe(subscriber: () => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
  public notifyFileChanged(): void {
    this.publish();
  }

  private async requireAsset(path: VaultPath) {
    const loaded = await this.repository.load(path);
    if (loaded.envelope.pmType !== 'asset-reference')
      throw new AssetReferenceServiceError(
        'record-type-invalid',
        'The selected record is not an asset reference.'
      );
    return loaded;
  }
  private assertRelationships(input: LinkAssetInput): void {
    const book = this.catalog.recordById(input.bookId);
    if (book?.type !== 'book')
      throw new AssetReferenceServiceError('asset-link-invalid', 'Choose a valid book.');
    const edition =
      input.editionId === undefined ? undefined : this.catalog.recordById(input.editionId);
    if (
      input.editionId !== undefined &&
      (edition === undefined ||
        edition.type !== 'edition' ||
        edition.fields['book-id'] !== input.bookId)
    )
      throw new AssetReferenceServiceError(
        'asset-link-invalid',
        'The edition must belong to the selected book.'
      );
    const format =
      input.formatId === undefined ? undefined : this.catalog.recordById(input.formatId);
    if (
      input.formatId !== undefined &&
      (format === undefined ||
        format.type !== 'format' ||
        format.fields['edition-id'] !== input.editionId)
    )
      throw new AssetReferenceServiceError(
        'asset-link-invalid',
        'The format must belong to the selected edition.'
      );
  }
  private now(): string {
    return this.clock.now().toISOString();
  }
  private publish(): void {
    for (const subscriber of this.subscribers) subscriber();
  }
}

function storageFields(
  input: LinkAssetInput,
  modifiedTime?: string,
  size?: number
): Readonly<Record<string, unknown>> {
  return {
    'book-id': input.bookId,
    ...(input.editionId === undefined ? {} : { 'edition-id': input.editionId }),
    ...(input.formatId === undefined ? {} : { 'format-id': input.formatId }),
    path: normalizeVaultPath(input.path),
    role: input.role,
    ...(modifiedTime === undefined ? {} : { 'modified-time': modifiedTime }),
    ...(size === undefined ? {} : { size }),
    ...(input.sourceFingerprint === undefined
      ? {}
      : { 'source-fingerprint': input.sourceFingerprint }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.externallyManaged === true ? { 'externally-managed': true } : {})
  };
}
function assertValid(fields: Readonly<Record<string, unknown>>): void {
  const diagnostics = validateAssetReference(fields);
  if (diagnostics.length > 0)
    throw new AssetReferenceServiceError(
      'asset-invalid',
      diagnostics.map(({ message }) => message).join(' ')
    );
}
function hydrateCatalogAsset(record: CatalogRecord): AssetReference {
  return hydrateAssetReference({
    envelope: {
      pmId: record.id,
      pmType: 'asset-reference',
      pmSchema: record.schemaVersion,
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z',
      ...(record.archived ? { archivedAt: '2000-01-01T00:00:00.000Z' } : {})
    },
    fields: record.fields
  });
}
function roleLabel(role: AssetRole): string {
  return role
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Prefixes opaque generator output using the envelope-wide stable identity vocabulary. */
function createAssetId(generated: string): string {
  const opaque = generated
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (opaque.length < 8) {
    throw new AssetReferenceServiceError(
      'asset-invalid',
      'Identity generator returned an invalid value.'
    );
  }
  return `pm-asset-reference-${opaque}`;
}
