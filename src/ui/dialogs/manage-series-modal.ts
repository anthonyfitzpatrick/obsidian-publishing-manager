/**
 * Makes Series membership explicit. It deliberately manages only the relationship between one
 * named Series and existing Projects; it does not duplicate Project metadata or edition work.
 */

import { Modal, Notice, Setting, TFile, type App } from 'obsidian';

import type { CatalogRecord } from '../../domain/catalog/catalog-model';

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

    const error = this.contentEl.createDiv({
      cls: 'publishing-manager-form-error',
      attr: { role: 'alert', 'aria-live': 'assertive', tabindex: '-1' }
    });
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

    const currentSeries = series.find((record) => record.id === this.seriesId);
    if (currentSeries !== undefined) this.renderCoverUpload(currentSeries, error);

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

  /**
   * Uses the same drag/drop, local derivative, and KDP-shaped image contract as Project covers.
   * The original remains untouched; only a bounded WebP derivative is owned by the Series note.
   */
  private renderCoverUpload(series: CatalogRecord, error: HTMLElement): void {
    this.contentEl.createEl('h3', { text: 'Series cover art' });
    const currentPath = series.fields.cover;
    const current =
      typeof currentPath === 'string' ? this.app.vault.getAbstractFileByPath(currentPath) : null;
    if (current instanceof TFile && /^(avif|gif|jpe?g|png|svg|webp)$/iu.test(current.extension)) {
      this.contentEl.createEl('img', {
        cls: 'pm-series-cover-preview',
        attr: { src: this.app.vault.getResourcePath(current), alt: `${String(series.fields.name)} cover art` }
      });
    }
    const drop = this.contentEl.createEl('button', {
      cls: 'pm-cover-drop-zone',
      text: 'Drop Series cover art here, or click to choose an image',
      attr: { type: 'button' }
    });
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    picker.hidden = true;
    drop.appendChild(picker);
    const acceptCover = (source: File | TFile) => {
      drop.setAttr('disabled', 'true');
      void this.optimizeSeriesCover(series, source)
        .then((path) => this.books.editSeries(series.path, { cover: path }))
        .then(() => {
          new Notice('Optimized Series cover art is ready.');
          this.render();
        })
        .catch((cause: unknown) => {
          error.setText(cause instanceof Error ? cause.message : 'Could not prepare the Series cover art.');
          error.focus();
        })
        .finally(() => drop.removeAttribute('disabled'));
    };
    picker.addEventListener('change', () => {
      const selected = picker.files?.[0];
      if (selected !== undefined) acceptCover(selected);
    });
    drop.addEventListener('click', () => picker.click());
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.addClass('is-dragging');
    });
    drop.addEventListener('dragleave', () => drop.removeClass('is-dragging'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.removeClass('is-dragging');
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) acceptCover(file);
      else new Notice('Drop a local image file or choose one from your device.');
    });
  }

  /** Creates the same 480×768 WebP derivative used for Project cards without copying originals. */
  private async optimizeSeriesCover(series: CatalogRecord, source: File | TFile): Promise<string> {
    const type = source instanceof File ? source.type : mimeTypeForCover(source.extension);
    if (!type.startsWith('image/')) throw new Error('Choose an AVIF, GIF, JPEG, PNG, SVG, or WebP image.');
    const bytes = source instanceof File ? await source.arrayBuffer() : await this.app.vault.readBinary(source);
    const bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const scale = Math.min(1, 480 / bitmap.width, 768 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This device could not prepare the cover image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const optimized = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error('Could not encode the cover image.')) : resolve(blob)),
        'image/webp',
        0.78
      )
    );
    const folder = `${series.path.slice(0, series.path.lastIndexOf('/'))}/Covers`;
    if (this.app.vault.getAbstractFileByPath(folder) === null) await this.app.vault.createFolder(folder);
    const target = `${folder}/${series.id}.webp`;
    const existing = this.app.vault.getAbstractFileByPath(target);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, await optimized.arrayBuffer());
    else await this.app.vault.createBinary(target, await optimized.arrayBuffer());
    return target;
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

/** Supplies the browser image MIME hint when an existing vault image is used as the source. */
function mimeTypeForCover(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === 'avif') return 'image/avif';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'svg') return 'image/svg+xml';
  return 'image/webp';
}
