/** Chooses one standalone Project to attach to the currently open Series workspace. */

import { Modal, Notice, Setting, type App } from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { CatalogRecord } from '../../domain/catalog/catalog-model';

/** Focused chooser: the full Series page stays uncluttered while its available Projects remain reachable. */
export class AddProjectToSeriesModal extends Modal {
  public constructor(
    app: App,
    private readonly books: BookProjectService,
    private readonly catalog: BookCatalog,
    private readonly series: CatalogRecord
  ) {
    super(app);
  }

  /** Lists only standalone active Projects; Projects already belonging to a Series cannot be double-attached. */
  public override onOpen(): void {
    this.setTitle('Add Project to Series');
    this.contentEl.createEl('p', {
      text: `Choose a standalone Project to add to “${String(this.series.fields.name)}”.`
    });
    const available = this.catalog
      .orderedBooks()
      .filter((project) => !project.archived && typeof project.fields['series-id'] !== 'string');
    if (available.length === 0) {
      this.contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'There are no standalone Projects available to add.'
      });
      return;
    }
    for (const project of available) {
      const title = typeof project.fields.title === 'string' ? project.fields.title : project.id;
      let partNumber = nextPartNumber(this.catalog, this.series.id);
      new Setting(this.contentEl)
        .setName(title)
        .setDesc('Standalone Project · choose its Part number in this Series')
        .addText((text) => {
          text.setValue(String(partNumber)).onChange((value) => {
            partNumber = Number(value);
          });
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text.inputEl.step = '1';
          text.inputEl.setAttr('aria-label', `Part number for ${title}`);
        })
        .addButton((button) =>
          button.setButtonText('Add').setCta().onClick(() => {
            button.setDisabled(true);
            // Close before the vault/history pipeline starts. Obsidian can then paint and accept
            // input while the durable local write completes, rather than appearing stuck behind
            // an inert modal during slower vault or sync activity.
            this.close();
            new Notice(`Adding “${title}” to this Series…`);
            void this.add(project, partNumber);
          })
        );
    }
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Uses the service layer to give the selected Project the next unique sequence in this Series. */
  private async add(project: CatalogRecord, partNumber: number): Promise<void> {
    try {
      await this.books.assignSeries(project.path, this.series.id, partNumber);
      new Notice(`Added “${String(project.fields.title)}” to this Series.`);
      this.close();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : 'Project could not be added to this Series.');
    }
  }
}

/** Defaults new membership to the next unused Part number while still allowing an explicit choice. */
function nextPartNumber(catalog: BookCatalog, seriesId: string): number {
  return (
    Math.max(
      0,
      ...catalog.orderedBooks(seriesId).map((member) =>
        typeof member.fields['series-position'] === 'number' ? member.fields['series-position'] : 0
      )
    ) + 1
  );
}
