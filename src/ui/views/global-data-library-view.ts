/** Native home for reusable publishing data that exists before and beyond any individual book. */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { BookCatalog } from '../../application/catalog/book-catalog';

export const GLOBAL_DATA_LIBRARY_VIEW_TYPE = 'publishing-manager-global-data-library';

export class GlobalDataLibraryView extends ItemView {
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog
  ) {
    super(leaf);
    this.icon = 'database';
    this.navigation = true;
  }
  public getViewType(): string {
    return GLOBAL_DATA_LIBRARY_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'Global data library';
  }
  protected override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager');
    root.createEl('p', { cls: 'pm-eyebrow', text: 'Shared publishing reference data' });
    root.createEl('h1', { text: 'Global data library' });
    root.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Manage reusable publishing data once, then select it throughout Publishing Manager.'
    });
    const isbn = root.createEl('section', { cls: 'pm-panel' });
    isbn.createEl('h2', { text: 'ISBN inventory' });
    isbn.createEl('p', {
      text: `${this.catalog.recordsOfType('isbn').length} ISBN record(s) are globally available. Import and lifecycle controls move here under GDL-002.`
    });
    const locations = root.createEl('section', { cls: 'pm-panel' });
    locations.createEl('h2', { text: 'Publication locations' });
    locations.createEl('p', {
      text: 'Reusable retailer, distributor, storefront, and physical-location records will supply distribution and sales without duplicate entry.'
    });
  }
}
