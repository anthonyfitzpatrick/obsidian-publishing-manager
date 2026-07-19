/** TPL-001–TPL-005 catalog-backed copies, imports, previews, and local portable exports. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort, VaultTextPort } from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import {
  BUNDLED_PUBLISHING_TEMPLATES,
  bundledTemplate
} from '../../domain/templates/bundled-templates';
import {
  parseTemplateImport,
  previewTemplateResolution,
  serializeTemplate,
  validateTemplate,
  type PublishingTemplate,
  type TemplateImportResult,
  type TemplateResolutionPreview
} from '../../domain/templates/publishing-template';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';
import { joinVaultPath, type VaultPath } from '../../domain/storage/vault-path';

export interface TemplateExportResult {
  readonly path: VaultPath;
  readonly excludedPrivateFields: readonly string[];
}

export class TemplateProjectService {
  public readonly bundled = BUNDLED_PUBLISHING_TEMPLATES;
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly vaultText: VaultTextPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  public installed(): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType('template')
      .filter(({ archived }) => !archived)
      .sort(
        (left, right) =>
          text(left.fields.kind).localeCompare(text(right.fields.kind)) ||
          text(left.fields.name).localeCompare(text(right.fields.name)) ||
          left.id.localeCompare(right.id)
      );
  }

  /** Bundled definitions are immutable; this deep validated copy is the only editable form. */
  public async copyBundled(templateId: string): Promise<CatalogRecord> {
    const source = bundledTemplate(templateId);
    if (source === undefined) throw new Error('Choose one bundled template.');
    return this.create(source, 'bundled-copy', source.templateId);
  }

  /** Imports inert JSON after size/schema/safety validation and private-data exclusion. */
  public async importJson(source: string): Promise<{
    readonly record: CatalogRecord;
    readonly excludedPrivateFields: readonly string[];
  }> {
    const parsed: TemplateImportResult = parseTemplateImport(source);
    const record = await this.create(parsed.template, 'imported', parsed.template.templateId);
    return { record, excludedPrivateFields: parsed.excludedPrivateFields };
  }

  public preview(
    recordId: string,
    supplied: Readonly<Record<string, unknown>>
  ): TemplateResolutionPreview {
    return previewTemplateResolution(this.template(recordId), supplied);
  }

  /** Writes deterministic portable JSON to a collision-safe local file; no body or envelope leaks. */
  public async exportJson(recordId: string): Promise<TemplateExportResult> {
    const template = this.template(recordId);
    const serialized = serializeTemplate(template);
    const folder = joinVaultPath(this.layout.rootPath(), 'Exports/Templates');
    await this.vaultText.ensureFolder(folder);
    const base = slug(`${template.kind}-${template.name}-v${template.version}`);
    let suffix = 1;
    let path = joinVaultPath(folder, `${base}.json`);
    while (await this.vaultText.exists(path)) {
      suffix += 1;
      path = joinVaultPath(folder, `${base}-${suffix}.json`);
    }
    await this.vaultText.create(path, serialized.source);
    return { path, excludedPrivateFields: serialized.excludedPrivateFields };
  }

  public template(recordId: string): PublishingTemplate {
    const record = this.catalog.recordById(recordId);
    if (record?.type !== 'template' || record.archived)
      throw new Error('Choose one installed template.');
    return templateFromRecord(record);
  }

  private async create(
    template: PublishingTemplate,
    source: 'bundled-copy' | 'imported',
    sourceTemplateId: string
  ): Promise<CatalogRecord> {
    const safe = validateTemplate(template);
    const now = this.clock.now().toISOString();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(
        'template',
        `${safe.kind} ${safe.name} v${safe.version}`,
        this.catalog.knownPaths()
      ),
      {
        envelope: {
          pmId: `pm-template-${safeId(this.ids.generate())}`,
          pmType: 'template',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields: {
          kind: safe.kind,
          name: safe.name,
          ...(safe.description === undefined ? {} : { description: safe.description }),
          version: safe.version,
          source,
          'source-template-id': sourceTemplateId,
          applicability: safe.applicability,
          defaults: safe.defaults,
          'required-fields': safe.requiredFields,
          variables: { items: safe.variables },
          ...(safe.extensions === undefined ? {} : { extensions: safe.extensions })
        },
        body: '# Publishing template\n\nThis note contains inert local data. Publishing Manager never executes template content.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
    return this.catalog.recordById(loaded.envelope.pmId)!;
  }
}

function templateFromRecord(record: CatalogRecord): PublishingTemplate {
  const variables = record.fields.variables;
  const items = isObject(variables) && Array.isArray(variables.items) ? variables.items : [];
  return validateTemplate({
    templateId: record.id,
    kind: text(record.fields.kind) as PublishingTemplate['kind'],
    name: text(record.fields.name),
    ...(text(record.fields.description) ? { description: text(record.fields.description) } : {}),
    version: Number(record.fields.version),
    applicability: object(record.fields.applicability),
    defaults: object(record.fields.defaults),
    requiredFields: Array.isArray(record.fields['required-fields'])
      ? record.fields['required-fields'].filter((item): item is string => typeof item === 'string')
      : [],
    variables: items as PublishingTemplate['variables'],
    ...(isObject(record.fields.extensions) ? { extensions: record.fields.extensions } : {})
  });
}
function object(value: unknown): Readonly<Record<string, unknown>> {
  return isObject(value) ? value : {};
}
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || 'template'
  );
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
