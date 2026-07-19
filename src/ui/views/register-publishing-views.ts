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
import type { CatalogRecord } from '../../domain/catalog/catalog-model';
import { normalizeVaultPath } from '../../domain/storage/vault-path';
import { CreateBookModal } from '../dialogs/create-book-modal';
import type { BookDraftStore } from '../state/book-draft-store';
import { BookWorkspaceView, BOOK_WORKSPACE_VIEW_TYPE } from './book-workspace-view';
import {
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
  drafts: BookDraftStore,
  refreshCatalog: () => Promise<void>
): void {
  const openDashboard = async (): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, PUBLISHING_DASHBOARD_VIEW_TYPE);
    await leaf.setViewState({ type: PUBLISHING_DASHBOARD_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };

  const openBook = async (record: CatalogRecord, tab = 'overview'): Promise<void> => {
    const leaf = existingOrNewLeaf(plugin, BOOK_WORKSPACE_VIEW_TYPE);
    await leaf.setViewState({
      type: BOOK_WORKSPACE_VIEW_TYPE,
      active: true,
      state: { bookPath: record.path, tab }
    });
    await plugin.app.workspace.revealLeaf(leaf);
  };

  plugin.registerView(
    PUBLISHING_DASHBOARD_VIEW_TYPE,
    (leaf) =>
      new PublishingDashboardView(
        leaf,
        catalog,
        readiness,
        dashboardPreferences,
        sales,
        () => new CreateBookModal(plugin.app, books).open(),
        openBook,
        refreshCatalog
      )
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
        drafts,
        openDashboard
      )
  );

  plugin.addRibbonIcon('library', 'Open publishing dashboard', () => void openDashboard());
  plugin.addCommand({
    id: 'open-dashboard',
    name: 'Open dashboard',
    callback: () => void openDashboard()
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
    plugin.app.workspace.detachLeavesOfType(BOOK_WORKSPACE_VIEW_TYPE);
  });
}

/** Reuses the first existing view leaf and creates a normal tab only when none exists. */
function existingOrNewLeaf(plugin: Plugin, type: string): WorkspaceLeaf {
  return plugin.app.workspace.getLeavesOfType(type)[0] ?? plugin.app.workspace.getLeaf(true);
}
