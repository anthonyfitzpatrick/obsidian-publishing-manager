/** Obsidian-only SET-003 folder inventory and rename adapter; it never reads file contents. */
import type { Vault } from 'obsidian';
import type { ManagedStorageMovePort } from '../../application/settings/publishing-settings-service';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';

export class ObsidianManagedStoragePort implements ManagedStorageMovePort {
  public constructor(private readonly vault: Vault) {}

  public async exists(path: VaultPath): Promise<boolean> {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  /** The sorted path inventory is lightweight mutation evidence, not a read or backup. */
  public async listPaths(root: VaultPath): Promise<readonly VaultPath[]> {
    return this.vault
      .getAllLoadedFiles()
      .map(({ path }) => path)
      .filter((path) => path === root || path.startsWith(`${root}/`))
      .map(normalizeVaultPath)
      .sort();
  }

  /** Vault.rename moves the abstract folder tree through the supported host API. */
  public async rename(source: VaultPath, target: VaultPath): Promise<void> {
    const entry = this.vault.getAbstractFileByPath(source);
    if (entry === null) throw new Error(`Managed storage source is missing: ${source}.`);
    if (this.vault.getAbstractFileByPath(target) !== null)
      throw new Error(`Managed storage target already exists: ${target}.`);
    await this.vault.rename(entry, target);
  }
}
