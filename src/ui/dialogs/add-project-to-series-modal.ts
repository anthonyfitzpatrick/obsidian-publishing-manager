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
    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
    for (const project of available) {
      const title = typeof project.fields.title === 'string' ? project.fields.title : project.id;
      new Setting(this.contentEl)
        .setName(title)
        .setDesc('Standalone Project')
        .addButton((button) =>
          button.setButtonText('Add').setCta().onClick(() => {
            button.setDisabled(true);
            void this.add(project, error).finally(() => button.setDisabled(false));
          })
        );
    }
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  /** Uses the service layer to give the selected Project the next unique sequence in this Series. */
  private async add(project: CatalogRecord, error: HTMLElement): Promise<void> {
    try {
      // Positions can have intentional gaps after a removal, so count+1 could collide with an
      // existing Project. Appending after the highest stored position always remains unique.
      const position =
        Math.max(
          0,
          ...this.catalog
            .orderedBooks(this.series.id)
            .map((member) =>
              typeof member.fields['series-position'] === 'number'
                ? member.fields['series-position']
                : 0
            )
        ) + 1;
      await this.books.assignSeries(project.path, this.series.id, position);
      new Notice(`Added “${String(project.fields.title)}” to this Series.`);
      this.close();
    } catch (cause) {
      error.setText(cause instanceof Error ? cause.message : 'Project could not be added to this Series.');
      error.focus();
    }
  }
}
