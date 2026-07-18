import { Plugin } from 'obsidian';

import { GetFoundationStatus } from './application/foundation/get-foundation-status';
import { BookProjectService } from './application/books/book-project-service';
import { BookCatalog } from './application/catalog/book-catalog';
import { ManagedFolderLayout } from './domain/storage/managed-folder-layout';
import { ObsidianBookCatalogController } from './infrastructure/catalog/obsidian-book-catalog-controller';
import { SilentLogger } from './infrastructure/diagnostics/silent-logger';
import { BrowserIdGenerator } from './infrastructure/platform/browser-id-generator';
import { SystemClock } from './infrastructure/platform/system-clock';
import { ObsidianFrontmatterCodec } from './infrastructure/storage/obsidian-frontmatter-codec';
import { ObsidianVaultTextPort } from './infrastructure/storage/obsidian-vault-text-port';
import { VaultManagedRecordRepository } from './infrastructure/storage/vault-managed-record-repository';
import { registerBookCommands } from './ui/commands/register-book-commands';
import { registerFoundationCommand } from './ui/commands/register-foundation-command';
import { PublishingManagerSettingsTab } from './ui/settings/publishing-manager-settings-tab';

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
    const catalogController = new ObsidianBookCatalogController(
      this.app.vault,
      layout.rootPath(),
      catalog,
      logger
    );
    catalogController.register(this);
    await catalogController.initialize();

    registerFoundationCommand(this, getFoundationStatus);
    registerBookCommands(this, books);
    this.addSettingTab(new PublishingManagerSettingsTab(this.app, this));
  }
}
