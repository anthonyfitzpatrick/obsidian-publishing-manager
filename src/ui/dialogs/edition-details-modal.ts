/**
 * Presents one Publishing Item's complete management surface only when the owner asks for it.
 * Keeping the renderer supplied by the workspace avoids a second, drifting implementation of the
 * same item actions and allows all existing canonical workflows to remain available in the popout.
 */

import { Modal, type App } from 'obsidian';

/** Lightweight host for the existing Publishing Item detail renderer. */
export class EditionDetailsModal extends Modal {
  public constructor(app: App, private readonly renderDetails: (parent: HTMLElement) => void) {
    super(app);
  }

  /** Creates the popout on demand so the dashboard remains a clean card collection. */
  public override onOpen(): void {
    this.contentEl.addClass('publishing-manager', 'pm-edition-details-modal');
    this.renderDetails(this.contentEl);
  }

  /** Removes only generated UI; canonical Markdown is always owned by the application services. */
  public override onClose(): void {
    this.contentEl.empty();
  }
}
