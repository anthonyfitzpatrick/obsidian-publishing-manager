/**
 * Makes Series membership explicit. It deliberately manages only the relationship between one
 * named Series and existing Projects; it does not duplicate Project metadata or edition work.
 */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';

/** Lets an owner add, reorder, or remove Projects from a single local Series. */
export class ManageSeriesModal extends Modal {
  private seriesId: string | undefined;
  private readonly selectedProjectPaths = new Set<string>();

  public constructor(
    app: App,
    private readonly books: BookProjectService,
    private readonly catalog: BookCatalog,
    initialSeriesId?: string
  ) {
    super(app);
    this.seriesId = initialSeriesId;
  }

  /** Rebuilds the small relationship editor whenever the owner changes the selected Series. */
  public override onOpen(): void {
    this.render();
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Renders a safe current snapshot; all persistence stays in BookProjectService. */
  private render(): void {
    this.contentEl.empty();
    this.setTitle('Manage series');
    const series = this.catalog.seriesRecords();
    if (series.length === 0) {
      this.contentEl.createEl('p', { text: 'Create a Series before assigning Projects to one.' });
      return;
    }
    if (!series.some((record) => record.id === this.seriesId)) this.seriesId = series[0]?.id;

    new Setting(this.contentEl)
      .setName('Series')
      .setDesc('Projects selected below belong to this Series. Unselected Projects become standalone.')
      .addDropdown((dropdown) => {
        for (const record of series) {
          const name = typeof record.fields.name === 'string' ? record.fields.name : record.id;
          dropdown.addOption(record.id, name);
        }
        dropdown.setValue(this.seriesId ?? '').onChange((value) => {
          this.seriesId = value;
          this.selectedProjectPaths.clear();
          this.render();
        });
        dropdown.selectEl.setAttr('aria-label', 'Series to manage');
      });

    const selected = this.catalog.orderedBooks(this.seriesId);
    for (const project of selected) this.selectedProjectPaths.add(project.path);
    const projects = this.catalog.orderedBooks().filter((project) => !project.archived);
    if (projects.length === 0) {
      this.contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'There are no active Projects yet. Create a Project, then return here to add it.'
      });
    } else {
      this.contentEl.createEl('h3', { text: 'Projects in this Series' });
      this.contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Turn Projects on to add them. Turning one on moves it here if it belongs to another Series; turning one off makes it standalone. The displayed order becomes the Series order.'
      });
      for (const project of projects) {
        const title = typeof project.fields.title === 'string' ? project.fields.title : project.id;
        new Setting(this.contentEl).setName(title).addToggle((toggle) =>
          toggle.setValue(this.selectedProjectPaths.has(project.path)).onChange((included) => {
            if (included) this.selectedProjectPaths.add(project.path);
            else this.selectedProjectPaths.delete(project.path);
          })
        );
      }
    }

    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText('Save Project membership')
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.save(error).finally(() => button.setDisabled(false));
        })
    );
  }

  /** Applies removals before assignments so every requested sequence is conflict-free. */
  private async save(error: HTMLElement): Promise<void> {
    if (this.seriesId === undefined) return;
    try {
      const current = this.catalog.orderedBooks(this.seriesId);
      for (const project of current) {
        if (!this.selectedProjectPaths.has(project.path)) await this.books.removeSeries(project.path);
      }
      const selected = this.catalog
        .orderedBooks()
        .filter((project) => this.selectedProjectPaths.has(project.path));
      for (const project of selected) {
        if (project.fields['series-id'] !== this.seriesId) await this.books.removeSeries(project.path);
      }
      for (const [index, project] of selected.entries()) {
        await this.books.assignSeries(project.path, this.seriesId, index + 1);
      }
      new Notice(`Saved ${selected.length} Project${selected.length === 1 ? '' : 's'} in this Series.`);
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Series membership could not be saved.');
      error.focus();
    }
  }
}
