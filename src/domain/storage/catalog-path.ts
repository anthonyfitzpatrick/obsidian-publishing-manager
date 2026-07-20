/**
 * Decides whether one managed-root Markdown path can be a canonical record. Human-facing exports
 * and internal journal receipts live alongside records for local discoverability, but neither is
 * a record envelope and therefore neither belongs in validation or catalog projections.
 */
import { normalizeVaultPath, type VaultPath } from './vault-path';

export function isCatalogCandidatePath(root: VaultPath, path: string): boolean {
  const candidate = normalizeVaultPath(path);
  if (candidate === root) return true;
  if (!candidate.startsWith(`${root}/`)) return false;
  const relative = candidate.slice(root.length + 1);
  return !(
    relative === 'Exports' ||
    relative.startsWith('Exports/') ||
    relative === 'System' ||
    relative.startsWith('System/')
  );
}
