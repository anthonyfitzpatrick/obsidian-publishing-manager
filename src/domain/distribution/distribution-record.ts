/** Pure DST-001/DST-003/DST-005/DST-006 contracts; no function owns a network capability. */
export const DISTRIBUTION_REVIEW_STATES = [
  'not-submitted',
  'submitted',
  'in-review',
  'approved',
  'changes-requested'
] as const;
export const DISTRIBUTION_PUBLICATION_STATES = [
  'not-planned',
  'preorder',
  'published',
  'unpublished'
] as const;
export const DISTRIBUTION_NO_CLIENT_DISCLOSURE =
  'Publishing Manager records manual evidence only. It does not log in, upload, scrape, poll, call retailer APIs, or store credentials.';

export interface DistributionDiagnostic {
  readonly field: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export function validatePlatformProfile(
  fields: Readonly<Record<string, unknown>>,
  today: string
): readonly DistributionDiagnostic[] {
  const d: DistributionDiagnostic[] = [];
  for (const field of ['slug', 'label', 'official-url'])
    if (typeof fields[field] !== 'string' || !fields[field])
      d.push(error(field, `${field} is required.`));
  if (!Number.isSafeInteger(fields.version) || Number(fields.version) < 1)
    d.push(error('version', 'Profile version must be a positive integer.'));
  if (
    typeof fields.requirements !== 'object' ||
    fields.requirements === null ||
    Array.isArray(fields.requirements)
  )
    d.push(error('requirements', 'Requirements must be a structured object.'));
  if (
    typeof fields['reviewed-at'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(fields['reviewed-at'])
  )
    d.push(error('reviewed-at', 'Review date must use YYYY-MM-DD.'));
  else if (daysBetween(fields['reviewed-at'], today) > 180)
    d.push(
      warning(
        'reviewed-at',
        'Profile requirements were reviewed more than 180 days ago; verify the official source.'
      )
    );
  return d;
}

export function validatePlatformTarget(
  fields: Readonly<Record<string, unknown>>
): readonly DistributionDiagnostic[] {
  const d: DistributionDiagnostic[] = [];
  for (const field of ['edition-id', 'profile-id', 'platform', 'publication-location'])
    if (typeof fields[field] !== 'string' || !fields[field])
      d.push(error(field, `${field} is required.`));
  if (typeof fields.territory !== 'string' || !/^[A-Z]{2}$/u.test(fields.territory))
    d.push(error('territory', 'Territory must be an uppercase two-letter country code.'));
  for (const field of ['intent', 'metadata-ready', 'assets-ready', 'pricing-ready'])
    if (typeof fields[field] !== 'boolean') d.push(error(field, `${field} must be explicit.`));
  if (!(DISTRIBUTION_REVIEW_STATES as readonly unknown[]).includes(fields['review-state']))
    d.push(error('review-state', 'Review state is unsupported.'));
  if (
    !(DISTRIBUTION_PUBLICATION_STATES as readonly unknown[]).includes(fields['publication-state'])
  )
    d.push(error('publication-state', 'Publication state is unsupported.'));
  if (!Number.isSafeInteger(fields['profile-version']))
    d.push(error('profile-version', 'Target must retain its reviewed profile version.'));
  return d;
}

export function targetReadiness(fields: Readonly<Record<string, unknown>>): {
  ready: boolean;
  reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (fields.intent !== true) reasons.push('Distribution intent is not enabled.');
  if (fields['metadata-ready'] !== true) reasons.push('Metadata is not confirmed ready.');
  if (fields['assets-ready'] !== true) reasons.push('Assets are not confirmed ready.');
  if (fields['pricing-ready'] !== true) reasons.push('Pricing is not confirmed ready.');
  if (
    typeof fields.checklist === 'object' &&
    fields.checklist !== null &&
    'items' in fields.checklist &&
    Array.isArray(fields.checklist.items)
  )
    for (const item of fields.checklist.items as unknown[])
      if (
        typeof item === 'object' &&
        item !== null &&
        'done' in item &&
        item.done !== true &&
        'label' in item
      )
        reasons.push(`Checklist: ${String(item.label)}`);
  return { ready: reasons.length === 0, reasons };
}
function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
function error(field: string, message: string): DistributionDiagnostic {
  return { field, severity: 'error', message };
}
function warning(field: string, message: string): DistributionDiagnostic {
  return { field, severity: 'warning', message };
}
