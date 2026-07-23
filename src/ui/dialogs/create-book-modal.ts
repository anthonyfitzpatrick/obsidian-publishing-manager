/**
 * Provides the focused BOOK-001 creation dialog without introducing the M1 dashboard/workspace
 * views early. The modal keeps the user's draft in local controls, shows application validation
 * inline, disables accidental double submission, and closes only after canonical persistence has
 * succeeded. No note content is logged or transmitted.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import { BOOK_STATUSES, type BookStatus } from '../../domain/books/book-project';
import { PRIMARY_LANGUAGE_OPTIONS, regionalLanguageOptions } from '../language-options';
import { COUNTRY_OPTIONS, countryCodeFromSearch } from '../country-options';

/** Focused master-Project creation dialog launched from the command palette. */
export class CreateBookModal extends Modal {
  /** Receives the application lifecycle service; the modal never accesses Vault directly. */
  public constructor(
    app: App,
    private readonly books: BookProjectService,
    private readonly catalog: BookCatalog
  ) {
    super(app);
  }

  /** Builds labelled controls and keeps all draft state scoped to this modal instance. */
  public override onOpen(): void {
    this.setTitle('Create publishing project');
    let title = '';
    let primaryLanguage = 'en';
    let regionalLanguage = '';
    let publisher = '';
    let publisherCountry = '';
    let publisherVariant = '';
    let status: BookStatus = 'planned';
    let summary = '';
    let seriesId: string | undefined;
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });

    new Setting(this.contentEl)
      .setName('Project title')
      .setDesc('Required stable project title.')
      .addText((text) => {
        text.setPlaceholder('Project title').onChange((value) => {
          title = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Project title');
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(this.contentEl)
      .setName('Publisher country')
      .setDesc('Optional. Search by country name or use its two-letter code.')
      .addText((text) => {
        text.inputEl.type = 'search';
        const listId = 'pm-create-publisher-country-options';
        text.inputEl.setAttr('list', listId);
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

    let refreshRegionalLanguage: () => void = () => {};

    new Setting(this.contentEl)
      .setName('Primary language')
      .setDesc('Choose the main language used by this Project.')
      .addDropdown((dropdown) => {
        for (const option of PRIMARY_LANGUAGE_OPTIONS) dropdown.addOption(option.code, option.label);
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
        dropdown.setValue(regionalLanguage).onChange((value) => {
          regionalLanguage = value;
          error.empty();
        });
        dropdown.selectEl.setAttr('aria-label', 'Regional language');
      });
    };
    refreshRegionalLanguage();

    new Setting(this.contentEl)
      .setName('Default publisher')
      .setDesc('Optional default when no country-specific publisher is recorded in the Project overview.')
      .addText((text) => {
        text.setValue(publisher).onChange((value) => {
          publisher = value;
          error.empty();
        });
        text.inputEl.setAttr('aria-label', 'Default publisher');
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

    const series = this.catalog.seriesRecords();
    new Setting(this.contentEl)
      .setName('Series')
      .setDesc('Optional. Choose the parent Series this Project belongs to, or leave it standalone.')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'Standalone project');
        for (const record of series) {
          const name = typeof record.fields.name === 'string' ? record.fields.name : record.id;
          dropdown.addOption(record.id, name);
        }
        dropdown.setValue('').onChange((value) => {
          seriesId = value.length === 0 ? undefined : value;
        });
        dropdown.selectEl.setAttr('aria-label', 'Series');
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
        .setButtonText('Create project')
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.submit({ title, primaryLanguage, regionalLanguage, publisher, publisherCountry, publisherVariant, status, summary, seriesId }, error).finally(() => {
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
      readonly regionalLanguage: string;
      readonly publisher: string;
      readonly publisherCountry: string;
      readonly publisherVariant: string;
      readonly status: BookStatus;
      readonly summary: string;
      readonly seriesId: string | undefined;
    },
    error: HTMLElement
  ): Promise<void> {
    try {
      const result = await this.books.create({
        title: draft.title,
        primaryLanguage: draft.primaryLanguage,
        ...(draft.regionalLanguage.length === 0 ? {} : { regionalLanguage: draft.regionalLanguage }),
        ...(draft.publisher.trim().length === 0 ? {} : { publisher: draft.publisher.trim() }),
        ...(draft.publisherCountry.trim().length === 0
          ? {}
          : (() => {
              const country = countryCodeFromSearch(draft.publisherCountry);
              if (country === undefined) throw new Error('Choose a publisher country from the searchable list.');
              return { publisherCountry: country };
            })()),
        ...(draft.publisherVariant.trim().length === 0 ? {} : { publisherVariant: draft.publisherVariant.trim() }),
        status: draft.status,
        ...(draft.summary.length === 0 ? {} : { summary: draft.summary })
      });
      if (draft.seriesId !== undefined) {
        // The Catalog supplies the current count only to choose a human sequence; the service
        // enforces the relationship and rejects a conflicting position before it can persist.
        const nextPosition = this.catalog.orderedBooks(draft.seriesId).length + 1;
        await this.books.assignSeries(result.path, draft.seriesId, nextPosition);
      }
      new Notice(`Created publishing project “${result.book.title}”.`);
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Publishing project could not be created.');
      error.focus();
    }
  }
}
