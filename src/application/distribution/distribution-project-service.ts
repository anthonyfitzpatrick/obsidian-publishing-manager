/** DST-001–DST-006 application service over local canonical records; it exposes no network port. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import { BUNDLED_PLATFORM_PROFILES } from '../../domain/distribution/bundled-platform-profiles';
import {
  targetReadiness,
  validatePlatformProfile,
  validatePlatformTarget
} from '../../domain/distribution/distribution-record';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';

export interface DistributionTargetInput {
  readonly editionId: string;
  readonly profileId: string;
  readonly territory: string;
  readonly publicationLocation: string;
  readonly aliases?: readonly string[];
  readonly intent: boolean;
  readonly metadataReady: boolean;
  readonly assetsReady: boolean;
  readonly pricingReady: boolean;
  readonly uploadDate?: string;
  readonly reviewState: string;
  readonly publicationState: string;
  readonly retailLinks?: Readonly<Record<string, string>>;
  readonly notes?: string;
  readonly lastVerified?: string;
  readonly checklist?: readonly { label: string; done: boolean }[];
}

export class DistributionProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}
  public profiles(): readonly CatalogRecord[] {
    return this.catalog.recordsOfType('platform-profile');
  }
  public targets(bookId?: string): readonly CatalogRecord[] {
    const all = this.catalog.recordsOfType('platform-target');
    if (!bookId) return all;
    const editions = new Set(this.catalog.editionsForBook(bookId).map(({ id }) => id));
    return all.filter((record) => editions.has(String(record.fields['edition-id'])));
  }
  public async installBundledProfiles(): Promise<readonly CatalogRecord[]> {
    const existing = new Set(this.profiles().map((r) => String(r.fields.slug)));
    const created: CatalogRecord[] = [];
    for (const seed of BUNDLED_PLATFORM_PROFILES)
      if (!existing.has(seed.slug))
        created.push(
          await this.create('platform-profile', seed.label, {
            slug: seed.slug,
            label: seed.label,
            version: 1,
            'reviewed-at': '2026-07-19',
            'official-url': seed.officialUrl,
            requirements: { items: seed.requirements.map((label) => ({ label })) },
            notes:
              'Bundled conservative planning profile; verify official requirements before external submission.'
          })
        );
    return created;
  }
  public profileDiagnostics(
    profile: CatalogRecord
  ): readonly ReturnType<typeof validatePlatformProfile>[number][] {
    return validatePlatformProfile(profile.fields, this.clock.now().toISOString().slice(0, 10));
  }
  public readiness(target: CatalogRecord) {
    return targetReadiness(target.fields);
  }
  public async saveTarget(
    input: DistributionTargetInput,
    targetId?: string
  ): Promise<CatalogRecord> {
    const edition = this.catalog.recordById(input.editionId);
    if (edition?.type !== 'edition') throw new Error('Choose a valid edition.');
    const profile = this.catalog.recordById(input.profileId);
    if (profile?.type !== 'platform-profile') throw new Error('Choose a valid platform profile.');
    const fields = {
      'edition-id': edition.id,
      'profile-id': profile.id,
      platform: profile.fields.label,
      territory: input.territory.trim().toUpperCase(),
      'publication-location': input.publicationLocation.trim(),
      ...(input.aliases?.length ? { aliases: input.aliases } : {}),
      intent: input.intent,
      checklist: {
        items: input.checklist ?? requirements(profile).map((label) => ({ label, done: false }))
      },
      'metadata-ready': input.metadataReady,
      'assets-ready': input.assetsReady,
      'pricing-ready': input.pricingReady,
      ...(input.uploadDate ? { 'upload-date': input.uploadDate } : {}),
      'review-state': input.reviewState,
      'publication-state': input.publicationState,
      ...(input.retailLinks ? { 'retail-links': input.retailLinks } : {}),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(input.lastVerified ? { 'last-verified': input.lastVerified } : {}),
      'profile-version': profile.fields.version
    };
    const errors = validatePlatformTarget(fields).filter(({ severity }) => severity === 'error');
    if (errors.length) throw new Error(errors.map(({ message }) => message).join(' '));
    if (targetId) {
      const target = this.catalog.recordById(targetId);
      if (target?.type !== 'platform-target') throw new Error('Choose a valid target.');
      const loaded = await this.repository.load(target.path);
      const saved = await this.repository.save(loaded, { fields }, this.now());
      this.catalog.accept(saved, 'modified');
      const result = this.catalog.recordById(target.id);
      if (result === undefined) throw new Error('Saved distribution target left the catalog.');
      return result;
    }
    return this.create(
      'platform-target',
      `${String(profile.fields.label)}-${fields.territory}-${input.publicationLocation}`,
      fields
    );
  }
  public targetDiagnostics(target: CatalogRecord): readonly string[] {
    const profile = this.catalog.recordById(String(target.fields['profile-id']));
    const messages = validatePlatformTarget(target.fields).map(({ message }) => message);
    if (profile?.type !== 'platform-profile')
      messages.push('Referenced platform profile is missing.');
    else if (profile.fields.version !== target.fields['profile-version'])
      messages.push(
        `Target uses profile version ${String(target.fields['profile-version'])}; current local profile is version ${String(profile.fields.version)}. Review before updating.`
      );
    return messages;
  }
  private async create(
    type: 'platform-profile' | 'platform-target',
    label: string,
    fields: Readonly<Record<string, unknown>>
  ): Promise<CatalogRecord> {
    const now = this.now();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(type, label, this.catalog.knownPaths()),
      {
        envelope: {
          pmId: `pm-${type}-${safeId(this.ids.generate())}`,
          pmType: type,
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields,
        body: `# ${label}\n\nLocal planning record. External actions are confirmed manually.\n`
      }
    );
    this.catalog.accept(loaded, 'created');
    const record = this.catalog.recordById(loaded.envelope.pmId);
    if (!record) throw new Error('Created distribution record did not enter catalog.');
    return record;
  }
  private now(): string {
    return this.clock.now().toISOString();
  }
}
function requirements(profile: CatalogRecord): readonly string[] {
  const value = profile.fields.requirements;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  )
    return [];
  return (value.items as unknown[]).flatMap((item): string[] =>
    typeof item === 'object' && item !== null && 'label' in item && typeof item.label === 'string'
      ? [item.label]
      : []
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
