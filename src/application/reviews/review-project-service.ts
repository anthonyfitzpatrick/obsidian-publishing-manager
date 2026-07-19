/** REV-001/REV-002 canonical review creation, editing, chronology, and filters. */
import type { BookCatalog } from '../catalog/book-catalog';
import type { ManagedRecordRepositoryPort } from '../storage/record-storage-ports';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';
import { CURRENT_RECORD_SCHEMA_VERSION } from '../../domain/records/record-envelope';
import { normalizeReview, type ReviewInput } from '../../domain/reviews/review-record';
import type { ManagedFolderLayout } from '../../domain/storage/managed-folder-layout';

export interface ReviewFilters {
  readonly source?: string;
  readonly editionId?: string;
  readonly permissionStatus?: string;
  readonly followUpStatus?: string;
  readonly minimumRating?: number;
}

export class ReviewProjectService {
  public constructor(
    private readonly repository: ManagedRecordRepositoryPort,
    private readonly catalog: BookCatalog,
    private readonly layout: ManagedFolderLayout,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  public reviewsForBook(bookId: string, filters: ReviewFilters = {}): readonly CatalogRecord[] {
    return this.catalog
      .recordsOfType('review')
      .filter(
        (record) =>
          record.fields['book-id'] === bookId &&
          (filters.source === undefined ||
            String(record.fields.source).toLowerCase().includes(filters.source.toLowerCase())) &&
          (filters.editionId === undefined || record.fields['edition-id'] === filters.editionId) &&
          (filters.permissionStatus === undefined ||
            record.fields['permission-status'] === filters.permissionStatus) &&
          (filters.followUpStatus === undefined ||
            record.fields['follow-up-status'] === filters.followUpStatus) &&
          (filters.minimumRating === undefined ||
            (typeof record.fields.rating === 'string' &&
              Number(record.fields.rating) >= filters.minimumRating))
      )
      .sort(
        (a, b) =>
          String(b.fields.date).localeCompare(String(a.fields.date)) || a.id.localeCompare(b.id)
      );
  }

  public async create(input: ReviewInput): Promise<CatalogRecord> {
    const normalized = this.validateScope(input);
    const now = this.clock.now().toISOString();
    const loaded = await this.repository.create(
      this.layout.collisionSafePath(
        'review',
        `${normalized.date} ${normalized.source}`,
        this.catalog.knownPaths()
      ),
      {
        envelope: {
          pmId: `pm-review-${safeId(this.ids.generate())}`,
          pmType: 'review',
          pmSchema: CURRENT_RECORD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now
        },
        fields: fields(normalized),
        body: '# Review evidence\n\nKeep quoted material brief and retain its source and permission evidence.\n'
      }
    );
    this.catalog.accept(loaded, 'created');
    return this.catalog.recordById(loaded.envelope.pmId)!;
  }

  /** Edits explicit evidence losslessly; optimistic revision conflicts force a fresh form. */
  public async update(reviewId: string, input: ReviewInput): Promise<CatalogRecord> {
    const record = this.catalog.recordById(reviewId);
    if (record?.type !== 'review') throw new Error('Choose one valid review record.');
    const normalized = this.validateScope(input);
    const saved = await this.repository.save(
      await this.repository.load(record.path),
      { fields: fields(normalized) },
      this.clock.now().toISOString()
    );
    this.catalog.accept(saved, 'modified');
    return this.catalog.recordById(saved.envelope.pmId)!;
  }

  private validateScope(input: ReviewInput) {
    const normalized = normalizeReview(input);
    const book = this.catalog.recordById(normalized.bookId);
    if (book?.type !== 'book') throw new Error('Choose one valid review book.');
    if (normalized.editionId !== undefined) {
      const edition = this.catalog.recordById(normalized.editionId);
      if (edition?.type !== 'edition' || edition.fields['book-id'] !== normalized.bookId)
        throw new Error('Review edition must belong to its book.');
    }
    return normalized;
  }
}

function fields(value: ReturnType<typeof normalizeReview>): Readonly<Record<string, unknown>> {
  return {
    'book-id': value.bookId,
    ...(value.editionId === undefined ? {} : { 'edition-id': value.editionId }),
    source: value.source,
    ...(value.sourceLink === undefined ? {} : { 'source-link': value.sourceLink }),
    date: value.date,
    ...(value.rating === undefined ? {} : { rating: value.rating }),
    ...(value.quote === undefined ? {} : { quote: value.quote }),
    ...(value.reference === undefined ? {} : { reference: value.reference }),
    'permission-status': value.permissionStatus,
    ...(value.permissionNotes === undefined ? {} : { 'permission-notes': value.permissionNotes }),
    ...(value.followUpDate === undefined ? {} : { 'follow-up-date': value.followUpDate }),
    'follow-up-status': value.followUpStatus,
    ...(value.notes === undefined ? {} : { notes: value.notes })
  };
}
function safeId(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (safe.length < 8) throw new Error('Identity generator failed.');
  return safe;
}
