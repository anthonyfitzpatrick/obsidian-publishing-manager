/**
 * Implements the EDN-006 two-step revision workflow: users select field groups, inspect the exact
 * proposed revision and warnings, then explicitly authorize creation. The preview is regenerated
 * after every selection change and stale source revisions are rejected by the application service.
 */

import { Modal, type App } from 'obsidian';

import type {
  EditionProjectService,
  EditionRevisionPreview,
  EditionRevisionSelection
} from '../../application/editions/edition-project-service';
import type { VaultPath } from '../../domain/storage/vault-path';

/** Preview-first modal that never creates an edition from unchecked or stale data. */
export class EditionRevisionModal extends Modal {
  private preview: EditionRevisionPreview | undefined;
  private previewRequest = 0;

  public constructor(
    app: App,
    private readonly service: EditionProjectService,
    private readonly sourcePath: VaultPath,
    private readonly onCreated: (editionId: string) => void
  ) {
    super(app);
  }

  /** Renders selection controls, a live preview region, and a consequence-named submit action. */
  public override onOpen(): void {
    this.setTitle('Create edition revision');
    const content = this.contentEl;
    content.addClass('publishing-manager', 'pm-edition-modal');
    content.createEl('p', {
      text: 'Select only the field groups that should seed the new stable edition identity.'
    });
    const selections = content.createDiv({ cls: 'pm-revision-selections' });
    const publication = checkbox(selections, 'Copy publication date', false);
    const production = checkbox(
      selections,
      'Copy trim, pages, narrator, duration, and audio metadata',
      true
    );
    const marketing = checkbox(selections, 'Copy cover reference and retail links', true);
    const notes = checkbox(selections, 'Copy edition notes', false);
    const previewRegion = content.createDiv({
      cls: 'pm-revision-preview',
      attr: { 'aria-live': 'polite' }
    });
    const error = content.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'polite' }
    });
    const actions = content.createDiv({ cls: 'pm-action-row' });
    const cancel = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Cancel',
      attr: { type: 'button' }
    });
    const create = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Create reviewed revision',
      attr: { type: 'button', disabled: 'true' }
    });

    const refresh = () => {
      const selection: EditionRevisionSelection = {
        publication: publication.checked,
        production: production.checked,
        marketing: marketing.checked,
        notes: notes.checked
      };
      const request = ++this.previewRequest;
      create.disabled = true;
      previewRegion.setText('Building revision preview…');
      error.empty();
      void this.service
        .previewRevision(this.sourcePath, selection)
        .then((preview) => {
          if (request !== this.previewRequest) return;
          this.preview = preview;
          renderPreview(previewRegion, preview);
          create.disabled = false;
        })
        .catch((failure: unknown) => {
          if (request !== this.previewRequest) return;
          this.preview = undefined;
          previewRegion.empty();
          error.setText(failure instanceof Error ? failure.message : 'Revision preview failed.');
        });
    };
    for (const control of [publication, production, marketing, notes]) {
      control.addEventListener('change', refresh);
    }
    cancel.addEventListener('click', () => this.close());
    create.addEventListener('click', () => {
      const preview = this.preview;
      if (preview === undefined) return;
      create.disabled = true;
      error.empty();
      void this.service
        .createRevision(preview)
        .then((result) => {
          this.onCreated(result.edition.id);
          this.close();
        })
        .catch((failure: unknown) => {
          error.setText(
            failure instanceof Error ? failure.message : 'Revision could not be created.'
          );
          create.disabled = false;
        });
    });
    refresh();
    window.setTimeout(() => production.focus(), 0);
  }

  /** Clears stale preview state when the modal is closed. */
  public override onClose(): void {
    this.preview = undefined;
    this.previewRequest += 1;
    this.contentEl.empty();
  }
}

/** Creates one native checkbox with the complete action in its visible label. */
function checkbox(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-checkbox-field' });
  const input = wrapper.createEl('input', { type: 'checkbox' });
  input.checked = checked;
  wrapper.createSpan({ text: label });
  return input;
}

/** Replaces the live region with exact copy evidence and both mandatory warnings. */
function renderPreview(parent: HTMLElement, preview: EditionRevisionPreview): void {
  parent.empty();
  parent.createEl('h3', { text: `Revision ${preview.nextRevision} preview` });
  parent.createEl('p', {
    text:
      preview.copiedFields.length === 0
        ? 'No optional fields will be copied.'
        : `Copied fields: ${preview.copiedFields.join(', ')}.`
  });
  const warnings = parent.createEl('ul', { cls: 'pm-warning-list' });
  warnings.createEl('li', { text: `⚠ ${preview.identifierWarning}` });
  warnings.createEl('li', { text: `⚠ ${preview.formatWarning}` });
}
