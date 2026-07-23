/**
 * Provides focused BOOK-003 editing for the active canonical book before the full Book Workspace
 * exists. Existing values seed the controls, validation failures remain inline without closing or
 * discarding the draft, and the application service performs the final conflict-aware update.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import { BOOK_STATUSES, type BookProject, type BookStatus } from '../../domain/books/book-project';
import type { VaultPath } from '../../domain/storage/vault-path';
import { PRIMARY_LANGUAGE_OPTIONS, regionalLanguageOptions, splitLanguageSelection } from '../language-options';
import { COUNTRY_OPTIONS, countryCodeFromSearch, countrySearchLabel } from '../country-options';

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
    const languageSelection = splitLanguageSelection(this.current.primaryLanguage, this.current.regionalLanguage);
    let primaryLanguage = languageSelection.primary;
    let regionalLanguage = languageSelection.regional;
    let publisher = this.current.publisher ?? '';
    let publisherCountry = this.current.publisherCountry ?? '';
    let publisherVariant = this.current.publisherVariant ?? '';
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

    let refreshRegionalLanguage: () => void = () => {};
    new Setting(this.contentEl)
      .setName('Primary language')
      .setDesc('Choose the main language used by this Project.')
      .addDropdown((dropdown) => {
        for (const option of PRIMARY_LANGUAGE_OPTIONS) dropdown.addOption(option.code, option.label);
        if (!PRIMARY_LANGUAGE_OPTIONS.some(({ code }) => code === primaryLanguage)) {
          dropdown.addOption(primaryLanguage, `Existing language (${primaryLanguage})`);
        }
        dropdown.setValue(primaryLanguage).onChange((value) => {
          primaryLanguage = value;
          regionalLanguage = '';
          refreshRegionalLanguage();
          error.empty();
        });
        dropdown.selectEl.setAttr('aria-label', 'Primary language');
      });
    const regionalSetting = new Setting(this.contentEl)
      .setName('Regional language')
      .setDesc('Optional publishing variant, such as US English or British English.');
    refreshRegionalLanguage = (): void => {
      regionalSetting.controlEl.empty();
      regionalSetting.addDropdown((dropdown) => {
        dropdown.addOption('', 'No regional variant');
        for (const option of regionalLanguageOptions(primaryLanguage)) dropdown.addOption(option.code, option.label);
        if (regionalLanguage.length > 0 && !regionalLanguageOptions(primaryLanguage).some(({ code }) => code === regionalLanguage)) {
          dropdown.addOption(regionalLanguage, `Existing variant (${regionalLanguage})`);
        }
        dropdown.setValue(regionalLanguage).onChange((value) => {
          regionalLanguage = value;
          error.empty();
        });
        dropdown.selectEl.setAttr('aria-label', 'Regional language');
      });
    };
    refreshRegionalLanguage();
    new Setting(this.contentEl).setName('Default publisher').addText((text) => {
      text.setValue(publisher).onChange((value) => {
        publisher = value;
        error.empty();
      });
      text.inputEl.setAttr('aria-label', 'Default publisher');
    });
    new Setting(this.contentEl)
      .setName('Publisher country')
      .setDesc('Optional. Search by country name or use its two-letter code.')
      .addText((text) => {
        text.inputEl.type = 'search';
        const listId = 'pm-edit-publisher-country-options';
        text.inputEl.setAttr('list', listId);
        text.setValue(publisherCountry.length === 0 ? '' : countrySearchLabel(publisherCountry));
        text.inputEl.setAttr('placeholder', 'Search countries');
        const options = this.contentEl.createEl('datalist', { attr: { id: listId } });
        for (const option of COUNTRY_OPTIONS) options.createEl('option', { value: `${option.label} (${option.code})` });
        text.onChange((value) => {
          publisherCountry = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Publisher country');
      });
    new Setting(this.contentEl)
      .setName('Global publisher variant')
      .setDesc('Optional publishing identity used globally alongside the default publisher.')
      .addText((text) => {
        text.setValue(publisherVariant).onChange((value) => {
          publisherVariant = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Global publisher variant');
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
          void this.submit({ title, primaryLanguage, regionalLanguage, publisher, publisherCountry, publisherVariant, status, summary }, error).finally(() => {
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
      readonly regionalLanguage: string;
      readonly publisher: string;
      readonly publisherCountry: string;
      readonly publisherVariant: string;
      readonly status: BookStatus;
      readonly summary: string;
    },
    error: HTMLElement
  ): Promise<void> {
    try {
      await this.books.edit(this.path, {
        title: draft.title,
        primaryLanguage: draft.primaryLanguage,
        regionalLanguage: draft.regionalLanguage.length === 0 ? undefined : draft.regionalLanguage,
        publisher: draft.publisher.trim().length === 0 ? undefined : draft.publisher.trim(),
        publisherCountry:
          draft.publisherCountry.trim().length === 0
            ? undefined
            : countryCodeFromSearch(draft.publisherCountry) ?? (() => { throw new Error('Choose a publisher country from the searchable list.'); })(),
        publisherVariant: draft.publisherVariant.trim().length === 0 ? undefined : draft.publisherVariant.trim(),
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
