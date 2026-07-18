/**
 * Exposes the WFL-003 engine before the later Workflow tab ships. The command is available only
 * for an active canonical book and creates a readable independent default-workflow note through
 * the application service; it never edits the book note or a bundled template.
 */

import { Notice, type Plugin } from 'obsidian';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { WorkflowProjectService } from '../../application/workflows/workflow-project-service';
import { normalizeVaultPath } from '../../domain/storage/vault-path';

/** Registers the temporary command-palette entry used until WFL-010 supplies the full view. */
export function registerWorkflowCommands(
  plugin: Plugin,
  catalog: BookCatalog,
  workflows: WorkflowProjectService
): void {
  plugin.addCommand({
    id: 'create-default-workflow-for-active-book',
    name: 'Create default workflow for active book',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || file.extension.toLowerCase() !== 'md') return false;
      let path;
      try {
        path = normalizeVaultPath(file.path);
      } catch {
        return false;
      }
      const book = catalog.snapshot().books.find((record) => record.path === path);
      if (book === undefined) return false;
      if (!checking) {
        void workflows
          .instantiateDefault(book.id)
          .then(
            ({ workflow }) =>
              new Notice(`Created ${workflow.name} with ${workflow.stages.items.length} stages.`)
          )
          .catch(
            (error: unknown) =>
              new Notice(error instanceof Error ? error.message : 'Workflow could not be created.')
          );
      }
      return true;
    }
  });
}
