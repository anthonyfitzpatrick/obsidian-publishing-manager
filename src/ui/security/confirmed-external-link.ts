/**
 * Provides the only approved external-link renderer in Publishing Manager. Untrusted destinations
 * are validated once, the initial control has no navigation capability, and a second deliberate
 * action is required after the complete destination has been displayed as plain text.
 */
import { Modal, type App } from 'obsidian';

import { safeExternalHttpUrl } from '../../domain/security/untrusted-data';

/** Renders either a confirmation-only button or an explicit invalid-destination explanation. */
export function createConfirmedExternalLink(
  parent: HTMLElement,
  app: App,
  label: string,
  candidate: unknown
): void {
  const destination = safeExternalHttpUrl(candidate);
  if (destination === undefined) {
    parent.createSpan({
      cls: 'pm-muted',
      text: `${label} is unavailable because its destination is invalid.`
    });
    return;
  }

  const review = parent.createEl('button', {
    cls: 'pm-button pm-button--quiet pm-external-link-review',
    text: label,
    attr: { type: 'button', 'aria-label': `${label}; review external destination` }
  });
  review.addEventListener('click', () => {
    new ExternalDestinationModal(app, destination).open();
  });
}

/** Makes the security boundary and complete normalized destination visible before navigation. */
class ExternalDestinationModal extends Modal {
  public constructor(
    app: App,
    private readonly destination: string
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Open external destination?' });
    this.contentEl.createEl('p', {
      text: 'This destination is outside your vault. The plugin will not send vault data, credentials, or form values. Your device and browser control the external request.'
    });
    this.contentEl.createEl('p', { text: 'Complete destination:' });
    this.contentEl.createEl('code', {
      cls: 'pm-external-destination',
      text: this.destination
    });

    const actions = this.contentEl.createDiv({ cls: 'pm-action-row' });
    actions
      .createEl('button', {
        cls: 'pm-button pm-button--secondary',
        text: 'Cancel',
        attr: { type: 'button' }
      })
      .addEventListener('click', () => this.close());

    // This is deliberately the only navigable external anchor in the product source. It appears
    // only after the validated destination has been disclosed in full in the same dialog.
    actions.createEl('a', {
      cls: 'pm-button pm-button--primary',
      text: 'Open destination',
      href: this.destination,
      attr: { target: '_blank', rel: 'noopener noreferrer' }
    });
  }
}
