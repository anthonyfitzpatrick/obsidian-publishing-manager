/** Creates a lightweight Series parent, then immediately opens its Project-membership editor. */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';

/** Focused Series creation dialog used by the Dashboard and command palette. */
export class CreateSeriesModal extends Modal {
  public constructor(
    app: App,
    private readonly books: BookProjectService,
    private readonly catalog: BookCatalog,
    private readonly openSeries?: (seriesId: string) => void
  ) {
    super(app);
  }

  /** Keeps Series creation to one name field: it is only a container for Projects. */
  public override onOpen(): void {
    this.setTitle('Create series');
    let name = '';
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    new Setting(this.contentEl)
      .setName('Series name')
      .setDesc('A Series is a named container for related Projects. You will choose its Projects next.')
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

  /** Opens the optional page route immediately after create so a Series is never a dead end. */
  private async submit(name: string, error: HTMLElement): Promise<void> {
    try {
      const seriesId = await this.books.createSeries(name);
      this.close();
      new Notice(`Created series “${name}”.`);
      this.openSeries?.(seriesId);
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Series could not be created.');
      error.focus();
    }
  }
}
