/** Native REV-001/REV-002 permission-aware entry and chronological filtered review log. */
import { Notice } from 'obsidian';
import type { ReviewProjectService } from '../../application/reviews/review-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type {
  ReviewFollowUpStatus,
  ReviewInput,
  ReviewPermissionStatus
} from '../../domain/reviews/review-record';

export interface ReviewsWorkspaceState {
  editingId: string;
  editionId: string;
  source: string;
  sourceLink: string;
  date: string;
  rating: string;
  quote: string;
  reference: string;
  permissionStatus: ReviewPermissionStatus;
  permissionNotes: string;
  followUpDate: string;
  followUpStatus: ReviewFollowUpStatus;
  notes: string;
  filterSource: string;
  filterEditionId: string;
  filterPermission: string;
  filterFollowUp: string;
  filterRating: string;
}
export function createReviewsWorkspaceState(): ReviewsWorkspaceState {
  return {
    editingId: '',
    editionId: '',
    source: '',
    sourceLink: '',
    date: '',
    rating: '',
    quote: '',
    reference: '',
    permissionStatus: 'unknown',
    permissionNotes: '',
    followUpDate: '',
    followUpStatus: 'none',
    notes: '',
    filterSource: '',
    filterEditionId: '',
    filterPermission: '',
    filterFollowUp: '',
    filterRating: ''
  };
}

export function renderReviewsWorkspace(context: {
  parent: HTMLElement;
  book: CatalogRecord;
  snapshot: BookCatalogSnapshot;
  reviews: ReviewProjectService;
  state: ReviewsWorkspaceState;
  rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-reviews-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Source-linked · permission-aware · local' });
  title.createEl('h2', { text: 'Reviews' });
  title.createEl('p', {
    text: 'Log brief evidence and link to the source. Store quoted text only with appropriate permission evidence.'
  });
  renderEditor(page, context);
  renderFilters(page, context);
  renderReviewList(page, context);
}

function renderEditor(
  parent: HTMLElement,
  context: Parameters<typeof renderReviewsWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.open = context.state.editingId !== '';
  details.createEl('summary', {
    text: context.state.editingId ? 'Edit review evidence' : 'Add review evidence'
  });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const editions = context.snapshot.editions.filter(
    (item) => item.fields['book-id'] === context.book.id
  );
  const edition = select(
    form,
    'Book-wide review',
    editions.map((item) => [item.id, text(item.fields.type, item.id)])
  );
  edition.value = context.state.editionId;
  edition.addEventListener('change', () => (context.state.editionId = edition.value));
  for (const [key, label, type] of [
    ['source', 'Review source', 'text'],
    ['sourceLink', 'Source link (https://…)', 'url'],
    ['date', 'Review date', 'date'],
    ['rating', 'Rating from 0 to 5', 'number'],
    ['reference', 'Quote/reference location', 'text'],
    ['followUpDate', 'Follow-up date', 'date']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state[key],
      attr: {
        type,
        placeholder: label,
        'aria-label': label,
        ...(key === 'rating' ? { min: '0', max: '5', step: '0.1' } : {})
      }
    });
    input.addEventListener('input', () => (context.state[key] = input.value));
  }
  const quote = form.createEl('textarea', {
    text: context.state.quote,
    attr: {
      placeholder: 'Brief quote evidence (maximum 500 characters)',
      'aria-label': 'Brief review quote',
      maxlength: '500'
    }
  });
  quote.addEventListener('input', () => (context.state.quote = quote.value));
  const permission = select(form, 'Permission status', [
    ['unknown', 'Permission unknown'],
    ['not-required', 'Permission not required'],
    ['obtained', 'Permission obtained'],
    ['restricted', 'Restricted / do not reuse']
  ]);
  permission.value = context.state.permissionStatus;
  permission.addEventListener(
    'change',
    () => (context.state.permissionStatus = permission.value as ReviewPermissionStatus)
  );
  const permissionNotes = form.createEl('textarea', {
    text: context.state.permissionNotes,
    attr: {
      placeholder: 'Permission evidence or reuse limitation',
      'aria-label': 'Review permission notes'
    }
  });
  permissionNotes.addEventListener(
    'input',
    () => (context.state.permissionNotes = permissionNotes.value)
  );
  const followUp = select(form, 'Follow-up status', [
    ['none', 'No follow-up'],
    ['open', 'Follow-up open'],
    ['done', 'Follow-up done'],
    ['dismissed', 'Follow-up dismissed']
  ]);
  followUp.value = context.state.followUpStatus;
  followUp.addEventListener(
    'change',
    () => (context.state.followUpStatus = followUp.value as ReviewFollowUpStatus)
  );
  const notes = form.createEl('textarea', {
    text: context.state.notes,
    attr: { placeholder: 'Private operational notes', 'aria-label': 'Review notes' }
  });
  notes.addEventListener('input', () => (context.state.notes = notes.value));
  form.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: context.state.editingId ? 'Update review' : 'Add review',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = reviewInput(context);
    const operation = context.state.editingId
      ? context.reviews.update(context.state.editingId, input)
      : context.reviews.create(input);
    void operation
      .then(() => {
        Object.assign(context.state, createReviewsWorkspaceState());
        context.rerender();
      })
      .catch(
        (cause: unknown) =>
          new Notice(cause instanceof Error ? cause.message : 'Review could not be saved.')
      );
  });
}

function renderFilters(
  parent: HTMLElement,
  context: Parameters<typeof renderReviewsWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Review filters' });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const source = form.createEl('input', {
    value: context.state.filterSource,
    attr: { type: 'search', placeholder: 'Source contains', 'aria-label': 'Filter review source' }
  });
  source.addEventListener('change', () => {
    context.state.filterSource = source.value;
    context.rerender();
  });
  const editions = context.snapshot.editions.filter(
    (item) => item.fields['book-id'] === context.book.id
  );
  for (const [key, label, options] of [
    [
      'filterEditionId',
      'All editions',
      editions.map((item) => [item.id, text(item.fields.type, item.id)] as const)
    ],
    [
      'filterPermission',
      'All permission states',
      [
        ['unknown', 'Permission unknown'],
        ['not-required', 'Not required'],
        ['obtained', 'Obtained'],
        ['restricted', 'Restricted']
      ]
    ],
    [
      'filterFollowUp',
      'All follow-up states',
      [
        ['none', 'No follow-up'],
        ['open', 'Open'],
        ['done', 'Done'],
        ['dismissed', 'Dismissed']
      ]
    ]
  ] as const) {
    const control = select(form, label, options);
    control.value = context.state[key];
    control.addEventListener('change', () => {
      context.state[key] = control.value;
      context.rerender();
    });
  }
  const rating = form.createEl('input', {
    value: context.state.filterRating,
    attr: {
      type: 'number',
      min: '0',
      max: '5',
      step: '0.1',
      placeholder: 'Minimum rating',
      'aria-label': 'Minimum review rating'
    }
  });
  rating.addEventListener('change', () => {
    context.state.filterRating = rating.value;
    context.rerender();
  });
}

function renderReviewList(
  parent: HTMLElement,
  context: Parameters<typeof renderReviewsWorkspace>[0]
): void {
  const reviews = context.reviews.reviewsForBook(context.book.id, {
    ...(context.state.filterSource ? { source: context.state.filterSource } : {}),
    ...(context.state.filterEditionId ? { editionId: context.state.filterEditionId } : {}),
    ...(context.state.filterPermission ? { permissionStatus: context.state.filterPermission } : {}),
    ...(context.state.filterFollowUp ? { followUpStatus: context.state.filterFollowUp } : {}),
    ...(context.state.filterRating ? { minimumRating: Number(context.state.filterRating) } : {})
  });
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `Chronological review log · ${reviews.length}` });
  const list = section.createEl('ol');
  for (const review of reviews) {
    const row = list.createEl('li', { cls: 'pm-panel' });
    row.createEl('strong', {
      text: `${text(review.fields.date, 'Unknown date')} · ${text(review.fields.source, 'Unknown source')} · rating ${text(review.fields.rating, '—')}`
    });
    const link = safeHttpUrl(review.fields['source-link']);
    if (link !== undefined)
      row.createEl('a', {
        text: ' Open source',
        href: link,
        attr: { target: '_blank', rel: 'noopener noreferrer' }
      });
    row.createEl('p', {
      text: `Permission: ${text(review.fields['permission-status'], 'unknown')} · Follow-up: ${text(review.fields['follow-up-status'], 'none')}${typeof review.fields['follow-up-date'] === 'string' ? ` on ${review.fields['follow-up-date']}` : ''}`
    });
    if (typeof review.fields.quote === 'string')
      row.createEl('blockquote', { text: review.fields.quote });
    if (typeof review.fields.reference === 'string')
      row.createEl('p', { text: `Reference: ${review.fields.reference}` });
    const edit = row.createEl('button', {
      cls: 'pm-button pm-button--quiet',
      text: 'Edit evidence',
      attr: { type: 'button' }
    });
    edit.addEventListener('click', () => {
      loadReview(context.state, review);
      context.rerender();
    });
  }
  if (!reviews.length)
    section.createEl('p', { cls: 'pm-muted', text: 'No review evidence matches these filters.' });
}

/** Refuses executable or malformed links if a user hand-edits canonical Markdown. */
function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function reviewInput(context: Parameters<typeof renderReviewsWorkspace>[0]): ReviewInput {
  const state = context.state;
  return {
    bookId: context.book.id,
    ...(state.editionId ? { editionId: state.editionId } : {}),
    source: state.source,
    ...(state.sourceLink ? { sourceLink: state.sourceLink } : {}),
    date: state.date,
    ...(state.rating ? { rating: state.rating } : {}),
    ...(state.quote ? { quote: state.quote } : {}),
    ...(state.reference ? { reference: state.reference } : {}),
    permissionStatus: state.permissionStatus,
    ...(state.permissionNotes ? { permissionNotes: state.permissionNotes } : {}),
    ...(state.followUpDate ? { followUpDate: state.followUpDate } : {}),
    followUpStatus: state.followUpStatus,
    ...(state.notes ? { notes: state.notes } : {})
  };
}
function loadReview(state: ReviewsWorkspaceState, review: CatalogRecord): void {
  Object.assign(state, createReviewsWorkspaceState(), {
    editingId: review.id,
    editionId: text(review.fields['edition-id'], ''),
    source: text(review.fields.source, ''),
    sourceLink: text(review.fields['source-link'], ''),
    date: text(review.fields.date, ''),
    rating: text(review.fields.rating, ''),
    quote: text(review.fields.quote, ''),
    reference: text(review.fields.reference, ''),
    permissionStatus: text(review.fields['permission-status'], 'unknown'),
    permissionNotes: text(review.fields['permission-notes'], ''),
    followUpDate: text(review.fields['follow-up-date'], ''),
    followUpStatus: text(review.fields['follow-up-status'], 'none'),
    notes: text(review.fields.notes, '')
  });
}
function select(
  parent: HTMLElement,
  label: string,
  options: readonly (readonly [string, string])[]
): HTMLSelectElement {
  const control = parent.createEl('select', { attr: { 'aria-label': label } });
  control.createEl('option', { value: '', text: label });
  for (const [value, text] of options) control.createEl('option', { value, text });
  return control;
}
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
