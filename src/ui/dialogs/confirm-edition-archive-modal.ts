/**
 * Confirms non-destructive edition archival with the exact dependent-record count. Archival keeps
 * every stable link and Markdown record; the initially focused cancel action prevents an Enter key
 * from changing lifecycle state before the user has read the consequence.
 */

import { Modal, type App } from 'obsidian';

import type { EditionRemovalAssessment } from '../../application/editions/edition-project-service';

/** Consequence-named confirmation used only for active editions. */
export class ConfirmEditionArchiveModal extends Modal {
  public constructor(
    app: App,
    private readonly assessment: EditionRemovalAssessment,
    private readonly onArchive: () => void
  ) {
    super(app);
  }

  /** Explains retained links and requires explicit activation of the archive action. */
  public override onOpen(): void {
    this.setTitle('Archive edition?');
    this.contentEl.addClass('publishing-manager');
    this.contentEl.createEl('p', { text: this.assessment.explanation });
    this.contentEl.createEl('p', {
      text: 'The edition note, formats, identifiers, targets, and history remain in the vault. No dependent record is deleted or silently reassigned.'
    });
    const actions = this.contentEl.createDiv({ cls: 'pm-action-row' });
    const keep = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Keep edition active',
      attr: { type: 'button' }
    });
    const archive = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Archive edition',
      attr: { type: 'button' }
    });
    keep.addEventListener('click', () => this.close());
    archive.addEventListener('click', () => {
      this.close();
      this.onArchive();
    });
    window.setTimeout(() => keep.focus(), 0);
  }

  /** Removes generated controls after either choice. */
  public override onClose(): void {
    this.contentEl.empty();
  }
}
