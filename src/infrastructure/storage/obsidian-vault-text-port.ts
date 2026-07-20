/**
 * Implements the storage port exclusively through supported Obsidian Vault APIs. It never imports
 * Node filesystem or Electron modules, never resolves an operating-system path, and works on
 * desktop and mobile. Folder creation is incremental because Obsidian requires each parent to
 * exist before its child can be created.
 */

import { TFile, type Vault } from 'obsidian';

import type { VaultTextPort } from '../../application/storage/record-storage-ports';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';

/** User-facing storage failure when a safe path does not resolve to the required file kind. */
export class VaultTextFileError extends Error {
  /** Creates an adapter failure containing only the safe vault-relative target. */
  public constructor(message: string) {
    super(message);
    this.name = 'VaultTextFileError';
  }
}

/** Thin production adapter around Obsidian's atomic text-file operations. */
export class ObsidianVaultTextPort implements VaultTextPort {
  /** Receives the host Vault capability; no operating-system capability is accepted. */
  public constructor(private readonly vault: Vault) {}

  /** Checks vault-relative existence without reaching outside the Obsidian sandbox. */
  public async exists(path: VaultPath): Promise<boolean> {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  /**
   * Reads the authoritative file contents directly from the vault.
   *
   * Obsidian's `cachedRead` is useful when callers prefer speed over freshness, but this port sits
   * on the reconciliation and optimistic-concurrency boundary. An editor outside Obsidian can
   * replace a managed Markdown note before Obsidian's text cache has been refreshed. Reading that
   * stale cache would leave the catalog showing the previous frontmatter and could also compare a
   * later plugin save against the wrong source revision. The uncached host read keeps external
   * Markdown edits authoritative while still using only Obsidian's supported Vault API.
   */
  public async read(path: VaultPath): Promise<string> {
    return this.vault.read(this.requireFile(path));
  }

  /** Creates a new note; callers must have checked collisions and prepared its parent folder. */
  public async create(path: VaultPath, source: string): Promise<void> {
    await this.vault.create(path, source);
  }

  /** Uses Vault.process so revision comparison and transformation form one atomic host operation. */
  public async process(path: VaultPath, transform: (current: string) => string): Promise<string> {
    return this.vault.process(this.requireFile(path), transform);
  }

  /** Creates absent folder segments without treating an existing file as a folder. */
  public async ensureFolder(path: VaultPath): Promise<void> {
    const segments = path.split('/');
    let current = '';
    for (const segment of segments) {
      current = current.length === 0 ? segment : `${current}/${segment}`;
      const normalized = normalizeVaultPath(current);
      const existing = this.vault.getAbstractFileByPath(normalized);
      if (existing instanceof TFile) {
        throw new VaultTextFileError(
          `Cannot create folder because a file exists at ${normalized}.`
        );
      }
      if (existing === null) {
        await this.vault.createFolder(normalized);
      }
    }
  }

  /** Resolves a safe path to a text file and rejects missing/folder targets explicitly. */
  private requireFile(path: VaultPath): TFile {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new VaultTextFileError(`Managed record file is missing or not a file: ${path}.`);
    }
    return file;
  }
}
