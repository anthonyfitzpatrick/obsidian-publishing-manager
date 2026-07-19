/**
 * Provides focused BOOK-003 editing for the active canonical book before the full Book Workspace
 * exists. Existing values seed the controls, validation failures remain inline without closing or
 * discarding the draft, and the application service performs the final conflict-aware update.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import { BOOK_STATUSES, type BookProject, type BookStatus } from '../../domain/books/book-project';
import type { VaultPath } from '../../domain/storage/vault-path';

/** Focused editor for identity and summary fields of one already-loaded book. */
export class EditBookModal extends Modal {
  /** Receives the loaded snapshot so opening the modal never flashes an empty draft. */
  public constructor(
    app: App,
    private readonly books: BookProjectService,
    private readonly path: VaultPath,
    private readonly current: BookProject
  ) {
    super(app);
  }

  /** Builds prefilled labelled controls and preserves draft text until save succeeds. */
  public override onOpen(): void {
    this.setTitle('Edit book project');
    let title = this.current.title;
    let primaryLanguage = this.current.primaryLanguage;
    let status = this.current.status;
    let summary = this.current.summary ?? '';
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });

    new Setting(this.contentEl).setName('Title').addText((text) => {
      text.setValue(title).onChange((value) => {
        title = value;
        error.empty();
      });
      text.inputEl.setAttr('aria-label', 'Book title');
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(this.contentEl)
      .setName('Primary language')
      .setDesc('Language code, for example en or sv.')
      .addText((text) => {
        text.setValue(primaryLanguage).onChange((value) => {
          primaryLanguage = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Primary language');
      });

    new Setting(this.contentEl).setName('Status').addDropdown((dropdown) => {
      for (const value of BOOK_STATUSES) {
        dropdown.addOption(value, value[0]?.toUpperCase() + value.slice(1));
      }
      dropdown.setValue(status).onChange((value) => {
        status = value as BookStatus;
      });
      dropdown.selectEl.setAttr('aria-label', 'Book status');
    });

    new Setting(this.contentEl).setName('Summary').addTextArea((text) => {
      text.setValue(summary).onChange((value) => {
        summary = value;
        error.empty();
      });
      text.inputEl.setAttr('aria-label', 'Book summary');
    });

    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText('Save changes')
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.submit({ title, primaryLanguage, status, summary }, error).finally(() => {
            button.setDisabled(false);
          });
        });
    });
  }

  /** Releases generated controls and their event handlers on close. */
  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Applies the complete draft while retaining the dialog and values after any validation error. */
  private async submit(
    draft: {
      readonly title: string;
      readonly primaryLanguage: string;
      readonly status: BookStatus;
      readonly summary: string;
    },
    error: HTMLElement
  ): Promise<void> {
    try {
      await this.books.edit(this.path, {
        title: draft.title,
        primaryLanguage: draft.primaryLanguage,
        status: draft.status,
        summary: draft.summary.length === 0 ? undefined : draft.summary
      });
      new Notice('Book project updated.');
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Book project could not be updated.');
      error.focus();
    }
  }
}
