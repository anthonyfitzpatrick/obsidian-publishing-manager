/**
 * Creates a canonical series record without coupling the Dashboard to storage details. Series
 * membership remains an explicit later action; this modal only establishes the reusable parent.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';

/** Focused local Series creation dialog used by the Dashboard and command palette. */
export class CreateSeriesModal extends Modal {
  public constructor(
    app: App,
    private readonly books: BookProjectService
  ) {
    super(app);
  }

  /** Builds the one required field and keeps validation feedback inside this modal instance. */
  public override onOpen(): void {
    this.setTitle('Create series');
    let name = '';
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    new Setting(this.contentEl)
      .setName('Series name')
      .setDesc('Required stable series name. Projects can be assigned to it later.')
      .addText((text) => {
        text.setPlaceholder('Series name').onChange((value) => {
          name = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Series name');
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    new Setting(this.contentEl).addButton((button) => {
      button
        .setButtonText('Create series')
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.submit(name, error).finally(() => button.setDisabled(false));
        });
    });
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Saves only after application validation; user input remains visible if that validation fails. */
  private async submit(name: string, error: HTMLElement): Promise<void> {
    try {
      await this.books.createSeries(name);
      new Notice(`Created series “${name}”.`);
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Series could not be created.');
      error.focus();
    }
  }
}
