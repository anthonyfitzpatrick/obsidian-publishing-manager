import { Plugin } from 'obsidian';

import { GetFoundationStatus } from './application/foundation/get-foundation-status';
import { BookProjectService } from './application/books/book-project-service';
import { BookCatalog } from './application/catalog/book-catalog';
import { EditionProjectService } from './application/editions/edition-project-service';
import { AssetReferenceService } from './application/assets/asset-reference-service';
import { WorkflowProjectService } from './application/workflows/workflow-project-service';
import { MetadataProjectService } from './application/metadata/metadata-project-service';
import { ClassificationLicenseService } from './application/metadata/classification-license-service';
import { IsbnProjectService } from './application/isbn/isbn-project-service';
import { PriceProjectService } from './application/pricing/price-project-service';
import { DistributionProjectService } from './application/distribution/distribution-project-service';
import { ReadinessProjectService } from './application/readiness/readiness-project-service';
import { DashboardPreferencesService } from './application/dashboard/dashboard-preferences-service';
import { SalesProjectService } from './application/sales/sales-project-service';
import { LaunchProjectService } from './application/launch/launch-project-service';
import { CalendarProjectService } from './application/calendar/calendar-project-service';
import { ReviewProjectService } from './application/reviews/review-project-service';
import { HistoryPreferencesService } from './application/history/history-preferences-service';
import { HistoryProjectService } from './application/history/history-project-service';
import { HistoryRecordingRepository } from './application/history/history-recording-repository';
import { TemplateProjectService } from './application/templates/template-project-service';
import { PublishingExportService } from './application/exports/publishing-export-service';
import { PublishingSettingsService } from './application/settings/publishing-settings-service';
import { DiagnosticsService } from './application/diagnostics/diagnostics-service';
import { ManuscriptCompilerIntegrationService } from './application/integrations/manuscript-compiler-integration';
import { JournaledOperationRunner } from './application/storage/operation-journal';
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
import { VaultOperationJournalStore } from './infrastructure/storage/vault-operation-journal-store';
import { ObsidianManagedStoragePort } from './infrastructure/settings/obsidian-managed-storage-port';
import {
  BrowserCompilerCapabilityTransport,
  BrowserCompilerTimer
} from './infrastructure/integrations/browser-compiler-capability-transport';
import { registerBookCommands } from './ui/commands/register-book-commands';
import { registerFoundationCommand } from './ui/commands/register-foundation-command';
import { registerWorkflowCommands } from './ui/commands/register-workflow-commands';
import { PublishingManagerSettingsTab } from './ui/settings/publishing-manager-settings-tab';
import { BookDraftStore } from './ui/state/book-draft-store';
import { registerPublishingViews } from './ui/views/register-publishing-views';
import { registerTemplateLibraryView } from './ui/views/template-library-view';
import { registerPublishingExportView } from './ui/views/publishing-export-view';
import { registerDiagnosticsView } from './ui/views/diagnostics-view';
import { registerManuscriptCompilerIntegrationView } from './ui/views/manuscript-compiler-integration-view';

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
    const pluginData = {
      load: () => this.loadData(),
      save: (value: unknown) => this.saveData(value)
    };
    // Settings load before the layout so a previously reviewed managed-root move is authoritative
    // on the next startup. Storage moves themselves use only Obsidian's abstract-file rename API.
    const settings = new PublishingSettingsService(
      pluginData,
      new ObsidianManagedStoragePort(this.app.vault),
      clock
    );
    await settings.initialize();
    // Plugin data stores only local acceptance/evidence. It never contains or retrieves a vendor
    // vocabulary, and the service preserves unrelated settings on every write.
    const classificationLicenses = new ClassificationLicenseService(pluginData, clock);
    await classificationLicenses.initialize();

    const layout = new ManagedFolderLayout({ root: settings.current().storage.managedRoot });
    const vaultText = new ObsidianVaultTextPort(this.app.vault);
    const frontmatter = new ObsidianFrontmatterCodec();
    const canonicalRepository = new VaultManagedRecordRepository(vaultText, frontmatter);
    const catalog = new BookCatalog(canonicalRepository, clock);
    const historyPreferences = new HistoryPreferencesService(pluginData);
    await historyPreferences.initialize();
    const history = new HistoryProjectService(
      canonicalRepository,
      catalog,
      layout,
      clock,
      ids,
      historyPreferences
    );
    // Every successful application write crosses this decorator. History writes use the canonical
    // repository directly, so evidence cannot recursively generate evidence about itself.
    const repository = new HistoryRecordingRepository(canonicalRepository, history);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);
    const vaultAssets = new ObsidianVaultAssetPort(this.app.vault);
    const editions = new EditionProjectService(
      repository,
      catalog,
      layout,
      clock,
      ids,
      vaultAssets
    );
    const assets = new AssetReferenceService(
      repository,
      catalog,
      layout,
      vaultAssets,
      new WebCryptoContentFingerprintPort(),
      clock,
      ids
    );
    // WFL-012 batch edits reuse the same durable, human-readable journal boundary as migrations.
    // A crash can therefore resume pending task steps instead of silently leaving a partial batch.
    const workflowJournalStore = new VaultOperationJournalStore(
      `${layout.rootPath()}/System/Journals`,
      vaultText,
      frontmatter
    );
    const workflowJournals = new JournaledOperationRunner(workflowJournalStore);
    const workflows = new WorkflowProjectService(
      repository,
      catalog,
      layout,
      clock,
      ids,
      workflowJournals
    );
    const metadata = new MetadataProjectService(repository, catalog, layout, clock, ids);
    const isbns = new IsbnProjectService(repository, catalog, layout, clock, ids);
    const prices = new PriceProjectService(repository, catalog, layout, clock, ids);
    const distribution = new DistributionProjectService(repository, catalog, layout, clock, ids);
    const readiness = new ReadinessProjectService(repository, catalog, layout, assets, clock, ids);
    const dashboardPreferences = new DashboardPreferencesService(pluginData);
    const sales = new SalesProjectService(repository, catalog, layout, clock, ids);
    const launches = new LaunchProjectService(repository, catalog, workflows, layout, clock, ids);
    const calendar = new CalendarProjectService(catalog, workflows, vaultText, layout, clock);
    const reviews = new ReviewProjectService(repository, catalog, layout, clock, ids);
    const templates = new TemplateProjectService(
      repository,
      catalog,
      layout,
      vaultText,
      clock,
      ids
    );
    // Export planning consumes the same canonical catalog, readiness, sales, and calendar
    // projections as the interactive workspaces. The coordinator receives only a text-write port,
    // so it cannot read or duplicate linked binary production assets.
    const exports = new PublishingExportService(
      catalog,
      canonicalRepository,
      readiness,
      sales,
      calendar,
      vaultText,
      layout,
      clock
    );
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
    // Diagnostics owns only read projections, one local text-export port, and the same derived
    // catalog refresh callback as the Dashboard. It cannot save or delete canonical records.
    const diagnostics = new DiagnosticsService(catalog, settings, vaultText, layout, clock, () =>
      catalogController.initialize()
    );
    // The compiler coordinator uses a browser-local versioned event transport. No Compiler module
    // or private plugin instance enters this composition root, and an absent provider is normal.
    const compilerTransport = new BrowserCompilerCapabilityTransport();
    const compilerIntegration = new ManuscriptCompilerIntegrationService(
      catalog,
      settings,
      compilerTransport,
      clock,
      ids,
      new BrowserCompilerTimer()
    );
    // Result listening is app-lifetime rather than view-lifetime so a closed integration tab does
    // not cause a valid asynchronous completion event to disappear silently.
    this.register(compilerIntegration.start());

    registerFoundationCommand(this, getFoundationStatus);
    registerBookCommands(this, books);
    registerWorkflowCommands(this, catalog, workflows);
    registerPublishingViews(
      this,
      catalog,
      books,
      editions,
      assets,
      workflows,
      metadata,
      isbns,
      prices,
      distribution,
      readiness,
      dashboardPreferences,
      sales,
      launches,
      calendar,
      reviews,
      history,
      historyPreferences,
      drafts,
      () => catalogController.initialize()
    );
    registerTemplateLibraryView(this, catalog, templates);
    registerPublishingExportView(this, catalog, exports);
    registerDiagnosticsView(this, diagnostics);
    registerManuscriptCompilerIntegrationView(this, catalog, compilerIntegration, editions);
    this.addSettingTab(
      new PublishingManagerSettingsTab(
        this.app,
        this,
        settings,
        classificationLicenses,
        historyPreferences,
        {
          storageMoved: async (target) => {
            layout.setRoot(target);
            catalogController.setRoot(layout.rootPath());
            workflowJournalStore.setFolder(`${layout.rootPath()}/System/Journals`);
            await catalogController.initialize();
          },
          settingsForgotten: async () => {
            await settings.initialize();
            await classificationLicenses.initialize();
            await historyPreferences.initialize();
          }
        }
      )
    );
  }
}
