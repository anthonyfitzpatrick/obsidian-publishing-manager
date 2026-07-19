/**
 * RDY-007–RDY-011 application boundary. It translates canonical records and current local asset
 * observations into the small normalized input vocabulary consumed by the pure rule pack.
 */
import type { AssetReferenceService } from '../assets/asset-reference-service';
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import { CORE_READINESS_RULE_PACK } from '../../domain/readiness/core-readiness-rules';
import {
  evaluateReadiness,
  type ReadinessEvaluation,
  type ReadinessOverride,
  type ReadinessScope
} from '../../domain/readiness/readiness-engine';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';

export interface CreateReadinessOverrideInput {
  readonly ruleCode: string;
  readonly scope: ReadinessScope;
  readonly reason: string;
  readonly ownerLabel: string;
  readonly expiresAt?: string;
}

interface CachedEvaluation {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly evaluation: ReadinessEvaluation;
}

export class ReadinessProjectService {
  private readonly cache = new Map<string, CachedEvaluation>();
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly assets: AssetReferenceService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /** Evaluates one book or its selected edition using current canonical and live local evidence. */
  public async evaluateBook(bookId: string, editionId?: string): Promise<ReadinessEvaluation> {
    const book = this.catalog.recordById(bookId);
    if (book?.type !== 'book') throw new Error('Choose a valid book for readiness.');
    const edition = editionId === undefined ? undefined : this.catalog.recordById(editionId);
    if (
      editionId !== undefined &&
      (edition?.type !== 'edition' || edition.fields['book-id'] !== bookId)
    )
      throw new Error('Choose an edition belonging to this book.');
    const scope: ReadinessScope =
      edition === undefined ? { kind: 'book', id: book.id } : { kind: 'edition', id: edition.id };
    return this.evaluate(scope, await this.inputs(book, edition));
  }

  /** Platform scope retains the exact target identity rather than collapsing territories. */
  public async evaluatePlatform(targetId: string): Promise<ReadinessEvaluation> {
    const target = this.catalog.recordById(targetId);
    if (target?.type !== 'platform-target') throw new Error('Choose a valid platform target.');
    const edition = this.catalog.recordById(String(target.fields['edition-id']));
    if (edition?.type !== 'edition') throw new Error('Platform target edition is unavailable.');
    const book = this.catalog.recordById(String(edition.fields['book-id']));
    if (book?.type !== 'book') throw new Error('Platform target book is unavailable.');
    return this.evaluate(
      { kind: 'platform', id: target.id },
      await this.inputs(book, edition, target)
    );
  }

  /** Persists an auditable exception without mutating the failed rule or its evidence. */
  public async createOverride(input: CreateReadinessOverrideInput): Promise<CatalogRecord> {
    if (!CORE_READINESS_RULE_PACK.rules.some(({ code }) => code === input.ruleCode))
      throw new Error('Choose a rule from the current core pack.');
    if (!input.reason.trim() || !input.ownerLabel.trim())
      throw new Error('Override reason and owner label are required.');
    const now = this.clock.now().toISOString();
    if (
      input.expiresAt !== undefined &&
      (!Number.isFinite(Date.parse(input.expiresAt)) ||
        Date.parse(input.expiresAt) < Date.parse(now))
    )
      throw new Error('Override expiry must be a future ISO date-time.');
    const fields = {
      'rule-code': input.ruleCode,
      'scope-kind': input.scope.kind,
      'scope-id': input.scope.id,
      reason: input.reason.trim(),
      'owner-label': input.ownerLabel.trim(),
      'created-at': now,
      ...(input.expiresAt === undefined ? {} : { 'expires-at': input.expiresAt })
    };
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(
        'readiness-override',
        `${input.ruleCode}-${input.scope.id}`,
        this.catalog.knownPaths()
      ),
      {
        envelope: {
          pmId: `pm-readiness-override-${safeId(this.ids.generate())}`,
          pmType: 'readiness-override',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields,
        body: `# Readiness override — ${input.ruleCode}\n\nReason: ${input.reason.trim()}\n`
      }
    );
    this.catalog.accept(loaded, 'created');
    this.cache.delete(scopeKey(input.scope));
    const result = this.catalog.recordById(loaded.envelope.pmId);
    if (result === undefined) throw new Error('Created override did not enter the catalog.');
    return result;
  }

  private async evaluate(
    scope: ReadinessScope,
    inputs: Readonly<Record<string, unknown>>
  ): Promise<ReadinessEvaluation> {
    const key = scopeKey(scope);
    const previous = this.cache.get(key);
    const changed = changedKeys(previous?.inputs, inputs);
    const evaluation = evaluateReadiness(
      CORE_READINESS_RULE_PACK,
      { scope, inputs },
      this.clock.now().toISOString(),
      {
        ...(previous === undefined ? {} : { previous: previous.evaluation }),
        changedInputKeys: changed,
        overrides: this.overrides(scope)
      }
    );
    this.cache.set(key, { inputs, evaluation });
    return evaluation;
  }

  private async inputs(
    book: CatalogRecord,
    edition?: CatalogRecord,
    selectedTarget?: CatalogRecord
  ): Promise<Readonly<Record<string, unknown>>> {
    const snapshot = this.catalog.snapshot();
    const editions =
      edition === undefined
        ? snapshot.editions.filter((item) => item.fields['book-id'] === book.id)
        : [edition];
    const editionIds = new Set(editions.map(({ id }) => id));
    const formats = snapshot.formats.filter((item) =>
      editionIds.has(String(item.fields['edition-id']))
    );
    const assetRecords = snapshot.assets.filter(
      (item) =>
        item.fields['book-id'] === book.id &&
        (edition === undefined ||
          item.fields['edition-id'] === undefined ||
          item.fields['edition-id'] === edition.id)
    );
    const inspections = await Promise.all(
      assetRecords.map((record) => this.assets.inspect(record).catch(() => undefined))
    );
    const freshness = inspections.flatMap((item) =>
      item === undefined ? [] : [item.assessment.state]
    );
    const coverIndexes = assetRecords.flatMap((item, index) =>
      String(item.fields.role).startsWith('cover-') ? [index] : []
    );
    const coverStates = coverIndexes.flatMap((index) => inspections[index]?.assessment.state ?? []);
    const metadata = effectiveMetadata(snapshot.metadataSets, book.id, edition?.id);
    const isbns = snapshot.isbns.filter((item) =>
      editionIds.has(String(item.fields['edition-id']))
    );
    const targets =
      selectedTarget === undefined
        ? snapshot.platformTargets.filter(
            (item) =>
              editionIds.has(String(item.fields['edition-id'])) && item.fields.intent === true
          )
        : [selectedTarget];
    const pricingComplete =
      targets.length > 0 &&
      targets.every((target) =>
        snapshot.prices.some(
          (price) =>
            price.fields['edition-id'] === target.fields['edition-id'] &&
            price.fields.platform === target.fields.platform &&
            price.fields.territory === target.fields.territory
        )
      );
    const tasks = snapshot.tasks.filter(
      (item) =>
        item.fields['book-id'] === book.id &&
        item.fields.required === true &&
        (edition === undefined ||
          item.fields['edition-id'] === undefined ||
          item.fields['edition-id'] === edition.id)
    );
    return {
      'cover.state': coverStates.length === 0 ? 'fail' : freshnessState(coverStates),
      'isbn.state': isbns.some((item) =>
        ['assigned', 'published'].includes(String(item.fields.status))
      )
        ? 'pass'
        : 'fail',
      'metadata.state':
        metadata === undefined ? 'unknown' : coreMetadataComplete(metadata) ? 'pass' : 'fail',
      'formats.count': formats.length,
      'assets.freshness': freshness.length === 0 ? 'unknown' : freshnessState(freshness),
      'edition.medium': edition?.fields.medium,
      'edition.page-count': edition?.fields['page-count'],
      'pricing.state': targets.length === 0 ? 'unknown' : pricingComplete ? 'pass' : 'fail',
      'tasks.required-count': tasks.length,
      'tasks.incomplete-count': tasks.filter((item) => item.fields.status !== 'done').length,
      'platform.state':
        targets.length === 0 ? 'unknown' : targets.every(confirmedTarget) ? 'pass' : 'fail'
    };
  }

  private overrides(scope: ReadinessScope): readonly ReadinessOverride[] {
    return this.catalog
      .recordsOfType('readiness-override')
      .flatMap((record): ReadinessOverride[] =>
        record.fields['scope-kind'] === scope.kind && record.fields['scope-id'] === scope.id
          ? [
              {
                ruleCode: String(record.fields['rule-code']),
                scope,
                reason: String(record.fields.reason),
                ownerLabel: String(record.fields['owner-label']),
                createdAt: String(record.fields['created-at']),
                ...(typeof record.fields['expires-at'] === 'string'
                  ? { expiresAt: record.fields['expires-at'] }
                  : {})
              }
            ]
          : []
      );
  }
}

function effectiveMetadata(
  records: readonly CatalogRecord[],
  bookId: string,
  editionId?: string
): Readonly<Record<string, unknown>> | undefined {
  const book = records.find(
    (item) => item.fields['book-id'] === bookId && item.fields.scope === 'book'
  );
  const edition =
    editionId === undefined
      ? undefined
      : records.find(
          (item) => item.fields['edition-id'] === editionId && item.fields.scope === 'edition'
        );
  const base = isObject(book?.fields.values) ? book.fields.values : undefined;
  const override = isObject(edition?.fields.values) ? edition.fields.values : undefined;
  return base === undefined && override === undefined
    ? undefined
    : { ...(base ?? {}), ...(override ?? {}) };
}
function coreMetadataComplete(values: Readonly<Record<string, unknown>>): boolean {
  return [
    'title',
    'long-description-markdown',
    'language',
    'publisher',
    'copyright',
    'contributors'
  ].every(
    (key) =>
      values[key] !== undefined &&
      values[key] !== '' &&
      (!Array.isArray(values[key]) || values[key].length > 0)
  );
}
function freshnessState(states: readonly string[]): 'pass' | 'warning' | 'fail' | 'unknown' {
  if (states.some((state) => state === 'missing' || state === 'stale')) return 'fail';
  if (states.some((state) => state === 'unknown')) return 'unknown';
  if (states.some((state) => state === 'externally-managed')) return 'warning';
  return states.length > 0 ? 'pass' : 'unknown';
}
function confirmedTarget(target: CatalogRecord): boolean {
  return (
    target.fields['review-state'] === 'approved' ||
    ['preorder', 'published'].includes(String(target.fields['publication-state']))
  );
}
function changedKeys(
  previous: Readonly<Record<string, unknown>> | undefined,
  current: Readonly<Record<string, unknown>>
): ReadonlySet<string> {
  if (previous === undefined) return new Set(Object.keys(current));
  return new Set(
    Object.keys(current).filter(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key])
    )
  );
}
function scopeKey(scope: ReadinessScope): string {
  return `${scope.kind}:${scope.id}`;
}
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
