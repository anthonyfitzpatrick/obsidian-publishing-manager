/** Pure REV-001 validation for permission-aware, bounded review evidence. */
import { shiftDateOnly } from '../launch/launch-plan';
import { safeExternalHttpUrl } from '../security/untrusted-data';

export type ReviewPermissionStatus = 'unknown' | 'not-required' | 'obtained' | 'restricted';
export type ReviewFollowUpStatus = 'none' | 'open' | 'done' | 'dismissed';
export interface ReviewInput {
  readonly bookId: string;
  readonly editionId?: string;
  readonly source: string;
  readonly sourceLink?: string;
  readonly date: string;
  readonly rating?: string;
  readonly quote?: string;
  readonly reference?: string;
  readonly permissionStatus: ReviewPermissionStatus;
  readonly permissionNotes?: string;
  readonly followUpDate?: string;
  readonly followUpStatus: ReviewFollowUpStatus;
  readonly notes?: string;
}
export interface NormalizedReview extends ReviewInput {
  readonly source: string;
}

export function normalizeReview(input: ReviewInput): NormalizedReview {
  const source = input.source.trim();
  if (!source) throw new Error('Review source is required.');
  shiftDateOnly(input.date, 0, false);
  if (input.followUpDate !== undefined) shiftDateOnly(input.followUpDate, 0, false);
  const sourceLink = optional(input.sourceLink);
  if (sourceLink !== undefined && safeExternalHttpUrl(sourceLink) === undefined)
    throw new Error('Review source link must use bounded HTTP or HTTPS without credentials.');
  const rating = optional(input.rating);
  if (rating !== undefined) {
    if (!/^\d(?:\.\d+)?$/u.test(rating) || Number(rating) < 0 || Number(rating) > 5)
      throw new Error('Review rating must be a decimal from 0 to 5.');
  }
  const quote = optional(input.quote);
  if (quote !== undefined && quote.length > 500)
    throw new Error(
      'Review quote evidence is limited to 500 characters; store a source reference instead.'
    );
  const permissionNotes = optional(input.permissionNotes);
  if (quote !== undefined && input.permissionStatus === 'unknown' && permissionNotes === undefined)
    throw new Error('Quoted text requires permission status or permission notes.');
  if (input.followUpStatus === 'open' && input.followUpDate === undefined)
    throw new Error('Open review follow-up requires a date.');
  return {
    bookId: input.bookId,
    ...(input.editionId === undefined ? {} : { editionId: input.editionId }),
    source,
    ...(sourceLink === undefined ? {} : { sourceLink }),
    date: input.date,
    ...(rating === undefined ? {} : { rating: trimDecimal(rating) }),
    ...(quote === undefined ? {} : { quote }),
    ...(optional(input.reference) === undefined ? {} : { reference: optional(input.reference)! }),
    permissionStatus: input.permissionStatus,
    ...(permissionNotes === undefined ? {} : { permissionNotes }),
    ...(input.followUpDate === undefined ? {} : { followUpDate: input.followUpDate }),
    followUpStatus: input.followUpStatus,
    ...(optional(input.notes) === undefined ? {} : { notes: optional(input.notes)! })
  };
}
function optional(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}
function trimDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/u, '');
  return trimmed ? `${whole}.${trimmed}` : whole!;
}
