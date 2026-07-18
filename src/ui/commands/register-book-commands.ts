/**
 * Registers the narrow command-palette surface required by the M1 book lifecycle. Creation opens
 * a focused validated dialog. Archive and restore operate only on the active managed book note,
 * present a clear result, and route every mutation through the application service rather than
 * accessing Obsidian Vault directly.
 */

import { Notice, type Plugin } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import { normalizeVaultPath } from '../../domain/storage/vault-path';
import { CreateBookModal } from '../dialogs/create-book-modal';
import { EditBookModal } from '../dialogs/edit-book-modal';

/** Adds create/archive/restore commands and lets Plugin own their unload lifecycle. */
export function registerBookCommands(plugin: Plugin, books: BookProjectService): void {
  plugin.addCommand({
    id: 'create-book-project',
    name: 'Create book project',
    callback: () => new CreateBookModal(plugin.app, books).open()
  });

  plugin.addCommand({
    id: 'edit-active-book',
    name: 'Edit active book project',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || file.extension.toLowerCase() !== 'md') return false;
      if (!checking) {
        const path = normalizeVaultPath(file.path);
        void books
          .reopen(path)
          .then(({ book }) => new EditBookModal(plugin.app, books, path, book).open())
          .catch((error: unknown) => {
            new Notice(error instanceof Error ? error.message : 'Active note is not a valid book.');
          });
      }
      return true;
    }
  });

  plugin.addCommand({
    id: 'archive-active-book',
    name: 'Archive active book project',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || file.extension.toLowerCase() !== 'md') return false;
      if (!checking) {
        void runLifecycleAction(
          () => books.archive(normalizeVaultPath(file.path)),
          'Book project archived.'
        );
      }
      return true;
    }
  });

  plugin.addCommand({
    id: 'restore-active-book',
    name: 'Restore active book project',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file === null || file.extension.toLowerCase() !== 'md') return false;
      if (!checking) {
        void runLifecycleAction(
          () => books.restore(normalizeVaultPath(file.path)),
          'Book project restored.'
        );
      }
      return true;
    }
  });
}

/** Converts application success/failure to a local, human-readable command result. */
async function runLifecycleAction(
  action: () => Promise<unknown>,
  successMessage: string
): Promise<void> {
  try {
    await action();
    new Notice(successMessage);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : 'Book lifecycle action failed.');
  }
}
