/**
 * Confirms the only operation that intentionally removes an unsaved overview draft. Navigation,
 * tab changes, pane changes, and view closure preserve drafts automatically and therefore never
 * display a misleading warning.
 */

import { Modal, Setting, type App } from 'obsidian';

/** Small confirmation dialog with the non-destructive choice as the default focus target. */
export class ConfirmDiscardModal extends Modal {
  /** Receives a callback that performs discard only after explicit confirmation. */
  public constructor(
    app: App,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  /** Names the consequence and provides keep/discard actions with clear labels. */
  public override onOpen(): void {
    this.setTitle('Discard unsaved book changes?');
    this.contentEl.createEl('p', {
      text: 'The saved Markdown record will remain unchanged. Only this unsaved overview draft will be removed.'
    });
    new Setting(this.contentEl)
      .addButton((button) => {
        button
          .setButtonText('Keep editing')
          .setCta()
          .onClick(() => this.close());
        window.setTimeout(() => button.buttonEl.focus(), 0);
      })
      .addButton((button) => {
        button
          .setButtonText('Discard draft')
          .setWarning()
          .onClick(() => {
            this.onConfirm();
            this.close();
          });
      });
  }

  /** Removes generated controls on close. */
  public override onClose(): void {
    this.contentEl.empty();
  }
}
