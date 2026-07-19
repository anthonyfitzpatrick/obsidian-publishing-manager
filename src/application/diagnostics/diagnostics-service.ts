/**
 * Builds the M7 diagnostic report from disposable catalog state and local settings. The service
 * deliberately receives no canonical-record save or delete capability: guided remediation opens
 * source notes, while cache rebuild discards and reconstructs only derived catalog state.
 */
import type { Clock } from '../../domain/foundation/clock';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';
import { joinVaultPath, normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import type { VaultTextPort } from '../storage/record-storage-ports';
import type {
  PublishingManagerSettings,
  StorageMovePreview
} from '../settings/publishing-settings-service';

export type DiagnosticCategory =
  'schema' | 'identity' | 'links' | 'dependencies' | 'integrations' | 'migrations' | 'caches';
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'clear';

export interface DiagnosticItem {
  readonly id: string;
  readonly category: DiagnosticCategory;
  readonly severity: DiagnosticSeverity;
  readonly source: 'canonical-record' | 'derived-catalog' | 'plugin-settings' | 'runtime';
  readonly title: string;
  readonly explanation: string;
  readonly impact: string;
  readonly guidance: string;
  readonly path?: VaultPath;
  readonly field?: string;
  readonly entityId?: string;
  readonly action: 'open-source' | 'preview-rebuild' | 'none';
}

export interface DiagnosticReport {
  readonly generatedAt: string;
  readonly fingerprint: string;
  readonly catalogState: BookCatalogSnapshot['availability']['state'];
  readonly projectedRecordCount: number;
  readonly items: readonly DiagnosticItem[];
}

export interface DiagnosticsExportPreview {
  readonly target: VaultPath;
  readonly content: string;
  readonly redacted: boolean;
  readonly redactions: readonly string[];
  readonly reportFingerprint: string;
}

export interface CacheRebuildPreview {
  readonly reportFingerprint: string;
  readonly projectedRecordCount: number;
  readonly diagnosticCount: number;
  readonly canonicalWrites: false;
  readonly consequences: readonly string[];
}

export interface GuidedRemediationPreview {
  readonly itemId: string;
  readonly mode: 'guided-navigation';
  readonly path?: VaultPath;
  readonly canonicalWrites: false;
  readonly steps: readonly string[];
}

export interface DiagnosticsCatalogPort {
  snapshot(): BookCatalogSnapshot;
}

export interface DiagnosticsSettingsPort {
  current(): PublishingManagerSettings;
  storageMoveRecovery(): Promise<StorageMovePreview | undefined>;
}

const CATEGORIES: readonly DiagnosticCategory[] = [
  'schema',
  'identity',
  'links',
  'dependencies',
  'integrations',
  'migrations',
  'caches'
];

/** Coordinates report, export, guided navigation, and a derived-only rebuild operation. */
export class DiagnosticsService {
  public constructor(
    private readonly catalog: DiagnosticsCatalogPort,
    private readonly settings: DiagnosticsSettingsPort,
    private readonly vault: VaultTextPort,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly rebuildCatalog: () => Promise<void>
  ) {}

  /** Produces a complete seven-category report without reading note bodies or asset bytes. */
  public async report(): Promise<DiagnosticReport> {
    const snapshot = this.catalog.snapshot();
    const settings = this.settings.current();
    const records = projectedRecords(snapshot);
    const items = snapshot.diagnostics.map(mapCatalogDiagnostic);
    addIntegrationEvidence(items, settings.integrations.enabledCapabilities);
    addMigrationEvidence(items, snapshot.diagnostics, await this.settings.storageMoveRecovery());
    addCacheEvidence(items, snapshot);
    addClearCoverage(items);
    items.sort(compareItems);
    const generatedAt = this.clock.now().toISOString();
    return {
      generatedAt,
      catalogState: snapshot.availability.state,
      projectedRecordCount: records.length,
      items,
      fingerprint: fingerprintReport(snapshot, settings.integrations.enabledCapabilities, items)
    };
  }

  /** Plans a deterministic local Markdown report, redacting identifiers and paths by default. */
  public async previewExport(redacted = true): Promise<DiagnosticsExportPreview> {
    const report = await this.report();
    const redactions = redacted
      ? ['Vault-relative paths', 'Stable entity identifiers', 'Free-form diagnostic values']
      : [];
    const content = serializeReport(report, redacted);
    const folder = joinVaultPath(this.layout.rootPath(), 'Exports/Diagnostics');
    const stamp = report.generatedAt.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
    const target = await collisionSafeTarget(this.vault, folder, `diagnostics-${stamp}.md`);
    return { target, content, redacted, redactions, reportFingerprint: report.fingerprint };
  }

  /** Rechecks both the report and target before creating the exact previewed bytes once. */
  public async applyExport(preview: DiagnosticsExportPreview): Promise<VaultPath> {
    const latest = await this.report();
    if (latest.fingerprint !== preview.reportFingerprint)
      throw new Error('Diagnostics changed after preview; create a fresh export preview.');
    if (await this.vault.exists(preview.target))
      throw new Error('Diagnostics export target is now occupied; create a fresh preview.');
    const separator = preview.target.lastIndexOf('/');
    if (separator > 0)
      await this.vault.ensureFolder(normalizeVaultPath(preview.target.slice(0, separator)));
    await this.vault.create(preview.target, preview.content);
    return preview.target;
  }

  /** Describes cache replacement precisely and makes the absence of canonical writes explicit. */
  public async previewCacheRebuild(): Promise<CacheRebuildPreview> {
    const report = await this.report();
    return {
      reportFingerprint: report.fingerprint,
      projectedRecordCount: report.projectedRecordCount,
      diagnosticCount: report.items.filter(
        ({ severity }) => severity === 'error' || severity === 'warning'
      ).length,
      canonicalWrites: false,
      consequences: [
        'Discard the in-memory catalog projection and scan managed Markdown again.',
        'Recompute duplicate, schema, and relationship diagnostics from canonical sources.',
        'Do not edit, repair, migrate, rename, or delete any canonical note or linked asset.'
      ]
    };
  }

  /** Rejects stale confirmation, invokes only the catalog rebuild callback, and returns new evidence. */
  public async applyCacheRebuild(preview: CacheRebuildPreview): Promise<DiagnosticReport> {
    const latest = await this.report();
    if (latest.fingerprint !== preview.reportFingerprint)
      throw new Error('Diagnostic state changed after preview; review a fresh rebuild preview.');
    await this.rebuildCatalog();
    return this.report();
  }

  /** Returns human steps and a source location; it never constructs an automatic record patch. */
  public async previewRemediation(itemId: string): Promise<GuidedRemediationPreview> {
    const item = (await this.report()).items.find(({ id }) => id === itemId);
    if (item === undefined)
      throw new Error('Diagnostic is no longer present; refresh Diagnostics.');
    return {
      itemId,
      mode: 'guided-navigation',
      ...(item.path === undefined ? {} : { path: item.path }),
      canonicalWrites: false,
      steps: [
        item.guidance,
        item.path === undefined
          ? 'Review the named runtime or settings area.'
          : 'Open the named canonical Markdown source and make the decision yourself.',
        'Return to Diagnostics and rebuild the derived catalog to verify the result.'
      ]
    };
  }
}

function projectedRecords(snapshot: BookCatalogSnapshot): readonly CatalogRecord[] {
  const unique = new Map<string, CatalogRecord>();
  for (const record of [
    ...snapshot.books,
    ...snapshot.editions,
    ...snapshot.formats,
    ...snapshot.assets,
    ...snapshot.metadataSets,
    ...snapshot.isbns,
    ...snapshot.prices,
    ...snapshot.platformProfiles,
    ...snapshot.platformTargets,
    ...snapshot.workflows,
    ...snapshot.tasks,
    ...snapshot.launches
  ])
    unique.set(record.path, record);
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function mapCatalogDiagnostic(diagnostic: CatalogDiagnostic): DiagnosticItem {
  const category = categoryFor(diagnostic);
  return {
    id: `${diagnostic.code}:${diagnostic.path}:${diagnostic.field ?? ''}`,
    category,
    severity: diagnostic.severity,
    source: 'canonical-record',
    title: diagnostic.message,
    explanation: `Catalog code ${diagnostic.code} identifies evidence in ${diagnostic.field ?? 'the record envelope'}.`,
    impact:
      diagnostic.severity === 'error'
        ? 'The affected record is excluded from normal validated queries until the source is corrected.'
        : 'The record remains visible, but the warning may reduce confidence in dependent results.',
    guidance: diagnostic.suggestedAction,
    path: diagnostic.path,
    ...(diagnostic.field === undefined ? {} : { field: diagnostic.field }),
    ...(diagnostic.entityId === undefined ? {} : { entityId: diagnostic.entityId }),
    action: 'open-source'
  };
}

function categoryFor(diagnostic: CatalogDiagnostic): DiagnosticCategory {
  if (diagnostic.code === 'catalog.unsupported-future-schema') return 'migrations';
  if (diagnostic.code === 'catalog.duplicate-id' || diagnostic.code.endsWith('-conflict'))
    return 'identity';
  if (diagnostic.code === 'catalog.unresolved-link')
    return diagnostic.field?.includes('depend') === true ? 'dependencies' : 'links';
  if (diagnostic.code === 'catalog.invalid-task' || diagnostic.code === 'catalog.invalid-workflow')
    return 'dependencies';
  return 'schema';
}

function addIntegrationEvidence(items: DiagnosticItem[], enabled: readonly string[]): void {
  items.push({
    id: 'integrations:local-capabilities',
    category: 'integrations',
    severity: enabled.length === 0 ? 'clear' : 'info',
    source: 'plugin-settings',
    title:
      enabled.length === 0
        ? 'No optional integration capabilities are enabled.'
        : `${enabled.length} local integration capabilities are enabled.`,
    explanation:
      'M7 does not depend on another plugin, account, endpoint, credential, or network service.',
    impact: 'Absent integrations do not remove core Publishing Manager behavior.',
    guidance:
      'Review Settings → Integrations for declared exchanged fields and capability choices.',
    action: 'none'
  });
}

function addMigrationEvidence(
  items: DiagnosticItem[],
  diagnostics: readonly CatalogDiagnostic[],
  recovery: StorageMovePreview | undefined
): void {
  if (!diagnostics.some(({ code }) => code === 'catalog.unsupported-future-schema')) {
    items.push({
      id: 'migrations:schema-current',
      category: 'migrations',
      severity: 'clear',
      source: 'runtime',
      title: `No future-schema records detected; supported schema is ${CURRENT_RECORD_SCHEMA_VERSION}.`,
      explanation: 'Migration status is derived from every inspected managed envelope.',
      impact: 'No schema compatibility blocker is currently visible.',
      guidance:
        'Keep future-schema notes read-only until a compatible plugin version is installed.',
      action: 'none'
    });
  }
  if (recovery !== undefined)
    items.push({
      id: 'migrations:storage-recovery',
      category: 'migrations',
      severity: 'warning',
      source: 'plugin-settings',
      title: 'A managed-storage move requires recovery.',
      explanation: `${recovery.source} → ${recovery.target} retains a durable recovery preview.`,
      impact: 'The configured root and vault tree may not yet agree.',
      guidance: 'Open Settings → Storage and choose Resume storage move.',
      action: 'none'
    });
}

function addCacheEvidence(items: DiagnosticItem[], snapshot: BookCatalogSnapshot): void {
  const healthy = snapshot.availability.state === 'ready';
  items.push({
    id: 'caches:catalog',
    category: 'caches',
    severity: healthy ? 'clear' : 'warning',
    source: 'derived-catalog',
    title: healthy
      ? 'Derived catalog is ready.'
      : `Derived catalog is ${snapshot.availability.state}.`,
    explanation:
      'The catalog contains rebuildable projections and diagnostics, never canonical ownership.',
    impact: healthy
      ? 'Current queries use a completed managed-root scan.'
      : 'Views may be partial until a rebuild completes.',
    guidance: 'Preview a catalog rebuild; rebuilding never edits canonical records.',
    action: 'preview-rebuild'
  });
}

function addClearCoverage(items: DiagnosticItem[]): void {
  for (const category of CATEGORIES)
    if (!items.some((item) => item.category === category))
      items.push({
        id: `${category}:clear`,
        category,
        severity: 'clear',
        source: 'derived-catalog',
        title: `No ${category} problem detected.`,
        explanation: `The ${category} diagnostic check completed.`,
        impact: 'No current blocker is visible in this category.',
        guidance: 'No action is required.',
        action: 'none'
      });
}

function compareItems(left: DiagnosticItem, right: DiagnosticItem): number {
  const rank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2, clear: 3 };
  return (
    rank[left.severity] - rank[right.severity] ||
    left.category.localeCompare(right.category) ||
    left.id.localeCompare(right.id)
  );
}

function fingerprintReport(
  snapshot: BookCatalogSnapshot,
  enabled: readonly string[],
  items: readonly DiagnosticItem[]
): string {
  const source = JSON.stringify({
    availability: snapshot.availability,
    enabled: [...enabled].sort(),
    records: projectedRecords(snapshot).map(({ path, sourceRevision }) => [path, sourceRevision]),
    items: items.map(({ id, severity, title }) => [id, severity, title])
  });
  let hash = 0x811c9dc5;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `diagnostics-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function serializeReport(report: DiagnosticReport, redacted: boolean): string {
  const lines = [
    '# Publishing Manager diagnostics',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Report fingerprint: ${report.fingerprint}`,
    `- Catalog state: ${report.catalogState}`,
    `- Projected records: ${report.projectedRecordCount}`,
    `- Privacy: ${redacted ? 'Paths, identifiers, and free-form values redacted' : 'Explicitly includes vault-relative paths and identifiers'}`,
    ''
  ];
  for (const category of CATEGORIES) {
    lines.push(`## ${category[0]?.toUpperCase()}${category.slice(1)}`, '');
    for (const item of report.items.filter((candidate) => candidate.category === category)) {
      const privateRecord = redacted && item.source === 'canonical-record';
      lines.push(
        `### ${item.severity.toUpperCase()} — ${privateRecord ? 'Canonical record diagnostic' : item.title}`
      );
      lines.push(`- Source: ${item.source}`);
      lines.push(
        privateRecord
          ? '- Impact: A canonical record requires local review.'
          : `- Impact: ${item.impact}`
      );
      lines.push(
        privateRecord
          ? '- Guidance: Open Diagnostics locally for source-specific guidance.'
          : `- Guidance: ${item.guidance}`
      );
      if (!redacted && item.path !== undefined) lines.push(`- Path: ${item.path}`);
      if (!redacted && item.entityId !== undefined) lines.push(`- Entity: ${item.entityId}`);
      if (!redacted && item.field !== undefined) lines.push(`- Field: ${item.field}`);
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

async function collisionSafeTarget(
  vault: VaultTextPort,
  folder: VaultPath,
  filename: string
): Promise<VaultPath> {
  const dot = filename.lastIndexOf('.');
  const base = dot < 0 ? filename : filename.slice(0, dot);
  const extension = dot < 0 ? '' : filename.slice(dot);
  let suffix = 1;
  let target = joinVaultPath(folder, filename);
  while (await vault.exists(target)) {
    suffix += 1;
    target = joinVaultPath(folder, `${base}-${suffix}${extension}`);
  }
  return target;
}
