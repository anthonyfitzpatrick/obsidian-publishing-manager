/**
 * Provides the focused BOOK-001 creation dialog without introducing the M1 dashboard/workspace
 * views early. The modal keeps the user's draft in local controls, shows application validation
 * inline, disables accidental double submission, and closes only after canonical persistence has
 * succeeded. No note content is logged or transmitted.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import { BOOK_STATUSES, type BookStatus } from '../../domain/books/book-project';

/** Focused create dialog launched from the command palette. */
export class CreateBookModal extends Modal {
  /** Receives the application lifecycle service; the modal never accesses Vault directly. */
  public constructor(
    app: App,
    private readonly books: BookProjectService
  ) {
    super(app);
  }

  /** Builds labelled controls and keeps all draft state scoped to this modal instance. */
  public override onOpen(): void {
    this.setTitle('Create book project');
    let title = '';
    let primaryLanguage = 'en';
    let status: BookStatus = 'planned';
    let summary = '';
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });

    new Setting(this.contentEl)
      .setName('Title')
      .setDesc('Required stable project title.')
      .addText((text) => {
        text.setPlaceholder('Book title').onChange((value) => {
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

    new Setting(this.contentEl)
      .setName('Summary')
      .setDesc('Optional; up to 4,000 characters.')
      .addTextArea((text) => {
        text.onChange((value) => {
          summary = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Book summary');
      });

    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText('Create book')
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.submit({ title, primaryLanguage, status, summary }, error).finally(() => {
            button.setDisabled(false);
          });
        });
    });
  }

  /** Clears DOM references when Obsidian closes the modal. */
  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Persists the validated draft and keeps failures visible without discarding user input. */
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
      const result = await this.books.create({
        title: draft.title,
        primaryLanguage: draft.primaryLanguage,
        status: draft.status,
        ...(draft.summary.length === 0 ? {} : { summary: draft.summary })
      });
      new Notice(`Created book project “${result.book.title}”.`);
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Book project could not be created.');
      error.focus();
    }
  }
}
