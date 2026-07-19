/**
 * Publishes a bounded, read-only projection for optional visualization consumers. The service
 * receives only the disposable catalog, local enablement preference, and already-redacted
 * metadata/readiness/date ports; it has no repository, vault, network, mutation, asset-content,
 * or plugin-instance capability.
 */
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { ReadinessEvaluation } from '../../domain/readiness/readiness-engine';
import type { ResolvedMetadataProject } from '../metadata/metadata-project-service';
import {
  type MetadataVisualsOptionalFieldGroup,
  type PublishingManagerSettings
} from '../settings/publishing-settings-service';

export const METADATA_VISUALS_CONTRACT = 'publishing-manager.metadata-visuals' as const;
export const METADATA_VISUALS_CONTRACT_VERSION = 1 as const;
export const METADATA_VISUALS_CAPABILITY_ID = 'metadata-visuals' as const;
export const METADATA_VISUALS_MAX_ITEMS = 1_000;
export const METADATA_VISUALS_MAX_REQUEST_BYTES = 4_096;
export const METADATA_VISUALS_MAX_RESPONSE_BYTES = 262_144;

export const METADATA_VISUALS_FIELD_GROUP_DISCLOSURE = [
  {
    id: 'identity',
    label: 'Identity and route',
    description:
      'Stable book/edition identity, safe labels/status, schema revisions, and an inert Publishing Manager deep link.',
    optional: false
  },
  {
    id: 'effective-metadata',
    label: 'Effective metadata and completeness',
    description:
      'Allowlisted non-description bibliographic values, provenance, and completeness counts.',
    optional: true
  },
  {
    id: 'relationships',
    label: 'Relationships',
    description: 'Stable related record identities only; no vault paths or record bodies.',
    optional: true
  },
  {
    id: 'workflow-categories',
    label: 'Workflow categories',
    description: 'Stage-category and task-status counts without task or stage prose.',
    optional: true
  },
  {
    id: 'dates',
    label: 'Dates',
    description: 'Date kind, date-only value, and source identity without event titles.',
    optional: true
  },
  {
    id: 'readiness',
    label: 'Readiness',
    description: 'Readiness pack, score/confidence, and rule states without evidence or remedies.',
    optional: true
  }
] as const;

export interface MetadataVisualsProviderDescriptor {
  readonly contract: typeof METADATA_VISUALS_CONTRACT;
  readonly contractVersion: typeof METADATA_VISUALS_CONTRACT_VERSION;
  readonly providerId: 'publishing-manager';
  readonly providerVersion: string;
  readonly access: 'read-only';
  readonly mode: 'local-event';
  readonly enabled: boolean;
  readonly capabilities: readonly ['catalog-summary', 'book-snapshot', 'edition-snapshot'];
  readonly schemaVersions: { readonly catalogSummary: 1; readonly entitySnapshot: 2 };
  readonly fieldGroups: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly optional: boolean;
    readonly enabled: boolean;
  }[];
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
  readonly schemaVersion: 2;
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
  readonly deepLink: MetadataVisualsDeepLink;
  readonly operational: {
    readonly scope: { readonly kind: 'book' | 'edition'; readonly id: string };
    readonly enabledFieldGroups: readonly MetadataVisualsOptionalFieldGroup[];
    readonly effectiveMetadata?: MetadataVisualsMetadataProjection;
    readonly relationships?: MetadataVisualsRelationshipProjection;
    readonly workflowCategories?: readonly MetadataVisualsWorkflowCategory[];
    readonly dates?: readonly MetadataVisualsDateProjection[];
    readonly readiness?: MetadataVisualsReadinessProjection;
  };
}

/** Route data can ask Publishing Manager to navigate, but carries no command or mutation payload. */
export interface MetadataVisualsDeepLink {
  readonly scheme: 'obsidian';
  readonly action: 'publishing-manager';
  readonly route: 'book-workspace';
  readonly bookId: string;
  readonly editionId?: string;
  readonly tab: 'overview' | 'editions';
  readonly uri: string;
}

/** The allowlisted metadata projection intentionally omits both description fields and raw values. */
export interface MetadataVisualsMetadataProjection {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly completeness: {
    readonly complete: boolean;
    readonly present: number;
    readonly required: number;
    readonly percent: number;
    readonly missing: readonly string[];
  };
  readonly fields: readonly {
    readonly key: string;
    readonly source: 'book' | 'edition';
    readonly value:
      string | number | readonly string[] | readonly Readonly<Record<string, unknown>>[];
  }[];
}

export interface MetadataVisualsRelationshipProjection {
  readonly bookId: string;
  readonly editionIds: readonly string[];
  readonly formatIds: readonly string[];
  readonly metadataSetIds: readonly string[];
  readonly isbnIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly launchIds: readonly string[];
  readonly platformTargetIds: readonly string[];
}

export interface MetadataVisualsWorkflowCategory {
  readonly category: string;
  readonly stages: number;
  readonly tasks: {
    readonly total: number;
    readonly notStarted: number;
    readonly active: number;
    readonly done: number;
    readonly cancelled: number;
  };
}

export interface MetadataVisualsDateProjection {
  readonly kind: 'launch' | 'preorder' | 'price' | 'publication' | 'task';
  readonly date: string;
  readonly entityId: string;
}

export interface MetadataVisualsReadinessProjection {
  readonly rulePackCode: string;
  readonly rulePackVersion: number;
  readonly evaluatedAt: string;
  readonly state: 'ready' | 'attention' | 'not-ready' | 'unknown';
  readonly score: number | null;
  readonly confidence: number | null;
  readonly rules: readonly {
    readonly code: string;
    readonly state: 'pass' | 'warning' | 'fail' | 'unknown' | 'not-applicable';
    readonly severity: 'advisory' | 'required' | 'blocking';
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
      readonly code:
        | 'disabled'
        | 'invalid-request'
        | 'not-found'
        | 'projection-unavailable'
        | 'response-too-large';
      readonly message: string;
    };

export interface MetadataVisualsCatalogPort {
  snapshot(): BookCatalogSnapshot;
}

export interface MetadataVisualsSettingsPort {
  current(): PublishingManagerSettings;
}

/** Narrow ports return already-redacted projections, never their source services or raw records. */
export interface MetadataVisualsMetadataPort {
  resolve(bookId: string, editionId?: string): MetadataVisualsMetadataProjection;
}
export interface MetadataVisualsReadinessPort {
  evaluate(bookId: string, editionId?: string): Promise<MetadataVisualsReadinessProjection>;
}
export interface MetadataVisualsDatesPort {
  events(bookId: string): readonly MetadataVisualsDateProjection[];
}

/** Generates only normalized JSON-safe read models and never returns catalog field bags directly. */
export class MetadataVisualsProviderService {
  public constructor(
    private readonly catalog: MetadataVisualsCatalogPort,
    private readonly settings: MetadataVisualsSettingsPort,
    private readonly clock: Clock,
    private readonly providerVersion: string,
    private readonly metadata: MetadataVisualsMetadataPort,
    private readonly readiness: MetadataVisualsReadinessPort,
    private readonly dates: MetadataVisualsDatesPort
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
      schemaVersions: { catalogSummary: 1, entitySnapshot: 2 },
      fieldGroups: METADATA_VISUALS_FIELD_GROUP_DISCLOSURE.map((group) => ({
        ...group,
        enabled: !group.optional || this.fieldGroupEnabled(group.id)
      })),
      limits: {
        maximumCatalogItems: METADATA_VISUALS_MAX_ITEMS,
        maximumRequestBytes: METADATA_VISUALS_MAX_REQUEST_BYTES,
        maximumResponseBytes: METADATA_VISUALS_MAX_RESPONSE_BYTES
      }
    };
  }

  /** Validates an untrusted consumer request before selecting one bounded projection. */
  public async handle(value: unknown): Promise<MetadataVisualsResponse> {
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
      try {
        response = await this.entitySnapshot(snapshot, request, book, selected);
      } catch {
        // Source-service errors are untrusted and may contain canonical details. The consumer gets
        // only a stable generic failure, while Publishing Manager records remain untouched.
        return errorResponse(
          request.correlationId,
          'projection-unavailable',
          'The requested operational projection is temporarily unavailable.'
        );
      }
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

  private async entitySnapshot(
    snapshot: BookCatalogSnapshot,
    request: MetadataVisualsRequest,
    book: CatalogRecord,
    editions: readonly CatalogRecord[]
  ): Promise<MetadataVisualsEntitySnapshot> {
    const edition = request.kind === 'edition-snapshot-request' ? editions[0] : undefined;
    const editionId = edition?.id;
    const enabledFieldGroups = this.settings.current().integrations.metadataVisualsFieldGroups;
    const includes = (group: MetadataVisualsOptionalFieldGroup): boolean =>
      enabledFieldGroups.includes(group);
    // Source adapters are invoked only for enabled groups. Turning a group off therefore removes
    // both disclosure and data access, rather than merely hiding an already-fetched result.
    const effectiveMetadata = includes('effective-metadata')
      ? this.metadata.resolve(book.id, editionId)
      : undefined;
    const readiness = includes('readiness')
      ? await this.readiness.evaluate(book.id, editionId)
      : undefined;
    return {
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
      schemaVersion: 2,
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
      editions: editions.slice(0, METADATA_VISUALS_MAX_ITEMS).map((editionRecord) => ({
        id: editionRecord.id,
        bookId: book.id,
        recordSchemaVersion: editionRecord.schemaVersion,
        sourceRevision: editionRecord.sourceRevision,
        archived: editionRecord.archived,
        type: text(editionRecord.fields.type, 80, 'unknown'),
        medium: text(editionRecord.fields.medium, 80, 'unknown'),
        status: text(editionRecord.fields.status, 80, 'unknown'),
        revision:
          typeof editionRecord.fields.revision === 'number' &&
          Number.isSafeInteger(editionRecord.fields.revision)
            ? editionRecord.fields.revision
            : null
      })),
      deepLink: metadataVisualsDeepLink(book.id, editionId),
      operational: {
        scope:
          edition === undefined
            ? { kind: 'book', id: book.id }
            : { kind: 'edition', id: edition.id },
        enabledFieldGroups,
        ...(effectiveMetadata === undefined ? {} : { effectiveMetadata }),
        ...(includes('relationships')
          ? { relationships: relationships(snapshot, book.id, editionId) }
          : {}),
        ...(includes('workflow-categories')
          ? { workflowCategories: workflowCategories(snapshot, book.id, editionId) }
          : {}),
        ...(includes('dates')
          ? { dates: this.dates.events(book.id).slice(0, METADATA_VISUALS_MAX_ITEMS) }
          : {}),
        ...(readiness === undefined ? {} : { readiness })
      }
    };
  }

  private enabled(): boolean {
    return this.settings
      .current()
      .integrations.enabledCapabilities.includes(METADATA_VISUALS_CAPABILITY_ID);
  }

  private fieldGroupEnabled(group: MetadataVisualsOptionalFieldGroup): boolean {
    return this.settings.current().integrations.metadataVisualsFieldGroups.includes(group);
  }
}

/** Builds a percent-encoded navigation-only URI from already-validated canonical identities. */
export function metadataVisualsDeepLink(
  bookId: string,
  editionId?: string
): MetadataVisualsDeepLink {
  const tab = editionId === undefined ? 'overview' : 'editions';
  const query = new URLSearchParams({ route: 'book-workspace', bookId, tab });
  if (editionId !== undefined) query.set('editionId', editionId);
  return {
    scheme: 'obsidian',
    action: 'publishing-manager',
    route: 'book-workspace',
    bookId,
    ...(editionId === undefined ? {} : { editionId }),
    tab,
    uri: `obsidian://publishing-manager?${query.toString()}`
  };
}

export interface PublishingManagerDeepLinkTarget {
  readonly bookId: string;
  readonly editionId?: string;
  readonly tab: 'overview' | 'editions';
}

/**
 * Resolves only the navigation fields generated above. Unknown keys and invalid relationships are
 * rejected so a custom URI cannot smuggle a write command through the navigation handler.
 */
export function resolvePublishingManagerDeepLink(
  parameters: Readonly<Record<string, string>>,
  snapshot: BookCatalogSnapshot
): PublishingManagerDeepLinkTarget | undefined {
  if (Object.keys(parameters).some((key) => !['route', 'bookId', 'editionId', 'tab'].includes(key)))
    return undefined;
  if (parameters.route !== 'book-workspace') return undefined;
  const bookId = token(parameters.bookId, 200);
  if (!bookId || !snapshot.books.some(({ id }) => id === bookId)) return undefined;
  const editionId = token(parameters.editionId, 200);
  if (parameters.editionId !== undefined) {
    const edition = snapshot.editions.find(({ id }) => id === editionId);
    if (edition === undefined || edition.fields['book-id'] !== bookId) return undefined;
  }
  const tab = editionId ? 'editions' : 'overview';
  if (parameters.tab !== tab) return undefined;
  return { bookId, ...(editionId ? { editionId } : {}), tab };
}

/**
 * Converts the full metadata result at the composition boundary. Descriptions are useful
 * publishing prose but are deliberately withheld; completeness may name a missing description
 * field without disclosing its content.
 */
export function projectMetadataForVisuals(
  resolved: ResolvedMetadataProject
): MetadataVisualsMetadataProjection {
  const fields = SAFE_EFFECTIVE_METADATA_FIELDS.flatMap((key) => {
    const field = resolved.effective.fields[key];
    const value = safeMetadataValue(key, field.value);
    return field.source === 'missing' || value === undefined
      ? []
      : [{ key, source: field.source, value }];
  });
  return {
    profileId: resolved.profile.id,
    profileVersion: resolved.profile.version,
    completeness: {
      complete: resolved.coverage.complete,
      present: resolved.coverage.present,
      required: resolved.coverage.required,
      percent: resolved.coverage.percent,
      missing: [...resolved.coverage.missing]
    },
    fields
  };
}

/** Reduces readiness to rule identity/state; evidence prose, remedies, destinations, and overrides stay private. */
export function projectReadinessForVisuals(
  evaluation: ReadinessEvaluation
): MetadataVisualsReadinessProjection {
  return {
    rulePackCode: evaluation.rulePackCode,
    rulePackVersion: evaluation.rulePackVersion,
    evaluatedAt: evaluation.evaluatedAt,
    state: evaluation.state,
    score: evaluation.score,
    confidence: evaluation.confidence,
    rules: evaluation.results
      .slice(0, METADATA_VISUALS_MAX_ITEMS)
      .map(({ code, state, severity }) => ({ code, state, severity }))
  };
}

const SAFE_EFFECTIVE_METADATA_FIELDS = [
  'title',
  'subtitle',
  'series-title',
  'series-number',
  'keywords',
  'bisac-codes',
  'thema-codes',
  'regional-subject-codes',
  'audience',
  'publisher',
  'imprint',
  'copyright',
  'contributors',
  'edition-statement',
  'language',
  'reading-age-min',
  'reading-age-max'
] as const;

function safeMetadataValue(
  key: (typeof SAFE_EFFECTIVE_METADATA_FIELDS)[number],
  value: unknown
): MetadataVisualsMetadataProjection['fields'][number]['value'] | undefined {
  if (typeof value === 'string') return text(value, 1_000, '') || undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (!Array.isArray(value)) return undefined;
  if (key === 'contributors')
    return value.slice(0, 100).flatMap((candidate) => {
      const item = object(candidate);
      const name = text(item.name, 500, '');
      const role = text(item.role, 160, '');
      return name && role ? [{ name, role }] : [];
    });
  if (key === 'regional-subject-codes')
    return value.slice(0, 100).flatMap((candidate) => {
      const item = object(candidate);
      const territory = token(item.territory, 8);
      const scheme = token(item.scheme, 40);
      const version = text(item.version, 160, '');
      const code = text(item.code, 160, '');
      if (!territory || !scheme || !version || !code || typeof item.primary !== 'boolean')
        return [];
      return [{ territory, scheme, version, code, primary: item.primary }];
    });
  return value.slice(0, 100).flatMap((entry) => {
    const result = text(entry, 500, '');
    return result ? [result] : [];
  });
}

function relationships(
  snapshot: BookCatalogSnapshot,
  bookId: string,
  selectedEditionId?: string
): MetadataVisualsRelationshipProjection {
  const editions = snapshot.editions.filter(
    (item) =>
      item.fields['book-id'] === bookId &&
      (selectedEditionId === undefined || item.id === selectedEditionId)
  );
  const editionIds = new Set(editions.map(({ id }) => id));
  return {
    bookId,
    editionIds: sortedIds(editions),
    formatIds: sortedIds(
      snapshot.formats.filter((item) => editionIds.has(String(item.fields['edition-id'])))
    ),
    metadataSetIds: sortedIds(
      snapshot.metadataSets.filter(
        (item) =>
          item.fields['book-id'] === bookId &&
          (selectedEditionId === undefined ||
            item.fields['edition-id'] === undefined ||
            item.fields['edition-id'] === selectedEditionId)
      )
    ),
    isbnIds: sortedIds(
      snapshot.isbns.filter((item) => editionIds.has(String(item.fields['edition-id'])))
    ),
    workflowIds: sortedIds(snapshot.workflows.filter((item) => item.fields['book-id'] === bookId)),
    launchIds: sortedIds(snapshot.launches.filter((item) => item.fields['book-id'] === bookId)),
    platformTargetIds: sortedIds(
      snapshot.platformTargets.filter((item) => editionIds.has(String(item.fields['edition-id'])))
    )
  };
}

function workflowCategories(
  snapshot: BookCatalogSnapshot,
  bookId: string,
  selectedEditionId?: string
): readonly MetadataVisualsWorkflowCategory[] {
  const workflows = snapshot.workflows.filter((item) => item.fields['book-id'] === bookId);
  const workflowIds = new Set(workflows.map(({ id }) => id));
  const tasks = snapshot.tasks.filter(
    (item) =>
      workflowIds.has(String(item.fields['workflow-id'])) &&
      (selectedEditionId === undefined ||
        item.fields['edition-id'] === undefined ||
        item.fields['edition-id'] === selectedEditionId)
  );
  const categories = new Map<string, { stages: number; stageIds: Set<string> }>();
  for (const workflow of workflows) {
    const stages = object(workflow.fields.stages).items;
    if (!Array.isArray(stages)) continue;
    for (const value of stages) {
      const stage = object(value);
      const category = token(stage.category, 80);
      const stageId = token(stage.id, 200);
      if (!category || !stageId) continue;
      const current = categories.get(category) ?? { stages: 0, stageIds: new Set<string>() };
      current.stages += 1;
      current.stageIds.add(stageId);
      categories.set(category, current);
    }
  }
  return [...categories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, METADATA_VISUALS_MAX_ITEMS)
    .map(([category, group]) => {
      const grouped = tasks.filter((task) => group.stageIds.has(String(task.fields['stage-id'])));
      return {
        category,
        stages: group.stages,
        tasks: {
          total: grouped.length,
          notStarted: grouped.filter((item) => item.fields.status === 'not-started').length,
          active: grouped.filter((item) => item.fields.status === 'active').length,
          done: grouped.filter((item) => item.fields.status === 'done').length,
          cancelled: grouped.filter((item) => item.fields.status === 'cancelled').length
        }
      };
    });
}

function sortedIds(records: readonly CatalogRecord[]): readonly string[] {
  return records
    .map(({ id }) => id)
    .sort()
    .slice(0, METADATA_VISUALS_MAX_ITEMS);
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
