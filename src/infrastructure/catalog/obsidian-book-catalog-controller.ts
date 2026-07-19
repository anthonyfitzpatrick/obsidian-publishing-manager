/**
 * Connects Obsidian vault lifecycle events to the disposable book catalog. Event payloads provide
 * only paths; the catalog rereads authoritative Markdown through its repository inspection port.
 * Filtering stays inside the configured managed root, and every asynchronous failure is retained
 * locally through the logger without interrupting unrelated Obsidian event processing.
 */

import { TFile, type Plugin, type TAbstractFile, type Vault } from 'obsidian';

import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { AssetReferenceService } from '../../application/assets/asset-reference-service';
import type { Logger } from '../../domain/foundation/logger';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';

/** Registers incremental create/modify/rename/delete reconciliation and initial reload scanning. */
export class ObsidianBookCatalogController {
  /** Receives the host Vault event surface, validated root, catalog, and local-only logger. */
  public constructor(
    private readonly vault: Vault,
    private root: VaultPath,
    private readonly catalog: BookCatalog,
    private readonly logger: Logger,
    private readonly assets?: AssetReferenceService
  ) {}

  /** Switches event filtering only after a completed journaled managed-root move. */
  public setRoot(root: VaultPath): void {
    this.root = root;
  }

  /** Registers event cleanup with the owning plugin before the first asynchronous catalog scan. */
  public register(plugin: Plugin): void {
    plugin.registerEvent(
      this.vault.on('create', (file) => {
        if (this.isManagedMarkdown(file)) {
          void this.reconcile(file.path, 'created');
        }
      })
    );
    plugin.registerEvent(
      this.vault.on('modify', (file) => {
        this.assets?.notifyFileChanged();
        if (this.isManagedMarkdown(file)) {
          void this.reconcile(file.path, 'modified');
        }
      })
    );
    plugin.registerEvent(
      this.vault.on('rename', (file, previousPath) => {
        if (file instanceof TFile) void this.reconcileAssetRename(previousPath, file.path);
        const wasManaged = this.isManagedPath(previousPath);
        const isManaged = this.isManagedMarkdown(file);
        if (wasManaged && isManaged) {
          void this.reconcileRename(previousPath, file.path);
        } else if (wasManaged) {
          this.catalog.remove(normalizeVaultPath(previousPath));
        } else if (isManaged) {
          void this.reconcile(file.path, 'created');
        }
      })
    );
    plugin.registerEvent(
      this.vault.on('delete', (file) => {
        this.assets?.notifyFileChanged();
        if (this.isManagedPath(file.path) && file.path.toLowerCase().endsWith('.md')) {
          this.catalog.remove(normalizeVaultPath(file.path));
        }
      })
    );
  }

  /** Lets arbitrary production-file moves update exact canonical references without copying data. */
  private async reconcileAssetRename(previousPath: string, nextPath: string): Promise<void> {
    try {
      await this.assets?.handleRename(previousPath, nextPath);
    } catch (error) {
      this.logger.error('Asset reference rename reconciliation failed.', {
        previousPath,
        nextPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /** Rebuilds lightweight state from all managed Markdown notes after plugin/app reload. */
  public async initialize(): Promise<void> {
    try {
      const paths = this.vault
        .getMarkdownFiles()
        .map((file) => file.path)
        .filter((path) => this.isManagedPath(path))
        .map((path) => normalizeVaultPath(path));
      await this.catalog.initialize(paths);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Catalog rebuild failed.';
      this.catalog.markError(message);
      this.logger.error('Catalog initialization failed.', { error: message });
    }
  }

  /** Safely reconciles one event without allowing an async rejection to escape Obsidian. */
  private async reconcile(path: string, action: 'created' | 'modified'): Promise<void> {
    try {
      await this.catalog.reconcile(normalizeVaultPath(path), action);
    } catch (error) {
      this.logger.error('Catalog event reconciliation failed.', {
        path,
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /** Safely reconciles an in-root rename using both old and new vault-relative paths. */
  private async reconcileRename(previousPath: string, nextPath: string): Promise<void> {
    try {
      await this.catalog.rename(normalizeVaultPath(previousPath), normalizeVaultPath(nextPath));
    } catch (error) {
      this.logger.error('Catalog rename reconciliation failed.', {
        previousPath,
        nextPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /** Accepts Markdown files only; folders and non-Markdown assets never enter record inspection. */
  private isManagedMarkdown(file: TAbstractFile): file is TFile {
    return (
      file instanceof TFile &&
      file.extension.toLowerCase() === 'md' &&
      this.isManagedPath(file.path)
    );
  }

  /** Uses a segment boundary so similarly prefixed user folders cannot be captured accidentally. */
  private isManagedPath(path: string): boolean {
    return path === this.root || path.startsWith(`${this.root}/`);
  }
}
