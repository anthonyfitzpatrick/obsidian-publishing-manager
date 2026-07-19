/**
 * Defines the first Publishing Manager ↔ Manuscript Compiler contract. The application talks to a
 * narrow local transport and never imports Compiler code, reaches into another plugin instance,
 * scans manuscripts, or compiles. Stable publishing IDs are the complete request authority.
 */
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import {
  NeverCancelledToken,
  OperationCancelledError,
  type CancellationToken
} from '../../domain/foundation/cancellation';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import type {
  PublishingManagerSettings,
  PublishingSettingsService
} from '../settings/publishing-settings-service';

export const COMPILER_CONTRACT = 'publishing-manager.manuscript-compiler' as const;
export const COMPILER_CONTRACT_VERSION = 1 as const;
export const COMPILER_CAPABILITY_ID = 'manuscript-compiler' as const;
export const COMPILER_MAX_DESCRIPTOR_BYTES = 8_192;
export const COMPILER_MAX_REQUEST_BYTES = 4_096;
export const COMPILER_MAX_ACKNOWLEDGEMENT_BYTES = 4_096;
export const COMPILER_MAX_RESULT_BYTES = 16_384;
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

/** Untrusted provider result after strict correlation, scope, path, and evidence validation. */
export interface CompilerExportResult {
  readonly contract: typeof COMPILER_CONTRACT;
  readonly contractVersion: typeof COMPILER_CONTRACT_VERSION;
  readonly kind: 'export-result';
  readonly correlationId: string;
  readonly providerId: string;
  readonly compilerVersion: string;
  readonly compiledAt: string;
  readonly bookId: string;
  readonly editionId: string;
  readonly semanticFingerprint: string;
  readonly sourceFingerprint: string;
  readonly outputFingerprint: string;
  readonly format: CompilerExportFormat;
  readonly vaultPath: VaultPath;
  readonly warnings: readonly string[];
  readonly historyId: string;
}

export interface CompilerExportEvidence {
  readonly result: CompilerExportResult;
  readonly freshness: 'current' | 'stale';
  readonly freshnessExplanation: string;
  readonly receivedAt: string;
}

export interface CompilerResultState {
  readonly results: readonly CompilerExportEvidence[];
  readonly lastRejected?: string;
}

export interface CompilerRequestControl {
  readonly timeoutMilliseconds?: number;
  readonly cancellation?: CancellationToken;
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
  subscribeResults(listener: (payload: unknown) => void): () => void;
}

/** Host timer boundary keeps application timeout logic deterministic and popout-window safe. */
export interface CompilerTimerPort {
  setTimeout(action: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(action: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
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
  private readonly acceptedRequests = new Map<string, AcceptedCompilerRequest>();
  private readonly resultListeners = new Set<(state: CompilerResultState) => void>();
  private readonly results = new Map<string, CompilerExportEvidence>();
  private stopTransport: (() => void) | undefined;
  private lastRejected: string | undefined;

  public constructor(
    private readonly catalog: CompilerCatalogPort,
    private readonly settings: CompilerSettingsPort | PublishingSettingsService,
    private readonly transport: CompilerCapabilityTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly timers: CompilerTimerPort
  ) {}

  /** Starts one app-lifetime result listener so completion is not dependent on the view being open. */
  public start(): () => void {
    if (this.stopTransport !== undefined) return this.stopTransport;
    const stop = this.transport.subscribeResults((payload) => {
      void this.acceptResult(payload).catch(() => undefined);
    });
    this.stopTransport = () => {
      stop();
      this.stopTransport = undefined;
    };
    return this.stopTransport;
  }

  /** Supplies a deterministic in-memory evidence projection; canonical linking belongs to INT-C-005. */
  public subscribeResults(listener: (state: CompilerResultState) => void): () => void {
    this.resultListeners.add(listener);
    listener(this.resultState());
    return () => this.resultListeners.delete(listener);
  }

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
    const byteCount = jsonBytes(request);
    if (byteCount > COMPILER_MAX_REQUEST_BYTES)
      throw new Error('Compiler request exceeds the 4 KiB local contract limit.');
    return {
      request,
      descriptorFingerprint: negotiation.descriptorFingerprint,
      providerId: negotiation.descriptor.providerId,
      providerVersion: negotiation.descriptor.providerVersion,
      byteCount,
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
    preview: CompilerRequestPreview,
    control: CompilerRequestControl = {}
  ): Promise<CompilerRequestAcknowledgement> {
    const cancellation = control.cancellation ?? new NeverCancelledToken();
    cancellation.throwIfCancellationRequested();
    const negotiation = await this.requireEnabledCapability();
    if (negotiation.descriptorFingerprint !== preview.descriptorFingerprint) {
      throw new Error('Compiler capability changed after preview; review a fresh request.');
    }
    // Re-resolve stable scope immediately before sending; removed or reassigned projects therefore
    // cannot leave Publishing Manager as stale integration requests.
    requireScope(this.catalog.snapshot(), preview.request.bookId, preview.request.editionId);
    cancellation.throwIfCancellationRequested();
    const acknowledgement = parseAcknowledgement(
      await awaitControlledRequest(
        this.transport.request(preview.request),
        control.timeoutMilliseconds ?? 10_000,
        cancellation,
        this.timers
      ),
      preview.request.correlationId,
      negotiation.descriptor.providerId
    );
    cancellation.throwIfCancellationRequested();
    if (acknowledgement.state === 'accepted') {
      this.acceptedRequests.set(preview.request.correlationId, {
        request: structuredClone(preview.request),
        providerId: negotiation.descriptor.providerId,
        providerVersion: negotiation.descriptor.providerVersion,
        descriptorFingerprint: negotiation.descriptorFingerprint
      });
    }
    return acknowledgement;
  }

  /** Validates one asynchronous completion event and derives evidence-only freshness. */
  public async acceptResult(payload: unknown): Promise<CompilerExportEvidence> {
    try {
      const envelope = object(payload);
      const correlationId = boundedText(envelope.correlationId, 200);
      const accepted = this.acceptedRequests.get(correlationId);
      if (accepted === undefined)
        throw new Error('Compiler result has no accepted matching request in this session.');
      const negotiation = await this.requireEnabledCapability();
      if (
        negotiation.descriptorFingerprint !== accepted.descriptorFingerprint ||
        negotiation.descriptor.providerId !== accepted.providerId
      )
        throw new Error('Compiler capability changed before the result arrived.');
      const result = parseResult(payload, accepted);
      requireScope(this.catalog.snapshot(), result.bookId, result.editionId);
      const freshness = deriveCompilerFreshness(
        result.semanticFingerprint,
        result.sourceFingerprint
      );
      const evidence: CompilerExportEvidence = {
        result,
        freshness: freshness.state,
        freshnessExplanation: freshness.explanation,
        receivedAt: this.clock.now().toISOString()
      };
      const key = resultKey(result);
      if (this.results.has(key))
        throw new Error('Duplicate compiler result for this request and format was rejected.');
      this.results.set(key, evidence);
      this.lastRejected = undefined;
      this.publishResults();
      return evidence;
    } catch (error) {
      this.lastRejected = error instanceof Error ? error.message : 'Compiler result was rejected.';
      this.publishResults();
      throw error;
    }
  }

  private resultState(): CompilerResultState {
    return {
      results: [...this.results.values()].sort((left, right) =>
        right.result.compiledAt.localeCompare(left.result.compiledAt)
      ),
      ...(this.lastRejected === undefined ? {} : { lastRejected: this.lastRejected })
    };
  }

  private publishResults(): void {
    const state = this.resultState();
    for (const listener of this.resultListeners) listener(state);
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

interface AcceptedCompilerRequest {
  readonly request: CompilerExportRequest;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly descriptorFingerprint: string;
}

/** Compares the provider's latest semantic evidence with the source evidence used for this output. */
export function deriveCompilerFreshness(
  semanticFingerprint: string,
  sourceFingerprint: string
): { readonly state: 'current' | 'stale'; readonly explanation: string } {
  return semanticFingerprint === sourceFingerprint
    ? {
        state: 'current',
        explanation:
          'Current — the provider’s latest semantic fingerprint matches the source fingerprint recorded for this output.'
      }
    : {
        state: 'stale',
        explanation:
          'Stale — the provider’s latest semantic fingerprint differs from the source fingerprint recorded for this output.'
      };
}

function parseDescriptor(
  value: unknown
):
  | { readonly ok: true; readonly value: CompilerCapabilityDescriptor }
  | { readonly ok: false; readonly reasons: readonly string[] } {
  const item = object(value);
  const reasons: string[] = [];
  if (jsonBytes(value) > COMPILER_MAX_DESCRIPTOR_BYTES)
    reasons.push('Capability descriptor exceeds the 8 KiB local contract limit.');
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
  if (jsonBytes(value) > COMPILER_MAX_ACKNOWLEDGEMENT_BYTES)
    throw new Error('Compiler acknowledgement exceeds the 4 KiB local contract limit.');
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

function parseResult(value: unknown, accepted: AcceptedCompilerRequest): CompilerExportResult {
  if (jsonBytes(value) > COMPILER_MAX_RESULT_BYTES)
    throw new Error('Compiler result exceeds the 16 KiB evidence limit.');
  const item = object(value);
  if (
    item.contract !== COMPILER_CONTRACT ||
    item.contractVersion !== COMPILER_CONTRACT_VERSION ||
    item.kind !== 'export-result'
  )
    throw new Error('Compiler result contract is not recognized.');
  if (
    item.correlationId !== accepted.request.correlationId ||
    item.providerId !== accepted.providerId ||
    item.bookId !== accepted.request.bookId ||
    item.editionId !== accepted.request.editionId
  )
    throw new Error('Compiler result does not match the accepted request scope.');
  const compilerVersion = boundedText(item.compilerVersion, 40);
  if (
    compilerVersion !== accepted.providerVersion ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(compilerVersion)
  )
    throw new Error('Compiler result version does not match the accepted provider.');
  const compiledAt = strictUtcTimestamp(item.compiledAt);
  const semanticFingerprint = evidenceToken(item.semanticFingerprint, 'semantic fingerprint');
  const sourceFingerprint = evidenceToken(item.sourceFingerprint, 'source fingerprint');
  const outputFingerprint = evidenceToken(item.outputFingerprint, 'output fingerprint');
  if (!isCompilerFormat(item.format) || !accepted.request.formats.includes(item.format))
    throw new Error('Compiler result format was not included in the accepted request.');
  const vaultPath = safeResultPath(item.vaultPath);
  const warnings = parseWarnings(item.warnings);
  const historyId = evidenceToken(item.historyId, 'history ID');
  return {
    contract: COMPILER_CONTRACT,
    contractVersion: COMPILER_CONTRACT_VERSION,
    kind: 'export-result',
    correlationId: accepted.request.correlationId,
    providerId: accepted.providerId,
    compilerVersion,
    compiledAt,
    bookId: accepted.request.bookId,
    editionId: accepted.request.editionId,
    semanticFingerprint,
    sourceFingerprint,
    outputFingerprint,
    format: item.format,
    vaultPath,
    warnings,
    historyId
  };
}

function strictUtcTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !value.endsWith('Z'))
    throw new Error('Compiler result timestamp must be bounded UTC ISO text.');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value)
    throw new Error('Compiler result timestamp must be canonical UTC ISO text.');
  return value;
}

function evidenceToken(value: unknown, label: string): string {
  const token = boundedText(value, 200);
  if (token.length === 0 || !/^[0-9A-Za-z][0-9A-Za-z._:+/-]*$/u.test(token))
    throw new Error(`Compiler result ${label} is invalid.`);
  return token;
}

function safeResultPath(value: unknown): VaultPath {
  if (typeof value !== 'string' || value.length > 500)
    throw new Error('Compiler result vault path is invalid.');
  try {
    return normalizeVaultPath(value);
  } catch {
    throw new Error('Compiler result vault path is not a safe vault-relative path.');
  }
}

function parseWarnings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('Compiler result warnings must be a list of at most 20 messages.');
  const warnings = value.map((warning) => boundedText(warning, 500));
  if (warnings.some((warning) => warning.length === 0))
    throw new Error('Compiler result warning is invalid.');
  return warnings;
}

function resultKey(result: CompilerExportResult): string {
  return `${result.correlationId}:${result.format}`;
}

/** Bounds a provider Promise and polls cooperative cancellation without provider-specific APIs. */
function awaitControlledRequest(
  request: Promise<unknown>,
  timeoutMilliseconds: number,
  cancellation: CancellationToken,
  timers: CompilerTimerPort
): Promise<unknown> {
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 60_000
  )
    throw new Error('Compiler request timeout must be between 1 and 60000 milliseconds.');
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      timers.clearInterval(cancellationPoll);
      action();
    };
    const timeout = timers.setTimeout(
      () => finish(() => reject(new Error('Compiler request timed out without acknowledgement.'))),
      timeoutMilliseconds
    );
    const cancellationPoll = timers.setInterval(() => {
      if (cancellation.isCancellationRequested) finish(() => reject(new OperationCancelledError()));
    }, 25);
    request.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) =>
        finish(() => reject(error instanceof Error ? error : new Error('Compiler request failed.')))
    );
  });
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

/** Measures JSON data without trusting provider prototypes or allowing cyclic object graphs. */
function jsonBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
