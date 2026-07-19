/**
 * Defines the first Publishing Manager ↔ Manuscript Compiler contract. The application talks to a
 * narrow local transport and never imports Compiler code, reaches into another plugin instance,
 * scans manuscripts, or compiles. Stable publishing IDs are the complete request authority.
 */
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import type {
  PublishingManagerSettings,
  PublishingSettingsService
} from '../settings/publishing-settings-service';

export const COMPILER_CONTRACT = 'publishing-manager.manuscript-compiler' as const;
export const COMPILER_CONTRACT_VERSION = 1 as const;
export const COMPILER_CAPABILITY_ID = 'manuscript-compiler' as const;
export const COMPILER_EXPORT_FORMATS = ['docx', 'odt', 'epub', 'html', 'markdown', 'xml'] as const;
export type CompilerExportFormat = (typeof COMPILER_EXPORT_FORMATS)[number];

export interface CompilerCapabilityDescriptor {
  readonly contract: typeof COMPILER_CONTRACT;
  readonly contractVersion: number;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly supportedFormats: readonly CompilerExportFormat[];
  readonly requestMode: 'local-event';
  readonly deliveryMode: 'host-download' | 'vault-reference';
}

export type CompilerNegotiation =
  | { readonly state: 'absent'; readonly explanation: string }
  | { readonly state: 'ambiguous'; readonly explanation: string }
  | {
      readonly state: 'incompatible';
      readonly explanation: string;
      readonly reasons: readonly string[];
    }
  | {
      readonly state: 'compatible';
      readonly enabled: boolean;
      readonly descriptor: CompilerCapabilityDescriptor;
      readonly descriptorFingerprint: string;
      readonly explanation: string;
      readonly exchangedFields: readonly string[];
    };

export interface CompilerExportRequest {
  readonly contract: typeof COMPILER_CONTRACT;
  readonly contractVersion: typeof COMPILER_CONTRACT_VERSION;
  readonly kind: 'export-request';
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly bookId: string;
  readonly editionId: string;
  readonly formats: readonly CompilerExportFormat[];
}

export interface CompilerRequestPreview {
  readonly request: CompilerExportRequest;
  readonly descriptorFingerprint: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly byteCount: number;
  readonly exchangedFields: readonly string[];
  readonly consequences: readonly string[];
}

export type CompilerRequestAcknowledgement =
  | {
      readonly state: 'accepted';
      readonly correlationId: string;
      readonly providerId: string;
      readonly message: string;
    }
  | {
      readonly state: 'declined';
      readonly correlationId: string;
      readonly providerId: string;
      readonly reason: string;
    };

export interface CompilerCapabilityTransport {
  discover(): Promise<readonly unknown[]>;
  request(payload: CompilerExportRequest): Promise<unknown>;
}

export interface CompilerCatalogPort {
  snapshot(): BookCatalogSnapshot;
}

export interface CompilerSettingsPort {
  current(): PublishingManagerSettings;
  saveSection(
    section: 'integrations',
    candidate: PublishingManagerSettings['integrations']
  ): Promise<PublishingManagerSettings['integrations']>;
}

/** Owns capability negotiation, opt-in state, preview, and one correlated local request. */
export class ManuscriptCompilerIntegrationService {
  public constructor(
    private readonly catalog: CompilerCatalogPort,
    private readonly settings: CompilerSettingsPort | PublishingSettingsService,
    private readonly transport: CompilerCapabilityTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Discovers declarations every time so disable/reload never leaves a trusted stale reference. */
  public async negotiate(): Promise<CompilerNegotiation> {
    const candidates = await this.transport.discover();
    if (candidates.length === 0) {
      return {
        state: 'absent',
        explanation:
          'No Manuscript Compiler v1 capability responded. Manual asset linking remains fully available.'
      };
    }
    if (candidates.length > 1) {
      return {
        state: 'ambiguous',
        explanation:
          'More than one Manuscript Compiler capability responded, so Publishing Manager will not choose one.'
      };
    }
    const parsed = parseDescriptor(candidates[0]);
    if (!parsed.ok) {
      return {
        state: 'incompatible',
        explanation:
          'A local provider responded but does not satisfy the Publishing Manager v1 contract.',
        reasons: parsed.reasons
      };
    }
    const enabled = this.settings
      .current()
      .integrations.enabledCapabilities.includes(COMPILER_CAPABILITY_ID);
    return {
      state: 'compatible',
      enabled,
      descriptor: parsed.value,
      descriptorFingerprint: descriptorFingerprint(parsed.value),
      explanation: enabled
        ? 'Compatible local capability detected and explicitly enabled.'
        : 'Compatible local capability detected but disabled until the user opts in.',
      exchangedFields: [
        'contract and contract version',
        'correlation ID and request time',
        'stable book ID',
        'stable edition ID',
        'requested output format names'
      ]
    };
  }

  /** Changes only the named capability switch and preserves every other integration preference. */
  public async setEnabled(enabled: boolean): Promise<void> {
    const current = this.settings.current().integrations;
    const withoutCompiler = current.enabledCapabilities.filter(
      (candidate) => candidate !== COMPILER_CAPABILITY_ID
    );
    await this.settings.saveSection('integrations', {
      ...current,
      enabledCapabilities: enabled ? [...withoutCompiler, COMPILER_CAPABILITY_ID] : withoutCompiler
    });
  }

  /** Plans the complete bounded payload; it sends no titles, paths, prose, settings, or asset data. */
  public async previewRequest(input: {
    readonly bookId: string;
    readonly editionId: string;
    readonly formats: readonly CompilerExportFormat[];
  }): Promise<CompilerRequestPreview> {
    const negotiation = await this.requireEnabledCapability();
    const { book, edition } = requireScope(this.catalog.snapshot(), input.bookId, input.editionId);
    const formats = uniqueFormats(input.formats);
    if (formats.length === 0) throw new Error('Choose at least one compiler output format.');
    const unsupported = formats.filter(
      (format) => !negotiation.descriptor.supportedFormats.includes(format)
    );
    if (unsupported.length > 0) {
      throw new Error(`The detected compiler does not support: ${unsupported.join(', ')}.`);
    }
    const request: CompilerExportRequest = {
      contract: COMPILER_CONTRACT,
      contractVersion: COMPILER_CONTRACT_VERSION,
      kind: 'export-request',
      correlationId: `pm-compile-${this.ids.generate()}`,
      requestedAt: this.clock.now().toISOString(),
      bookId: book.id,
      editionId: edition.id,
      formats
    };
    return {
      request,
      descriptorFingerprint: negotiation.descriptorFingerprint,
      providerId: negotiation.descriptor.providerId,
      providerVersion: negotiation.descriptor.providerVersion,
      byteCount: new TextEncoder().encode(JSON.stringify(request)).byteLength,
      exchangedFields: negotiation.exchangedFields,
      consequences: [
        'Publishing Manager sends stable IDs and requested format names through a local event only.',
        'Publishing Manager does not scan, compile, generate, upload, or download the manuscript.',
        'The compiler may accept or decline; manual asset linking remains available either way.'
      ]
    };
  }

  /** Re-negotiates before dispatch so reload, disable, or provider replacement invalidates preview. */
  public async applyRequest(
    preview: CompilerRequestPreview
  ): Promise<CompilerRequestAcknowledgement> {
    const negotiation = await this.requireEnabledCapability();
    if (negotiation.descriptorFingerprint !== preview.descriptorFingerprint) {
      throw new Error('Compiler capability changed after preview; review a fresh request.');
    }
    // Re-resolve stable scope immediately before sending; removed or reassigned projects therefore
    // cannot leave Publishing Manager as stale integration requests.
    requireScope(this.catalog.snapshot(), preview.request.bookId, preview.request.editionId);
    return parseAcknowledgement(
      await this.transport.request(preview.request),
      preview.request.correlationId,
      negotiation.descriptor.providerId
    );
  }

  private async requireEnabledCapability(): Promise<
    Extract<CompilerNegotiation, { state: 'compatible' }>
  > {
    const negotiation = await this.negotiate();
    if (negotiation.state !== 'compatible') throw new Error(negotiation.explanation);
    if (!negotiation.enabled)
      throw new Error(
        'Enable the detected Manuscript Compiler capability before requesting export.'
      );
    return negotiation;
  }
}

function parseDescriptor(
  value: unknown
):
  | { readonly ok: true; readonly value: CompilerCapabilityDescriptor }
  | { readonly ok: false; readonly reasons: readonly string[] } {
  const item = object(value);
  const reasons: string[] = [];
  if (item.contract !== COMPILER_CONTRACT) reasons.push('Contract identifier is not recognized.');
  if (item.contractVersion !== COMPILER_CONTRACT_VERSION)
    reasons.push(`Contract version must be ${COMPILER_CONTRACT_VERSION}.`);
  const providerId = boundedText(item.providerId, 100);
  if (providerId.length === 0) reasons.push('Provider ID is required.');
  const providerVersion = boundedText(item.providerVersion, 40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(providerVersion))
    reasons.push('Provider version must be semantic x.y.z text.');
  const formats = Array.isArray(item.supportedFormats)
    ? item.supportedFormats.filter(isCompilerFormat)
    : [];
  if (
    !Array.isArray(item.supportedFormats) ||
    formats.length !== item.supportedFormats.length ||
    new Set(formats).size !== formats.length ||
    formats.length === 0
  )
    reasons.push('Supported formats must be a non-empty unique known-format list.');
  if (item.requestMode !== 'local-event') reasons.push('Request mode must be local-event.');
  if (item.deliveryMode !== 'host-download' && item.deliveryMode !== 'vault-reference')
    reasons.push('Delivery mode is not recognized.');
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      contract: COMPILER_CONTRACT,
      contractVersion: COMPILER_CONTRACT_VERSION,
      providerId,
      providerVersion,
      supportedFormats: formats,
      requestMode: 'local-event',
      deliveryMode: item.deliveryMode as CompilerCapabilityDescriptor['deliveryMode']
    }
  };
}

function parseAcknowledgement(
  value: unknown,
  correlationId: string,
  providerId: string
): CompilerRequestAcknowledgement {
  const item = object(value);
  if (
    item.contract !== COMPILER_CONTRACT ||
    item.contractVersion !== COMPILER_CONTRACT_VERSION ||
    item.correlationId !== correlationId ||
    item.providerId !== providerId
  )
    throw new Error('Compiler acknowledgement does not match the reviewed request.');
  if (item.kind === 'request-accepted')
    return {
      state: 'accepted',
      correlationId,
      providerId,
      message: boundedText(item.message, 500) || 'Compiler accepted the local request.'
    };
  if (item.kind === 'request-declined')
    return {
      state: 'declined',
      correlationId,
      providerId,
      reason: boundedText(item.reason, 500) || 'Compiler declined the local request.'
    };
  throw new Error('Compiler acknowledgement kind is not recognized.');
}

function requireScope(
  snapshot: BookCatalogSnapshot,
  bookId: string,
  editionId: string
): { readonly book: CatalogRecord; readonly edition: CatalogRecord } {
  const book = snapshot.books.find(({ id }) => id === bookId);
  if (book === undefined || book.archived) throw new Error('Choose one active canonical book.');
  const edition = snapshot.editions.find(
    ({ id, fields, archived }) => id === editionId && !archived && fields['book-id'] === book.id
  );
  if (edition === undefined) throw new Error('Choose one active edition belonging to the book.');
  return { book, edition };
}

function uniqueFormats(values: readonly CompilerExportFormat[]): readonly CompilerExportFormat[] {
  if (!values.every(isCompilerFormat))
    throw new Error('Requested compiler format is not recognized.');
  return [...new Set(values)].sort();
}
function isCompilerFormat(value: unknown): value is CompilerExportFormat {
  return (
    typeof value === 'string' && (COMPILER_EXPORT_FORMATS as readonly string[]).includes(value)
  );
}
function descriptorFingerprint(value: CompilerCapabilityDescriptor): string {
  return JSON.stringify({
    ...value,
    supportedFormats: [...value.supportedFormats].sort()
  });
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}
