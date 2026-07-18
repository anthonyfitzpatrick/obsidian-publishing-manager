/**
 * Supplies deterministic source revisions for optimistic conflict detection and disposable
 * indexes. This is deliberately non-cryptographic: it detects changed text, not adversarial
 * tampering. Callers always compare the full fingerprint and never treat it as an identity or
 * security boundary.
 */

/** Computes a stable 32-bit FNV-1a fingerprint with length mixed into the readable output. */
export function fingerprintSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `src-${source.length.toString(36)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
