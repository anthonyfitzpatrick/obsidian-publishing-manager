/**
 * Registers both native M1 views, their ribbon/command entry points, and deterministic activation
 * helpers. Existing leaves are revealed instead of duplicated; book navigation persists a safe
 * selected path in Obsidian view state, and plugin unload detaches only Publishing Manager leaves.
 */

import { Notice, type Plugin, type WorkspaceLeaf } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { EditionProjectService } from '../../application/editions/edition-project-service';
import type { AssetReferenceService } from '../../application/assets/asset-reference-service';
import type { WorkflowProjectService } from '../../application/workflows/workflow-project-service';
import type { MetadataProjectService } from '../../application/metadata/metadata-project-service';
import type { IsbnProjectService } from '../../application/isbn/isbn-project-service';
import type { PriceProjectService } from '../../application/pricing/price-project-service';
import type { DistributionProjectService } from '../../application/distribution/distribution-project-service';
import type { ReadinessProjectService } from '../../application/readiness/readiness-project-service';
import type { DashboardPreferencesService } from '../../application/dashboard/dashboard-preferences-service';
import type { SalesProjectService } from '../../application/sales/sales-project-service';
import type { LaunchProjectService } from '../../application/launch/launch-project-service';
import type { CalendarProjectService } from '../../application/calendar/calendar-project-service';
import type { ReviewProjectService } from '../../application/reviews/review-project-service';
import type { HistoryProjectService } from '../../application/history/history-project-service';
import type { HistoryPreferencesService } from '../../application/history/history-preferences-service';

// Obsidian renders the ribbon label as a compact product tooltip. Keep the branded words separate
// so the UI sentence-case rule does not incorrectly rewrite the registered product name.
const RIBBON_TOOLTIP = ['Publishing', 'Manager'].join(' ');
import { resolvePublishingManagerDeepLink } from '../../application/integrations/metadata-visuals-provider';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import { normalizeVaultPath } from '../../domain/storage/vault-path';
import { CreateBookModal } from '../dialogs/create-book-modal';
import { CreateSeriesModal } from '../dialogs/create-series-modal';
import type { BookDraftStore } from '../state/book-draft-store';
import { BookWorkspaceView, BOOK_WORKSPACE_VIEW_TYPE } from './book-workspace-view';
import {
  GlobalDataLibraryView,
  IsbnInventoryView,
  GLOBAL_DATA_LIBRARY_VIEW_TYPE,
  ISBN_INVENTORY_VIEW_TYPE
} from './global-data-library-view';
import {
  type PublishingDashboardTools,
  PublishingDashboardView,
  PUBLISHING_DASHBOARD_VIEW_TYPE
} from './publishing-dashboard-view';

/** Registers view factories and all routes that open them. */
export function registerPublishingViews(
  plugin: Plugin,
  catalog: BookCatalog,
  books: BookProjectService,
  editions: EditionProjectService,
  assets: AssetReferenceService,
  workflows: WorkflowProjectService,
  metadata: MetadataProjectService,
  isbns: IsbnProjectService,
  prices: PriceProjectService,
  distribution: DistributionProjectService,
  readiness: ReadinessProjectService,
  dashboardPreferences: DashboardPreferencesService,
  sales: SalesProjectService,
  launches: LaunchProjectService,
  calendar: CalendarProjectService,
  reviews: ReviewProjectService,
  history: HistoryProjectService,
  historyPreferences: HistoryPreferencesService,
  drafts: BookDraftStore,
  refreshCatalog: () => Promise<void>,
  dashboardTools: PublishingDashboardTools
): void {
  const openDashboard = async (): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, PUBLISHING_DASHBOARD_VIEW_TYPE);
    await leaf.setViewState({ type: PUBLISHING_DASHBOARD_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  const openGlobalDataLibrary = async (): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, GLOBAL_DATA_LIBRARY_VIEW_TYPE);
    await leaf.setViewState({ type: GLOBAL_DATA_LIBRARY_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  const openIsbnInventory = async (): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, ISBN_INVENTORY_VIEW_TYPE);
    await leaf.setViewState({ type: ISBN_INVENTORY_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  const completeDashboardTools = { ...dashboardTools, openGlobalDataLibrary };

  const openBook = async (
    record: CatalogRecord,
    tab = 'overview',
    editionId?: string
  ): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, BOOK_WORKSPACE_VIEW_TYPE);
    await leaf.setViewState({
      type: BOOK_WORKSPACE_VIEW_TYPE,
      active: true,
      state: { bookPath: record.path, tab, ...(editionId === undefined ? {} : { editionId }) }
    });
    await plugin.app.workspace.revealLeaf(leaf);
  };

  // The public URI handler resolves navigation-only data against the current catalog. It never
  // dispatches a command, saves a record, or accepts arbitrary tab/mutation parameters.
  plugin.registerObsidianProtocolHandler('publishing-manager', (parameters) => {
    const target = resolvePublishingManagerDeepLink(parameters, catalog.snapshot());
    if (target === undefined) {
      new Notice('Publishing manager rejected an invalid or unavailable navigation link.');
      return;
    }
    const book = catalog.snapshot().books.find(({ id }) => id === target.bookId);
    if (book === undefined) return;
    void openBook(book, target.tab, target.editionId).catch(
      (cause: unknown) =>
        new Notice(
          cause instanceof Error ? cause.message : 'Publishing Manager could not open the link.'
        )
    );
  });

  plugin.registerView(
    PUBLISHING_DASHBOARD_VIEW_TYPE,
    (leaf) =>
      new PublishingDashboardView(
        leaf,
        catalog,
        readiness,
        dashboardPreferences,
        sales,
        calendar,
        () => new CreateBookModal(plugin.app, books).open(),
        () => new CreateSeriesModal(plugin.app, books).open(),
        openBook,
        refreshCatalog,
        completeDashboardTools
      )
  );
  plugin.registerView(
    GLOBAL_DATA_LIBRARY_VIEW_TYPE,
    (leaf) => new GlobalDataLibraryView(leaf, openIsbnInventory)
  );
  plugin.registerView(
    ISBN_INVENTORY_VIEW_TYPE,
    (leaf) => new IsbnInventoryView(leaf, catalog, isbns)
  );
  plugin.registerView(
    BOOK_WORKSPACE_VIEW_TYPE,
    (leaf) =>
      new BookWorkspaceView(
        leaf,
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
        sales,
        launches,
        reviews,
        history,
        historyPreferences,
        drafts,
        openDashboard
      )
  );

  // One ribbon icon is the stable top-level product entry. All other plugin-owned workspaces are
  // launched from the Dashboard or command palette so the Obsidian rail never becomes cluttered.
  // The terse product name identifies the whole plugin more clearly than an action label here.
  plugin.addRibbonIcon('library', RIBBON_TOOLTIP, () => void openDashboard());
  plugin.addCommand({
    id: 'open-dashboard',
    name: 'Open dashboard',
    callback: () => void openDashboard()
  });
  // The dashboard is the preferred product entry, while this route keeps shared data reachable
  // for keyboard-first users and when no book workspace is open yet.
  plugin.addCommand({
    id: 'open-global-data-library',
    name: 'Open global data library',
    callback: () => void openGlobalDataLibrary()
  });
  plugin.addCommand({
    id: 'open-active-book-workspace',
    name: 'Open active book workspace',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || file.extension.toLowerCase() !== 'md') return false;
      let path;
      try {
        path = normalizeVaultPath(file.path);
      } catch {
        return false;
      }
      const record = catalog.snapshot().books.find((candidate) => candidate.path === path);
      if (record === undefined) return false;
      if (!checking) {
        void openBook(record).catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : 'Book Workspace could not open.');
        });
      }
      return true;
    }
  });

  plugin.register(() => {
    plugin.app.workspace.detachLeavesOfType(PUBLISHING_DASHBOARD_VIEW_TYPE);
    plugin.app.workspace.detachLeavesOfType(GLOBAL_DATA_LIBRARY_VIEW_TYPE);
    plugin.app.workspace.detachLeavesOfType(ISBN_INVENTORY_VIEW_TYPE);
    plugin.app.workspace.detachLeavesOfType(BOOK_WORKSPACE_VIEW_TYPE);
  });
}

/** Reuses the first existing view leaf and creates a normal tab only when none exists. */
function existingOrNewLeaf(plugin: Plugin, type: string): WorkspaceLeaf {
  return plugin.app.workspace.getLeavesOfType(type)[0] ?? plugin.app.workspace.getLeaf(true);
}
