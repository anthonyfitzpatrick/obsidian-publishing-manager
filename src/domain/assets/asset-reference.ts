/**
 * Defines canonical production-asset roles and the pure freshness decision table. Assets remain
 * ordinary vault files: this model owns only safe references and observations, never file bytes.
 */

import type { ManagedRecordEnvelope } from '../records/record-envelope';
import { normalizeVaultPath } from '../storage/vault-path';

/** Stable roles cover every AST-002 deliverable without inferring intent from extensions. */
export const ASSET_ROLES = [
  'cover-psd',
  'cover-pdf',
  'epub',
  'docx',
  'html',
  'markdown',
  'xml',
  'print-file',
  'press-kit',
  'media-image',
  'author-photo'
] as const;

export type AssetRole = (typeof ASSET_ROLES)[number];
export type AssetFreshnessState =
  'current' | 'stale' | 'missing' | 'unknown' | 'externally-managed';

/** Complete canonical link hydrated from one managed Markdown note. */
export interface AssetReference {
  readonly id: string;
  readonly bookId: string;
  readonly editionId?: string;
  readonly formatId?: string;
  readonly path: string;
  readonly role: AssetRole;
  readonly modifiedTime?: string;
  readonly size?: number;
  readonly fingerprint?: string;
  readonly sourceFingerprint?: string;
  readonly notes?: string;
  readonly externallyManaged: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

/** Current host observation is deliberately separate from canonical baseline evidence. */
export interface AssetObservation {
  readonly exists: boolean;
  readonly modifiedTime?: string;
  readonly size?: number;
  readonly verifiedFingerprint?: string;
}

/** Every result carries prose evidence so UI never relies on color or an unexplained badge. */
export interface AssetFreshnessAssessment {
  readonly state: AssetFreshnessState;
  readonly evidence: readonly string[];
  readonly limitation: string;
}

export interface AssetDiagnostic {
  readonly field:
    | 'bookId'
    | 'editionId'
    | 'formatId'
    | 'path'
    | 'role'
    | 'modifiedTime'
    | 'size'
    | 'fingerprint'
    | 'sourceFingerprint'
    | 'notes';
  readonly message: string;
}

/** Validates user-authored canonical state without touching or guessing about the target file. */
export function validateAssetReference(
  fields: Readonly<Record<string, unknown>>
): readonly AssetDiagnostic[] {
  const diagnostics: AssetDiagnostic[] = [];
  if (!isManagedId(fields['book-id']))
    diagnostics.push({ field: 'bookId', message: 'Choose one valid book.' });
  for (const field of ['edition-id', 'format-id'] as const) {
    const value = fields[field];
    if (value !== undefined && !isManagedId(value))
      diagnostics.push({
        field: field === 'edition-id' ? 'editionId' : 'formatId',
        message: `${field} must be a stable Publishing Manager identity.`
      });
  }
  try {
    if (typeof fields.path !== 'string') throw new Error();
    normalizeVaultPath(fields.path);
  } catch {
    diagnostics.push({ field: 'path', message: 'Choose an unambiguous vault-relative file path.' });
  }
  if (typeof fields.role !== 'string' || !isAssetRole(fields.role))
    diagnostics.push({ field: 'role', message: `Choose one of: ${ASSET_ROLES.join(', ')}.` });
  if (fields['modified-time'] !== undefined && !isIsoDateTime(fields['modified-time']))
    diagnostics.push({
      field: 'modifiedTime',
      message: 'Modified time must be a real ISO date-time.'
    });
  if (
    fields.size !== undefined &&
    (typeof fields.size !== 'number' || !Number.isSafeInteger(fields.size) || fields.size < 0)
  )
    diagnostics.push({ field: 'size', message: 'Size must be a non-negative whole byte count.' });
  for (const field of ['fingerprint', 'source-fingerprint'] as const) {
    const value = fields[field];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim().length === 0 || value.length > 160)
    )
      diagnostics.push({
        field: field === 'fingerprint' ? 'fingerprint' : 'sourceFingerprint',
        message: `${field} must be non-empty text no longer than 160 characters.`
      });
  }
  if (
    fields.notes !== undefined &&
    (typeof fields.notes !== 'string' || fields.notes.length > 8_000)
  )
    diagnostics.push({
      field: 'notes',
      message: 'Notes must be text no longer than 8,000 characters.'
    });
  return diagnostics;
}

/** Hydrates only after schema and domain validation have succeeded. */
export function hydrateAssetReference(snapshot: {
  readonly envelope: ManagedRecordEnvelope;
  readonly fields: Readonly<Record<string, unknown>>;
}): AssetReference {
  const diagnostics = validateAssetReference(snapshot.fields);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(({ message }) => message).join(' '));
  return {
    id: snapshot.envelope.pmId,
    bookId: snapshot.fields['book-id'] as string,
    ...(typeof snapshot.fields['edition-id'] === 'string'
      ? { editionId: snapshot.fields['edition-id'] }
      : {}),
    ...(typeof snapshot.fields['format-id'] === 'string'
      ? { formatId: snapshot.fields['format-id'] }
      : {}),
    path: snapshot.fields.path as string,
    role: snapshot.fields.role as AssetRole,
    ...(typeof snapshot.fields['modified-time'] === 'string'
      ? { modifiedTime: snapshot.fields['modified-time'] }
      : {}),
    ...(typeof snapshot.fields.size === 'number' ? { size: snapshot.fields.size } : {}),
    ...(typeof snapshot.fields.fingerprint === 'string'
      ? { fingerprint: snapshot.fields.fingerprint }
      : {}),
    ...(typeof snapshot.fields['source-fingerprint'] === 'string'
      ? { sourceFingerprint: snapshot.fields['source-fingerprint'] }
      : {}),
    ...(typeof snapshot.fields.notes === 'string' ? { notes: snapshot.fields.notes } : {}),
    externallyManaged: snapshot.fields['externally-managed'] === true,
    createdAt: snapshot.envelope.createdAt,
    updatedAt: snapshot.envelope.updatedAt,
    ...(snapshot.envelope.archivedAt === undefined
      ? {}
      : { archivedAt: snapshot.envelope.archivedAt })
  };
}

/** Applies the documented precedence: missing beats all evidence; external ownership beats age. */
export function assessAssetFreshness(
  asset: AssetReference,
  observation: AssetObservation
): AssetFreshnessAssessment {
  if (!observation.exists)
    return {
      state: 'missing',
      evidence: [`No vault file resolves at ${asset.path}.`],
      limitation:
        'The reference is retained. Relink it or restore the file; Publishing Manager never deletes the record automatically.'
    };
  if (asset.externallyManaged)
    return {
      state: 'externally-managed',
      evidence: [
        'The user marked this asset as externally managed.',
        ...metadataEvidence(asset, observation)
      ],
      limitation:
        'Publishing Manager reports existence and observations but does not claim that an external production process is current.'
    };
  if (
    asset.modifiedTime === undefined &&
    asset.size === undefined &&
    asset.fingerprint === undefined
  )
    return {
      state: 'unknown',
      evidence: ['The file exists, but no comparison baseline has been captured.'],
      limitation: 'Capture metadata or opt in to a content fingerprint before relying on freshness.'
    };
  const mismatches: string[] = [];
  if (asset.modifiedTime !== undefined && observation.modifiedTime !== asset.modifiedTime)
    mismatches.push(
      `Modified time changed from ${asset.modifiedTime} to ${observation.modifiedTime ?? 'unknown'}.`
    );
  if (asset.size !== undefined && observation.size !== asset.size)
    mismatches.push(`Size changed from ${asset.size} to ${observation.size ?? 'unknown'} bytes.`);
  if (
    asset.fingerprint !== undefined &&
    observation.verifiedFingerprint !== undefined &&
    asset.fingerprint !== observation.verifiedFingerprint
  )
    mismatches.push('The verified SHA-256 content fingerprint differs from the cached baseline.');
  if (mismatches.length > 0)
    return {
      state: 'stale',
      evidence: mismatches,
      limitation:
        observation.verifiedFingerprint === undefined
          ? 'Metadata differences prove change. Matching metadata alone cannot prove identical content; fingerprint verification is opt-in.'
          : 'A content mismatch is strong evidence that the linked output changed.'
    };
  return {
    state: 'current',
    evidence: metadataEvidence(asset, observation),
    limitation:
      observation.verifiedFingerprint === undefined
        ? 'Current means the available cached metadata still matches. It is not a byte-for-byte guarantee until fingerprint verification runs.'
        : 'The current file matches the cached SHA-256 fingerprint.'
  };
}

export function isAssetRole(value: string): value is AssetRole {
  return (ASSET_ROLES as readonly string[]).includes(value);
}
function isManagedId(value: unknown): value is string {
  return typeof value === 'string' && /^pm-[a-z0-9][a-z0-9-]{7,127}$/u.test(value);
}
function isIsoDateTime(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T');
}
function metadataEvidence(asset: AssetReference, observation: AssetObservation): string[] {
  const evidence = ['The vault file exists.'];
  if (asset.modifiedTime !== undefined)
    evidence.push(`Modified time matches ${observation.modifiedTime}.`);
  if (asset.size !== undefined) evidence.push(`Size matches ${observation.size} bytes.`);
  if (asset.fingerprint !== undefined)
    evidence.push(
      observation.verifiedFingerprint === undefined
        ? 'A cached SHA-256 fingerprint exists but was not recomputed during this view.'
        : 'The recomputed SHA-256 fingerprint matches the cached baseline.'
    );
  if (asset.sourceFingerprint !== undefined)
    evidence.push(`Source fingerprint recorded: ${asset.sourceFingerprint}.`);
  return evidence;
}
