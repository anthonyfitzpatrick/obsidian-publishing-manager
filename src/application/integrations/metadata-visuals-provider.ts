/**
 * Publishes a bounded, read-only projection for optional visualization consumers. The service
 * receives only the disposable catalog and local enablement preference; it has no repository,
 * vault, network, mutation, asset-content, or plugin-instance capability.
 */
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { PublishingManagerSettings } from '../settings/publishing-settings-service';

export const METADATA_VISUALS_CONTRACT = 'publishing-manager.metadata-visuals' as const;
export const METADATA_VISUALS_CONTRACT_VERSION = 1 as const;
export const METADATA_VISUALS_CAPABILITY_ID = 'metadata-visuals' as const;
export const METADATA_VISUALS_MAX_ITEMS = 1_000;
export const METADATA_VISUALS_MAX_REQUEST_BYTES = 4_096;
export const METADATA_VISUALS_MAX_RESPONSE_BYTES = 262_144;

export interface MetadataVisualsProviderDescriptor {
  readonly contract: typeof METADATA_VISUALS_CONTRACT;
  readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
  readonly providerId: 'publishing-manager';
  readonly providerVersion: string;
  readonly access: 'read-only';
  readonly mode: 'local-event';
  readonly enabled: boolean;
  readonly capabilities: readonly ['catalog-summary', 'book-snapshot', 'edition-snapshot'];
  readonly schemaVersions: { readonly catalogSummary: 1; readonly entitySnapshot: 1 };
  readonly limits: {
    readonly maximumCatalogItems: number;
    readonly maximumRequestBytes: number;
    readonly maximumResponseBytes: number;
  };
}

export interface MetadataVisualsRequest {
  readonly contract: typeof METADATA_VISUALS_CONTRACT;
  readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
  readonly kind: 'catalog-summary-request' | 'book-snapshot-request' | 'edition-snapshot-request';
  readonly correlationId: string;
  readonly consumerId: 'metadata-visuals';
  readonly consumerVersion: string;
  readonly bookId?: string;
  readonly editionId?: string;
}

export interface MetadataVisualsCatalogBook {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly archived: boolean;
  readonly editionCount: number;
}

export interface MetadataVisualsCatalogSummary {
  readonly contract: typeof METADATA_VISUALS_CONTRACT;
  readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
  readonly schemaVersion: 1;
  readonly kind: 'catalog-summary';
  readonly correlationId: string;
  readonly generatedAt: string;
  readonly provenance: 'publishing-manager-derived-catalog';
  readonly availability: BookCatalogSnapshot['availability']['state'];
  readonly totals: {
    readonly books: number;
    readonly editions: number;
    readonly activeBooks: number;
    readonly archivedBooks: number;
  };
  readonly truncated: boolean;
  readonly books: readonly MetadataVisualsCatalogBook[];
}

export interface MetadataVisualsEntitySnapshot {
  readonly contract: typeof METADATA_VISUALS_CONTRACT;
  readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
  readonly schemaVersion: 1;
  readonly kind: 'book-snapshot' | 'edition-snapshot';
  readonly correlationId: string;
  readonly generatedAt: string;
  readonly provenance: 'publishing-manager-derived-catalog';
  readonly book: {
    readonly id: string;
    readonly recordSchemaVersion: number;
    readonly sourceRevision: string;
    readonly archived: boolean;
    readonly title: string;
    readonly status: string;
  };
  readonly editions: readonly {
    readonly id: string;
    readonly bookId: string;
    readonly recordSchemaVersion: number;
    readonly sourceRevision: string;
    readonly archived: boolean;
    readonly type: string;
    readonly medium: string;
    readonly status: string;
    readonly revision: number | null;
  }[];
}

export type MetadataVisualsResponse =
  | MetadataVisualsCatalogSummary
  | MetadataVisualsEntitySnapshot
  | {
      readonly contract: typeof METADATA_VISUALS_CONTRACT;
      readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
      readonly kind: 'provider-error';
      readonly correlationId: string;
      readonly code: 'disabled' | 'invalid-request' | 'not-found' | 'response-too-large';
      readonly message: string;
    };

export interface MetadataVisualsCatalogPort {
  snapshot(): BookCatalogSnapshot;
}

export interface MetadataVisualsSettingsPort {
  current(): PublishingManagerSettings;
}

/** Generates only normalized JSON-safe read models and never returns catalog field bags directly. */
export class MetadataVisualsProviderService {
  public constructor(
    private readonly catalog: MetadataVisualsCatalogPort,
    private readonly settings: MetadataVisualsSettingsPort,
    private readonly clock: Clock,
    private readonly providerVersion: string
  ) {
    if (!semanticVersion(providerVersion))
      throw new Error('Publishing Manager provider version must be semantic x.y.z text.');
  }

  public descriptor(): MetadataVisualsProviderDescriptor {
    return {
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
      providerId: 'publishing-manager',
      providerVersion: this.providerVersion,
      access: 'read-only',
      mode: 'local-event',
      enabled: this.enabled(),
      capabilities: ['catalog-summary', 'book-snapshot', 'edition-snapshot'],
      schemaVersions: { catalogSummary: 1, entitySnapshot: 1 },
      limits: {
        maximumCatalogItems: METADATA_VISUALS_MAX_ITEMS,
        maximumRequestBytes: METADATA_VISUALS_MAX_REQUEST_BYTES,
        maximumResponseBytes: METADATA_VISUALS_MAX_RESPONSE_BYTES
      }
    };
  }

  /** Validates an untrusted consumer request before selecting one bounded projection. */
  public handle(value: unknown): MetadataVisualsResponse {
    const parsed = parseRequest(value);
    if (!parsed.ok) return errorResponse(parsed.correlationId, 'invalid-request', parsed.message);
    const request = parsed.request;
    if (!this.enabled())
      return errorResponse(
        request.correlationId,
        'disabled',
        'Metadata Visuals read access is disabled in Publishing Manager settings.'
      );
    const snapshot = this.catalog.snapshot();
    let response: MetadataVisualsResponse;
    if (request.kind === 'catalog-summary-request') {
      response = this.catalogSummary(snapshot, request.correlationId);
    } else {
      const book = snapshot.books.find(({ id }) => id === request.bookId);
      const editions = snapshot.editions.filter(({ fields }) => fields['book-id'] === book?.id);
      const selected =
        request.kind === 'edition-snapshot-request'
          ? editions.filter(({ id }) => id === request.editionId)
          : editions;
      if (
        book === undefined ||
        (request.kind === 'edition-snapshot-request' && selected.length !== 1)
      )
        return errorResponse(
          request.correlationId,
          'not-found',
          'The requested canonical book or edition is unavailable.'
        );
      response = this.entitySnapshot(request, book, selected);
    }
    return responseBytes(response) <= METADATA_VISUALS_MAX_RESPONSE_BYTES
      ? response
      : errorResponse(
          request.correlationId,
          'response-too-large',
          'The normalized response exceeds the contract limit.'
        );
  }

  private catalogSummary(
    snapshot: BookCatalogSnapshot,
    correlationId: string
  ): MetadataVisualsCatalogSummary {
    const books = snapshot.books.slice(0, METADATA_VISUALS_MAX_ITEMS).map((book) => ({
      id: book.id,
      title: text(book.fields.title, 300, 'Untitled book'),
      status: text(book.fields.status, 80, 'unknown'),
      archived: book.archived,
      editionCount: snapshot.editions.filter(({ fields }) => fields['book-id'] === book.id).length
    }));
    return {
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
      schemaVersion: 1,
      kind: 'catalog-summary',
      correlationId,
      generatedAt: this.clock.now().toISOString(),
      provenance: 'publishing-manager-derived-catalog',
      availability: snapshot.availability.state,
      totals: {
        books: snapshot.books.length,
        editions: snapshot.editions.length,
        activeBooks: snapshot.books.filter(({ archived }) => !archived).length,
        archivedBooks: snapshot.books.filter(({ archived }) => archived).length
      },
      truncated: snapshot.books.length > books.length,
      books
    };
  }

  private entitySnapshot(
    request: MetadataVisualsRequest,
    book: CatalogRecord,
    editions: readonly CatalogRecord[]
  ): MetadataVisualsEntitySnapshot {
    return {
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
      schemaVersion: 1,
      kind: request.kind === 'book-snapshot-request' ? 'book-snapshot' : 'edition-snapshot',
      correlationId: request.correlationId,
      generatedAt: this.clock.now().toISOString(),
      provenance: 'publishing-manager-derived-catalog',
      book: {
        id: book.id,
        recordSchemaVersion: book.schemaVersion,
        sourceRevision: book.sourceRevision,
        archived: book.archived,
        title: text(book.fields.title, 300, 'Untitled book'),
        status: text(book.fields.status, 80, 'unknown')
      },
      editions: editions.slice(0, METADATA_VISUALS_MAX_ITEMS).map((edition) => ({
        id: edition.id,
        bookId: book.id,
        recordSchemaVersion: edition.schemaVersion,
        sourceRevision: edition.sourceRevision,
        archived: edition.archived,
        type: text(edition.fields.type, 80, 'unknown'),
        medium: text(edition.fields.medium, 80, 'unknown'),
        status: text(edition.fields.status, 80, 'unknown'),
        revision:
          typeof edition.fields.revision === 'number' &&
          Number.isSafeInteger(edition.fields.revision)
            ? edition.fields.revision
            : null
      }))
    };
  }

  private enabled(): boolean {
    return this.settings
      .current()
      .integrations.enabledCapabilities.includes(METADATA_VISUALS_CAPABILITY_ID);
  }
}

function parseRequest(
  value: unknown
):
  | { readonly ok: true; readonly request: MetadataVisualsRequest }
  | { readonly ok: false; readonly correlationId: string; readonly message: string } {
  let bytes = Number.POSITIVE_INFINITY;
  try {
    bytes = responseBytes(value);
  } catch {
    // Cyclic or unserializable payloads remain invalid without exposing their contents.
  }
  const item = object(value);
  const correlationId = token(item.correlationId, 200) || 'unavailable';
  const reasons: string[] = [];
  if (bytes > METADATA_VISUALS_MAX_REQUEST_BYTES) reasons.push('Request exceeds 4 KiB.');
  if (item.contract !== METADATA_VISUALS_CONTRACT) reasons.push('Contract is not recognized.');
  if (item.contractVersion !== METADATA_VISUALS_CONTRACT_VERSION)
    reasons.push(`Contract version must be ${METADATA_VISUALS_CONTRACT_VERSION}.`);
  if (
    item.kind !== 'catalog-summary-request' &&
    item.kind !== 'book-snapshot-request' &&
    item.kind !== 'edition-snapshot-request'
  )
    reasons.push('Request kind is not recognized.');
  if (correlationId === 'unavailable') reasons.push('Correlation ID is invalid.');
  if (item.consumerId !== 'metadata-visuals') reasons.push('Consumer ID is not recognized.');
  if (!semanticVersion(item.consumerVersion)) reasons.push('Consumer version is invalid.');
  const bookId = token(item.bookId, 200);
  const editionId = token(item.editionId, 200);
  if (item.kind === 'book-snapshot-request' && !bookId) reasons.push('Book ID is required.');
  if (item.kind === 'edition-snapshot-request' && (!bookId || !editionId))
    reasons.push('Book and edition IDs are required.');
  if (reasons.length > 0) return { ok: false, correlationId, message: reasons.join(' ') };
  return {
    ok: true,
    request: {
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
      kind: item.kind as MetadataVisualsRequest['kind'],
      correlationId,
      consumerId: 'metadata-visuals',
      consumerVersion: item.consumerVersion as string,
      ...(bookId ? { bookId } : {}),
      ...(editionId ? { editionId } : {})
    }
  };
}

function errorResponse(
  correlationId: string,
  code: Extract<MetadataVisualsResponse, { kind: 'provider-error' }>['code'],
  message: string
): Extract<MetadataVisualsResponse, { kind: 'provider-error' }> {
  return {
    contract: METADATA_VISUALS_CONTRACT,
    contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
    kind: 'provider-error',
    correlationId,
    code,
    message
  };
}
function responseBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(serialized).byteLength;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function semanticVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}
function token(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  return result.length > 0 &&
    result.length <= maximum &&
    /^[0-9A-Za-z][0-9A-Za-z._:-]*$/u.test(result)
    ? result
    : '';
}
function text(value: unknown, maximum: number, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maximum)
    : fallback;
}
