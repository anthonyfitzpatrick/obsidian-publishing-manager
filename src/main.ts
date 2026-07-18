import { Plugin } from 'obsidian';

import { GetFoundationStatus } from './application/foundation/get-foundation-status';
import { BookProjectService } from './application/books/book-project-service';
import { BookCatalog } from './application/catalog/book-catalog';
import { EditionProjectService } from './application/editions/edition-project-service';
import { AssetReferenceService } from './application/assets/asset-reference-service';
import { WorkflowProjectService } from './application/workflows/workflow-project-service';
import { ManagedFolderLayout } from './domain/storage/managed-folder-layout';
import { ObsidianBookCatalogController } from './infrastructure/catalog/obsidian-book-catalog-controller';
import { SilentLogger } from './infrastructure/diagnostics/silent-logger';
import { BrowserIdGenerator } from './infrastructure/platform/browser-id-generator';
import { SystemClock } from './infrastructure/platform/system-clock';
import { ObsidianFrontmatterCodec } from './infrastructure/storage/obsidian-frontmatter-codec';
import { ObsidianVaultTextPort } from './infrastructure/storage/obsidian-vault-text-port';
import {
  ObsidianVaultAssetPort,
  WebCryptoContentFingerprintPort
} from './infrastructure/storage/obsidian-vault-asset-port';
import { VaultManagedRecordRepository } from './infrastructure/storage/vault-managed-record-repository';
import { registerBookCommands } from './ui/commands/register-book-commands';
import { registerFoundationCommand } from './ui/commands/register-foundation-command';
import { registerWorkflowCommands } from './ui/commands/register-workflow-commands';
import { PublishingManagerSettingsTab } from './ui/settings/publishing-manager-settings-tab';
import { BookDraftStore } from './ui/state/book-draft-store';
import { registerPublishingViews } from './ui/views/register-publishing-views';

export default class PublishingManagerPlugin extends Plugin {
  /**
   * Composes the local-only runtime, registers event cleanup before catalog hydration, and exposes
   * commands only after all dependencies exist. Invalid managed notes become catalog diagnostics
   * and therefore do not prevent the plugin itself from loading.
   */
  public override async onload(): Promise<void> {
    const clock = new SystemClock();
    const ids = new BrowserIdGenerator();
    const logger = new SilentLogger();
    const getFoundationStatus = new GetFoundationStatus(clock, ids);

    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const repository = new VaultManagedRecordRepository(
      new ObsidianVaultTextPort(this.app.vault),
      new ObsidianFrontmatterCodec()
    );
    const catalog = new BookCatalog(repository, clock);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const editions = new EditionProjectService(repository, catalog, layout, clock, ids);
    const assets = new AssetReferenceService(
      repository,
      catalog,
      layout,
      new ObsidianVaultAssetPort(this.app.vault),
      new WebCryptoContentFingerprintPort(),
      clock,
      ids
    );
    const workflows = new WorkflowProjectService(repository, catalog, layout, clock, ids);
    const drafts = new BookDraftStore();
    const catalogController = new ObsidianBookCatalogController(
      this.app.vault,
      layout.rootPath(),
      catalog,
      logger,
      assets
    );
    catalogController.register(this);
    await catalogController.initialize();

    registerFoundationCommand(this, getFoundationStatus);
    registerBookCommands(this, books);
    registerWorkflowCommands(this, catalog, workflows);
    registerPublishingViews(this, catalog, books, editions, assets, drafts, () =>
      catalogController.initialize()
    );
    this.addSettingTab(new PublishingManagerSettingsTab(this.app, this));
  }
}
