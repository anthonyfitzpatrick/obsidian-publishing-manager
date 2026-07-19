/**
 * Renders the M3 Book Workspace around one valid catalog record. The persistent header supplies
 * identity, series, status, publication/readiness placeholders, edition context, and lifecycle
 * commands. Overview editing uses the shared draft store; navigation never discards input, while
 * explicit discard requires confirmation. Responsive desktop/mobile navigation and keyboard tabs
 * expose the same implemented content without hover or color-only meaning.
 */

import {
  ItemView,
  Notice,
  TFile,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian';

import type { BookProjectService } from '../../application/books/book-project-service';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { EditionProjectService } from '../../application/editions/edition-project-service';
import type {
  AssetReferenceService,
  AssetInspection
} from '../../application/assets/asset-reference-service';
import type { WorkflowProjectService } from '../../application/workflows/workflow-project-service';
import type { MetadataProjectService } from '../../application/metadata/metadata-project-service';
import { BOOK_STATUSES, type BookStatus } from '../../domain/books/book-project';
import { ManualCancellationToken } from '../../domain/foundation/cancellation';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic,
  CatalogRecord
} from '../../domain/catalog/catalog-model';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';
import {
  editionTypeLabel,
  isEditionMedium,
  type EditionType
} from '../../domain/editions/edition-project';
import { ConfirmDiscardModal } from '../dialogs/confirm-discard-modal';
import { ConfirmEditionArchiveModal } from '../dialogs/confirm-edition-archive-modal';
import { EditionEditorModal } from '../dialogs/edition-editor-modal';
import { EditionFormatModal } from '../dialogs/edition-format-modal';
import { EditionRevisionModal } from '../dialogs/edition-revision-modal';
import { LinkAssetModal, RelinkAssetModal } from '../dialogs/link-asset-modal';
import { createWorkflowWorkspaceState, renderWorkflowWorkspace } from './workflow-workspace';
import { createMetadataWorkspaceState, renderMetadataWorkspace } from './metadata-workspace';
import type { BookDraftStore, BookOverviewDraft } from '../state/book-draft-store';
import {
  ENABLED_WORKSPACE_TABS,
  isWorkspaceTab,
  nextWorkspaceTab,
  type WorkspaceTab
} from '../view-models/workspace-navigation';

/** Stable Obsidian view identifier persisted with the selected book and active tab. */
export const BOOK_WORKSPACE_VIEW_TYPE = 'publishing-manager-book-workspace';

const FUTURE_TABS = [
  'ISBNs',
  'Pricing',
  'Distribution',
  'Sales',
  'Launch',
  'Reviews',
  'Notes',
  'History'
] as const;

/** Native book workspace with per-book draft continuity and immutable catalog subscriptions. */
export class BookWorkspaceView extends ItemView {
  private unsubscribe: (() => void) | undefined;
  private unsubscribeAssets: (() => void) | undefined;
  private snapshot?: BookCatalogSnapshot;
  private selectedPath: VaultPath | undefined;
  private selectedEditionId: string | undefined;
  private activeTab: WorkspaceTab = 'overview';
  private operationError: string | undefined;

  /** Receives state/services and dashboard navigation without importing persistence adapters. */
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly books: BookProjectService,
    private readonly editions: EditionProjectService,
    private readonly assets: AssetReferenceService,
    private readonly workflows: WorkflowProjectService,
    private readonly metadata: MetadataProjectService,
    private readonly drafts: BookDraftStore,
    private readonly openDashboard: () => Promise<void>
  ) {
    super(leaf);
    this.icon = 'book-open';
    this.navigation = true;
  }

  /** Runtime-only workflow view choices never become a competing canonical workflow record. */
  private readonly workflowState = createWorkflowWorkspaceState();
  /** Profile choice is runtime presentation state; effective metadata remains derived. */
  private readonly metadataState = createMetadataWorkspaceState();

  /**
   * Renders book-scoped links and fills each evidence card asynchronously. Inspection reads file
   * metadata only; content buttons create an explicit cancellable fingerprint operation.
   */
  private renderAssets(parent: HTMLElement, book: CatalogRecord): void {
    const section = parent.createEl('section', { cls: 'pm-panel pm-assets-page' });
    const heading = section.createDiv({ cls: 'pm-section-heading' });
    const title = heading.createDiv();
    title.createEl('p', { cls: 'pm-eyebrow', text: 'Existing vault files · never copied' });
    title.createEl('h2', { text: 'Production assets' });
    const link = heading.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Link existing asset',
      attr: { type: 'button' }
    });
    const editions = this.catalog.editionsForBook(book.id);
    const formats = editions.flatMap((edition) => this.catalog.formatsForEdition(edition.id));
    link.addEventListener('click', () =>
      new LinkAssetModal(this.app, this.assets, book, editions, formats, () => undefined).open()
    );
    section.createEl('p', {
      text: 'Freshness is derived from live existence and comparison evidence. Matching modified time and size are useful but cannot prove identical content; SHA-256 verification reads the entire file only when you explicitly request it.'
    });

    const records = this.catalog
      .recordsOfType('asset-reference')
      .filter((record) => record.fields['book-id'] === book.id);
    if (records.length === 0) {
      section.createDiv({
        cls: 'pm-empty-state',
        text: 'No linked assets. Link a cover, EPUB, DOCX, HTML, Markdown, XML, print file, press kit, media image, or author photo.'
      });
    } else {
      const list = section.createEl('ul', { cls: 'pm-asset-list' });
      for (const record of records) {
        const item = list.createEl('li', { cls: 'pm-asset-card' });
        const itemHeading = item.createDiv({ cls: 'pm-section-heading' });
        const labels = itemHeading.createDiv();
        labels.createEl('strong', { text: assetRoleLabel(String(record.fields.role)) });
        labels.createEl('small', { text: String(record.fields.path) });
        const actions = itemHeading.createDiv({ cls: 'pm-action-row' });
        const relink = editionAction(actions, 'Relink');
        relink.addEventListener('click', () =>
          new RelinkAssetModal(
            this.app,
            this.assets,
            record.path,
            String(record.fields.path),
            () => undefined
          ).open()
        );
        const open = editionAction(actions, 'Open reference note');
        open.addEventListener('click', () => void this.openCanonicalNote(record.path));
        const evidence = item.createDiv({
          cls: 'pm-asset-evidence',
          attr: { 'aria-live': 'polite' }
        });
        evidence.setText('Inspecting vault metadata…');
        void this.assets
          .inspect(record)
          .then((inspection) => this.renderAssetInspection(evidence, inspection))
          .catch((cause: unknown) =>
            evidence.setText(
              cause instanceof Error ? cause.message : 'Asset evidence is unavailable.'
            )
          );
        const fingerprintActions = item.createDiv({ cls: 'pm-action-row' });
        const capture = editionAction(
          fingerprintActions,
          record.fields.fingerprint === undefined
            ? 'Capture SHA-256 fingerprint'
            : 'Replace fingerprint baseline'
        );
        const verify = editionAction(fingerprintActions, 'Verify fingerprint now');
        verify.toggleAttribute('disabled', record.fields.fingerprint === undefined);
        const runFingerprint = (mode: 'capture' | 'verify') => {
          const token = new ManualCancellationToken();
          capture.disabled = true;
          verify.disabled = true;
          const cancel = editionAction(fingerprintActions, 'Cancel fingerprinting');
          cancel.addEventListener('click', () => {
            token.cancel();
            cancel.disabled = true;
          });
          evidence.setText('Reading this file to compute SHA-256…');
          const operation =
            mode === 'capture'
              ? this.assets.captureFingerprint(record.path, token).then(() => undefined)
              : this.assets
                  .verifyFingerprint(record, token)
                  .then((inspection) => this.renderAssetInspection(evidence, inspection));
          void operation
            .catch((cause: unknown) =>
              evidence.setText(cause instanceof Error ? cause.message : 'Fingerprinting failed.')
            )
            .finally(() => {
              cancel.remove();
              capture.disabled = false;
              verify.disabled = record.fields.fingerprint === undefined;
            });
        };
        capture.addEventListener('click', () => runFingerprint('capture'));
        verify.addEventListener('click', () => runFingerprint('verify'));
        const metadata = editionAction(fingerprintActions, 'Accept current metadata baseline');
        metadata.addEventListener('click', () => {
          metadata.disabled = true;
          void this.assets.acceptCurrentMetadata(record.path).catch((cause: unknown) => {
            evidence.setText(
              cause instanceof Error ? cause.message : 'Metadata baseline could not be updated.'
            );
            metadata.disabled = false;
          });
        });
      }
    }
    this.renderAssetRepairPreview(section, book.id);
  }

  /** Renders text-labelled evidence so every state remains understandable without badge color. */
  private renderAssetInspection(parent: HTMLElement, inspection: AssetInspection): void {
    parent.empty();
    parent.createEl('strong', {
      cls: `pm-status-chip pm-status-chip--${inspection.assessment.state}`,
      text: assetRoleLabel(inspection.assessment.state)
    });
    const evidence = parent.createEl('ul');
    for (const line of inspection.assessment.evidence) evidence.createEl('li', { text: line });
    parent.createEl('p', {
      cls: 'pm-muted',
      text: `Limitation: ${inspection.assessment.limitation}`
    });
  }

  /** Builds AST-008 folder repair previews without applying a hidden multi-record mutation. */
  private renderAssetRepairPreview(parent: HTMLElement, bookId: string): void {
    const details = parent.createEl('details', { cls: 'pm-edition-subsection' });
    details.createEl('summary', { text: 'Bulk path-repair preview' });
    details.createEl('p', {
      text: 'Preview how a moved folder would affect every matching reference. No record changes until you open and relink an individual reviewed result.'
    });
    const fields = details.createDiv({ cls: 'pm-form-grid' });
    const previous = createInputField(fields, 'Previous folder prefix', 'text', '');
    const next = createInputField(fields, 'New folder prefix', 'text', '');
    const preview = details.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Preview repairs',
      attr: { type: 'button' }
    });
    const results = details.createDiv({ attr: { 'aria-live': 'polite' } });
    preview.addEventListener('click', () => {
      preview.disabled = true;
      results.setText('Checking proposed targets…');
      void this.assets
        .previewPathRepair(bookId, previous.value, next.value)
        .then((items) => {
          results.empty();
          if (items.length === 0)
            results.createEl('p', { text: 'No linked paths match that previous prefix.' });
          const list = results.createEl('ul', { cls: 'pm-asset-list' });
          for (const item of items) {
            const row = list.createEl('li', { cls: 'pm-asset-card' });
            row.createEl('strong', { text: assetRoleLabel(item.status) });
            row.createEl('p', {
              text: `${item.currentPath} → ${item.proposedPath ?? 'invalid path'}`
            });
            row.createEl('small', { text: item.explanation });
            if (item.status === 'ready' && item.proposedPath !== undefined) {
              const relink = editionAction(row, 'Review and relink');
              relink.addEventListener('click', () =>
                new RelinkAssetModal(
                  this.app,
                  this.assets,
                  item.recordPath,
                  item.currentPath,
                  () => undefined,
                  item.proposedPath as string
                ).open()
              );
            }
          }
        })
        .catch((cause: unknown) =>
          results.setText(cause instanceof Error ? cause.message : 'Repair preview failed.')
        )
        .finally(() => {
          preview.disabled = false;
        });
    });
  }

  /** Identifies this view to Obsidian workspace persistence. */
  public getViewType(): string {
    return BOOK_WORKSPACE_VIEW_TYPE;
  }

  /** Uses the selected title when available while keeping a stable fallback tab label. */
  public getDisplayText(): string {
    const book = this.snapshot?.books.find(({ path }) => path === this.selectedPath);
    return typeof book?.fields.title === 'string' ? book.fields.title : 'Book Workspace';
  }

  /** Persists navigation state without serializing private draft content into workspace layout. */
  public override getState(): Record<string, unknown> {
    return {
      ...(this.selectedPath === undefined ? {} : { bookPath: this.selectedPath }),
      ...(this.selectedEditionId === undefined ? {} : { editionId: this.selectedEditionId }),
      tab: this.activeTab
    };
  }

  /** Restores only validated path/tab state and lets the subscription resolve current data. */
  public override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (isRecord(state)) {
      const bookPath = state.bookPath;
      if (typeof bookPath === 'string') {
        try {
          this.selectedPath = normalizeVaultPath(bookPath);
        } catch {
          this.selectedPath = undefined;
        }
      }
      if (isWorkspaceTab(state.tab)) this.activeTab = state.tab;
      if (typeof state.editionId === 'string') this.selectedEditionId = state.editionId;
    }
    result.history = true;
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Subscribes while open and selects the first active book only when state has no valid choice. */
  protected override async onOpen(): Promise<void> {
    this.unsubscribe = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.reconcileSelection(snapshot);
      this.reconcileEditionSelection(snapshot);
      this.render(snapshot);
    });
    this.unsubscribeAssets = this.assets.subscribe(() => {
      if (this.snapshot !== undefined && this.activeTab === 'assets') this.render(this.snapshot);
    });
  }

  /** Preserves drafts in the shared store while releasing only this view's subscription and DOM. */
  protected override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribeAssets?.();
    this.unsubscribe = undefined;
    this.contentEl.empty();
  }

  /** Keeps selection valid after external delete/repair and never transfers a draft to another book. */
  private reconcileSelection(snapshot: BookCatalogSnapshot): void {
    if (
      this.selectedPath !== undefined &&
      snapshot.books.some(({ path }) => path === this.selectedPath)
    ) {
      return;
    }
    if (this.selectedPath !== undefined) this.drafts.forget(this.selectedPath);
    this.selectedPath =
      snapshot.books.find(({ archived }) => !archived)?.path ?? snapshot.books[0]?.path;
  }

  /** Keeps edition selection scoped to the chosen book and prefers active records. */
  private reconcileEditionSelection(snapshot: BookCatalogSnapshot): void {
    const book = snapshot.books.find(({ path }) => path === this.selectedPath);
    if (book === undefined) {
      this.selectedEditionId = undefined;
      return;
    }
    const editions = this.catalog.editionsForBook(book.id);
    if (editions.some(({ id }) => id === this.selectedEditionId)) return;
    this.selectedEditionId = editions.find(({ archived }) => !archived)?.id ?? editions[0]?.id;
  }

  /** Renders explicit availability/empty state or the complete M1 workspace. */
  private render(snapshot: BookCatalogSnapshot): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-workspace');
    if (snapshot.availability.state !== 'ready') {
      renderWorkspaceState(
        root,
        snapshot.availability.state,
        'message' in snapshot.availability ? snapshot.availability.message : undefined
      );
    }
    const record = snapshot.books.find(({ path }) => path === this.selectedPath);
    if (record === undefined) {
      renderNoBook(root, snapshot, () => void this.openDashboard());
      return;
    }

    this.renderHeader(root, record);
    this.renderNavigation(root);
    if (this.operationError !== undefined) {
      root.createDiv({
        cls: 'pm-inline-alert',
        text: this.operationError,
        attr: { role: 'alert' }
      });
    }
    const content = root.createDiv({ cls: 'pm-workspace-content' });
    if (this.activeTab === 'overview') {
      this.renderOverview(content, record, snapshot);
    } else if (this.activeTab === 'workflow') {
      renderWorkflowWorkspace({
        parent: content,
        book: record,
        snapshot,
        workflows: this.workflows,
        state: this.workflowState,
        rerender: () => {
          if (this.snapshot !== undefined) this.render(this.snapshot);
        },
        openNote: (path) => this.openCanonicalNote(path)
      });
    } else if (this.activeTab === 'editions') {
      this.renderEditions(content, record);
    } else if (this.activeTab === 'metadata') {
      renderMetadataWorkspace({
        parent: content,
        book: record,
        ...(this.selectedEditionId === undefined
          ? {}
          : { selectedEditionId: this.selectedEditionId }),
        snapshot,
        metadata: this.metadata,
        state: this.metadataState,
        rerender: () => {
          if (this.snapshot !== undefined) this.render(this.snapshot);
        }
      });
    } else if (this.activeTab === 'assets') {
      this.renderAssets(content, record);
    } else {
      this.renderDiagnostics(content, record, snapshot);
    }
  }

  /** Builds the persistent header required by UI-002 with honest unavailable placeholders. */
  private renderHeader(root: HTMLElement, record: CatalogRecord): void {
    const header = root.createEl('header', { cls: 'pm-workspace-header' });
    const breadcrumb = header.createDiv({ cls: 'pm-breadcrumb' });
    const dashboard = breadcrumb.createEl('button', {
      cls: 'pm-text-button',
      text: 'Dashboard',
      attr: { type: 'button', 'aria-label': 'Return to publishing dashboard' }
    });
    dashboard.addEventListener('click', () => void this.openDashboard());
    breadcrumb.createSpan({ text: '›' });
    breadcrumb.createSpan({ text: String(record.fields.title) });

    const identity = header.createDiv({ cls: 'pm-workspace-header__identity' });
    const titles = identity.createDiv();
    titles.createEl('p', { cls: 'pm-eyebrow', text: this.seriesLabel(record) });
    titles.createEl('h1', { text: String(record.fields.title) });
    titles.createSpan({
      cls: `pm-status-chip pm-status-chip--${record.archived ? 'archived' : String(record.fields.status)}`,
      text: record.archived ? '◇ Archived book' : `● ${String(record.fields.status)} book`
    });

    const commands = identity.createDiv({ cls: 'pm-action-row' });
    const openNote = commands.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Open Markdown',
      attr: { type: 'button' }
    });
    openNote.addEventListener('click', () => void this.openCanonicalNote(record.path));
    const lifecycle = commands.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: record.archived ? 'Restore book' : 'Archive book',
      attr: { type: 'button' }
    });
    lifecycle.addEventListener('click', () => void this.changeArchiveState(record));

    const context = header.createDiv({ cls: 'pm-context-grid' });
    const bookEditions = this.catalog.editionsForBook(record.id);
    const selectedEdition = bookEditions.find(({ id }) => id === this.selectedEditionId);
    renderContextItem(
      context,
      'Publication anchor',
      typeof selectedEdition?.fields['publication-date'] === 'string'
        ? selectedEdition.fields['publication-date']
        : '— Not set',
      selectedEdition === undefined
        ? 'Create an edition to set its publication date.'
        : 'From the selected edition.'
    );
    renderContextItem(context, 'Readiness', '○ Not calculated', 'Readiness scoring begins in M5.');
    const edition = context.createDiv({ cls: 'pm-context-item' });
    edition.createSpan({ text: 'Edition' });
    const selector = edition.createEl('select', {
      attr: { 'aria-label': 'Selected edition context' }
    });
    if (bookEditions.length === 0) {
      selector.createEl('option', { text: 'No editions yet' });
      selector.disabled = true;
    } else {
      for (const candidate of bookEditions) {
        selector.createEl('option', {
          value: candidate.id,
          text: editionRecordLabel(candidate),
          attr: candidate.id === this.selectedEditionId ? { selected: 'true' } : {}
        });
      }
      selector.addEventListener('change', () => {
        this.selectedEditionId = selector.value;
        this.selectTab('editions');
      });
    }
    edition.createEl('small', {
      text:
        selectedEdition === undefined
          ? 'Edition management is available in the Editions tab.'
          : `${String(selectedEdition.fields.medium)} · ${String(selectedEdition.fields.status)}`
    });
  }

  /** Renders desktop tabs and an equivalent mobile picker over the same active state. */
  private renderNavigation(root: HTMLElement): void {
    const nav = root.createEl('nav', {
      cls: 'pm-workspace-tabs',
      attr: { 'aria-label': 'Book workspace sections' }
    });
    const tablist = nav.createDiv({
      attr: { role: 'tablist', 'aria-label': 'Book workspace tabs' }
    });
    for (const tab of ENABLED_WORKSPACE_TABS) {
      const button = tablist.createEl('button', {
        cls: `pm-tab${this.activeTab === tab ? ' is-active' : ''}`,
        text: capitalize(tab),
        attr: {
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.activeTab === tab),
          tabindex: this.activeTab === tab ? '0' : '-1'
        }
      });
      button.addEventListener('click', () => this.selectTab(tab));
      button.addEventListener('keydown', (event) => this.handleTabKey(event, tab, tablist));
    }
    for (const tab of FUTURE_TABS) {
      tablist.createEl('button', {
        cls: 'pm-tab',
        text: tab,
        attr: {
          type: 'button',
          role: 'tab',
          disabled: 'true',
          'aria-disabled': 'true',
          title: 'Planned for a later milestone'
        }
      });
    }

    const mobile = nav.createEl('label', { cls: 'pm-mobile-tab-picker' });
    mobile.createSpan({ text: 'Workspace section' });
    const select = mobile.createEl('select', { attr: { 'aria-label': 'Workspace section' } });
    for (const tab of ENABLED_WORKSPACE_TABS) {
      select.createEl('option', {
        text: capitalize(tab),
        value: tab,
        attr: this.activeTab === tab ? { selected: 'true' } : {}
      });
    }
    select.addEventListener('change', () => {
      if (isWorkspaceTab(select.value)) this.selectTab(select.value);
    });
  }

  /** Renders editable identity/summary plus next step, activity, and diagnostics in a split layout. */
  private renderOverview(
    parent: HTMLElement,
    record: CatalogRecord,
    snapshot: BookCatalogSnapshot
  ): void {
    const draft = this.drafts.ensure(record);
    const grid = parent.createDiv({ cls: 'pm-overview-grid' });
    const primary = grid.createDiv({ cls: 'pm-overview-primary' });
    const form = primary.createEl('section', { cls: 'pm-panel' });
    const heading = form.createDiv({ cls: 'pm-section-heading' });
    heading.createDiv().createEl('h2', { text: 'Book overview' });
    const dirty = heading.createSpan({
      cls: 'pm-dirty-indicator',
      text: draft.dirty ? '● Unsaved draft' : '✓ Saved',
      attr: { 'aria-live': 'polite' }
    });

    const fields = form.createDiv({ cls: 'pm-form-grid' });
    const title = createInputField(fields, 'Title', 'text', draft.title);
    const language = createInputField(fields, 'Primary language', 'text', draft.primaryLanguage);
    const statusLabel = fields.createEl('label', { cls: 'pm-field' });
    statusLabel.createSpan({ text: 'Status' });
    const status = statusLabel.createEl('select');
    for (const value of BOOK_STATUSES) {
      status.createEl('option', {
        text: capitalize(value),
        value,
        attr: draft.status === value ? { selected: 'true' } : {}
      });
    }
    const summaryLabel = fields.createEl('label', { cls: 'pm-field pm-field--wide' });
    summaryLabel.createSpan({ text: 'Summary' });
    const summary = summaryLabel.createEl('textarea', {
      text: draft.summary,
      attr: { rows: '6', maxlength: '4000' }
    });
    const validation = form.createDiv({
      cls: 'pm-validation-summary',
      attr: { 'aria-live': 'polite' }
    });
    const actions = form.createDiv({ cls: 'pm-action-row' });
    const save = actions.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Save changes',
      attr: { type: 'button' }
    });
    const discard = actions.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Discard draft',
      attr: { type: 'button' }
    });

    const update = (patch: Parameters<BookDraftStore['update']>[1]) => {
      const next = this.drafts.update(record.path, patch);
      dirty.setText(next.dirty ? '● Unsaved draft' : '✓ Saved');
      renderDraftValidation(validation, next);
      save.toggleAttribute('disabled', !next.dirty || next.diagnostics.length > 0);
      discard.toggleAttribute('disabled', !next.dirty);
    };
    title.addEventListener('input', () => update({ title: title.value }));
    language.addEventListener('input', () => update({ primaryLanguage: language.value }));
    status.addEventListener('change', () => update({ status: status.value as BookStatus }));
    summary.addEventListener('input', () => update({ summary: summary.value }));
    renderDraftValidation(validation, draft);
    save.toggleAttribute('disabled', !draft.dirty || draft.diagnostics.length > 0);
    discard.toggleAttribute('disabled', !draft.dirty);
    save.addEventListener('click', () => void this.saveDraft(record, save));
    discard.addEventListener('click', () => {
      new ConfirmDiscardModal(this.app, () => {
        this.drafts.discard(record.path);
        this.render(snapshot);
      }).open();
    });

    const aside = grid.createDiv({ cls: 'pm-overview-aside' });
    const next = aside.createEl('section', { cls: 'pm-panel pm-next-action' });
    next.createEl('p', { cls: 'pm-eyebrow', text: 'Next publishing step' });
    next.createEl('h2', { text: snapshot.nextMilestone.title });
    next.createEl('p', { text: snapshot.nextMilestone.explanation });
    renderBookDiagnostics(aside, record, snapshot.diagnostics);
    renderBookActivity(aside, record, snapshot);
  }

  /** Renders EDN-009 accessible master/detail edition management with mobile-safe cards. */
  private renderEditions(parent: HTMLElement, book: CatalogRecord): void {
    const bookEditions = this.catalog.editionsForBook(book.id);
    const heading = parent.createDiv({ cls: 'pm-section-heading' });
    const title = heading.createDiv();
    title.createEl('p', { cls: 'pm-eyebrow', text: 'Editions and formats' });
    title.createEl('h2', { text: 'Edition workspace' });
    title.createEl('p', {
      text: 'Manage stable edition identities, format-specific production details, revisions, comparisons, and archival.'
    });
    const add = heading.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Add edition',
      attr: { type: 'button' }
    });
    add.addEventListener('click', () => {
      new EditionEditorModal(this.app, this.editions, book.id, undefined, (editionId) => {
        this.selectedEditionId = editionId;
        new Notice('Edition created.');
      }).open();
    });

    if (bookEditions.length === 0) {
      const empty = parent.createDiv({ cls: 'pm-empty-state' });
      const icon = empty.createDiv({ cls: 'pm-empty-state__icon' });
      setIcon(icon, 'layers');
      empty.createEl('h3', { text: 'No editions yet' });
      empty.createEl('p', {
        text: 'Add a paperback, hardcover, ebook, audiobook, large-print, special, collector, box-set, or custom edition.'
      });
      return;
    }

    const selected =
      bookEditions.find(({ id }) => id === this.selectedEditionId) ?? bookEditions[0];
    if (selected === undefined) return;
    const layout = parent.createDiv({ cls: 'pm-editions-layout' });
    const master = layout.createEl('nav', {
      cls: 'pm-edition-master pm-panel',
      attr: { 'aria-label': 'Book editions' }
    });
    master.createEl('h3', { text: `Editions · ${bookEditions.length}` });
    const list = master.createEl('ul', { cls: 'pm-edition-list' });
    for (const edition of bookEditions) {
      const item = list.createEl('li');
      const button = item.createEl('button', {
        cls: `pm-edition-card${edition.id === selected.id ? ' is-selected' : ''}`,
        attr: {
          type: 'button',
          'aria-current': edition.id === selected.id ? 'true' : 'false'
        }
      });
      button.createEl('strong', { text: editionRecordLabel(edition) });
      button.createSpan({
        text: edition.archived ? '◇ Archived' : `● ${capitalize(String(edition.fields.status))}`
      });
      button.createEl('small', {
        text: `${capitalize(String(edition.fields.medium))} · ${this.catalog.formatsForEdition(edition.id).length} formats`
      });
      button.addEventListener('click', () => {
        this.selectedEditionId = edition.id;
        if (this.snapshot !== undefined) this.render(this.snapshot);
      });
    }

    const detail = layout.createEl('article', {
      cls: 'pm-edition-detail pm-panel',
      attr: { 'aria-label': `${editionRecordLabel(selected)} details` }
    });
    this.renderEditionDetail(detail, book, selected, bookEditions);
  }

  /** Builds one edition detail card with conditional data, formats, comparison, and dependencies. */
  private renderEditionDetail(
    parent: HTMLElement,
    book: CatalogRecord,
    edition: CatalogRecord,
    bookEditions: readonly CatalogRecord[]
  ): void {
    const heading = parent.createDiv({ cls: 'pm-section-heading' });
    const title = heading.createDiv();
    title.createEl('p', { cls: 'pm-eyebrow', text: `${String(edition.fields.medium)} edition` });
    title.createEl('h3', { text: editionRecordLabel(edition) });
    title.createSpan({
      cls: `pm-status-chip pm-status-chip--${edition.archived ? 'archived' : String(edition.fields.status)}`,
      text: edition.archived ? '◇ Archived edition' : `● ${String(edition.fields.status)} edition`
    });
    const actions = heading.createDiv({ cls: 'pm-action-row' });
    const edit = editionAction(actions, 'Edit edition');
    const revise = editionAction(actions, 'Create revision');
    const open = editionAction(actions, 'Open Markdown');
    const lifecycle = editionAction(
      actions,
      edition.archived ? 'Restore edition' : 'Archive edition'
    );
    edit.addEventListener('click', () => {
      new EditionEditorModal(this.app, this.editions, book.id, edition, () => {
        new Notice('Edition saved.');
      }).open();
    });
    revise.addEventListener('click', () => {
      new EditionRevisionModal(this.app, this.editions, edition.path, (editionId) => {
        this.selectedEditionId = editionId;
        new Notice('Reviewed revision created.');
      }).open();
    });
    open.addEventListener('click', () => void this.openCanonicalNote(edition.path));
    lifecycle.addEventListener('click', () => {
      if (edition.archived) void this.changeEditionArchiveState(edition, false);
      else {
        new ConfirmEditionArchiveModal(
          this.app,
          this.editions.assessRemoval(edition.id),
          () => void this.changeEditionArchiveState(edition, true)
        ).open();
      }
    });

    const details = parent.createEl('dl', { cls: 'pm-edition-facts' });
    editionFact(details, 'Publication date', valueText(edition.fields['publication-date']));
    editionFact(details, 'Cover', valueText(edition.fields.cover));
    editionFact(details, 'Trim', trimText(edition));
    editionFact(details, 'Page count', valueText(edition.fields['page-count']));
    editionFact(details, 'Narrator', valueText(edition.fields.narrator));
    editionFact(details, 'Duration', durationText(edition.fields['duration-minutes']));
    editionFact(details, 'Retail links', mapText(edition.fields['retail-links']));
    editionFact(details, 'Audio metadata', mapText(edition.fields['audio-metadata']));
    editionFact(details, 'Notes', valueText(edition.fields.notes));

    this.renderEditionFormats(parent, edition);
    this.renderEditionComparison(parent, edition, bookEditions);
    this.renderEditionDependants(parent, edition, bookEditions);
  }

  /** Renders semantic format/file cards and launches the conditional add-format workflow. */
  private renderEditionFormats(parent: HTMLElement, edition: CatalogRecord): void {
    const section = parent.createEl('section', { cls: 'pm-edition-subsection' });
    const heading = section.createDiv({ cls: 'pm-section-heading' });
    heading.createEl('h4', { text: 'Formats and files' });
    const add = editionAction(heading, 'Add format');
    const medium = edition.fields.medium;
    add.toggleAttribute('disabled', typeof medium !== 'string' || !isEditionMedium(medium));
    add.addEventListener('click', () => {
      if (typeof medium !== 'string' || !isEditionMedium(medium)) return;
      new EditionFormatModal(this.app, this.editions, edition.id, medium, () => {
        new Notice('Edition format added.');
      }).open();
    });
    const formats = this.catalog.formatsForEdition(edition.id);
    if (formats.length === 0) {
      section.createEl('p', {
        cls: 'pm-muted',
        text: 'No format records. Add each print, digital, or audio output with optional vault-file and accessibility evidence.'
      });
      return;
    }
    const list = section.createEl('ul', { cls: 'pm-format-list' });
    for (const format of formats) {
      const item = list.createEl('li');
      item.createEl('strong', {
        text:
          typeof format.fields.label === 'string' ? format.fields.label : String(format.fields.kind)
      });
      item.createSpan({
        text: `${capitalize(String(format.fields.category))} · ${String(format.fields.kind)}`
      });
      item.createEl('small', { text: valueText(format.fields['file-path']) });
      item.createEl('p', {
        text: `Accessibility: ${mapText(format.fields.accessibility)}`
      });
      const open = editionAction(item, 'Open format Markdown');
      open.addEventListener('click', () => void this.openCanonicalNote(format.path));
    }
  }

  /** Renders EDN-007 comparison as a labelled table with text equality cues. */
  private renderEditionComparison(
    parent: HTMLElement,
    edition: CatalogRecord,
    bookEditions: readonly CatalogRecord[]
  ): void {
    const section = parent.createEl('section', { cls: 'pm-edition-subsection' });
    section.createEl('h4', { text: 'Compare editions and revisions' });
    if (bookEditions.length < 2) {
      section.createEl('p', {
        cls: 'pm-muted',
        text: 'Create another edition or revision to compare.'
      });
      return;
    }
    const label = section.createEl('label', { cls: 'pm-field' });
    label.createSpan({ text: `Compare ${editionRecordLabel(edition)} with` });
    const select = label.createEl('select');
    for (const candidate of bookEditions.filter(({ id }) => id !== edition.id)) {
      select.createEl('option', { value: candidate.id, text: editionRecordLabel(candidate) });
    }
    const region = section.createDiv({ attr: { 'aria-live': 'polite' } });
    const render = () => {
      region.empty();
      try {
        const comparison = this.editions.compare(edition.id, select.value);
        const table = region.createEl('table', { cls: 'pm-comparison-table' });
        const head = table.createEl('thead').createEl('tr');
        for (const text of [
          'Group',
          'Field',
          editionRecordLabel(comparison.left),
          editionRecordLabel(comparison.right),
          'Result'
        ]) {
          head.createEl('th', { text, attr: { scope: 'col' } });
        }
        const body = table.createEl('tbody');
        for (const row of comparison.rows) {
          const tableRow = body.createEl('tr');
          tableRow.createEl('th', { text: capitalize(row.group), attr: { scope: 'row' } });
          tableRow.createEl('td', { text: row.label });
          tableRow.createEl('td', { text: row.left });
          tableRow.createEl('td', { text: row.right });
          tableRow.createEl('td', { text: row.equal ? '✓ Same' : '↔ Different' });
        }
      } catch (error) {
        region.createDiv({
          cls: 'pm-inline-alert',
          text: error instanceof Error ? error.message : 'Comparison is unavailable.',
          attr: { role: 'alert' }
        });
      }
    };
    select.addEventListener('change', render);
    render();
  }

  /** Lists exact dependent records and offers explicit same-book reassignment one at a time. */
  private renderEditionDependants(
    parent: HTMLElement,
    edition: CatalogRecord,
    bookEditions: readonly CatalogRecord[]
  ): void {
    const section = parent.createEl('section', { cls: 'pm-edition-subsection' });
    const assessment = this.editions.assessRemoval(edition.id);
    section.createEl('h4', { text: `Dependent records · ${assessment.dependants.length}` });
    section.createEl('p', { text: assessment.explanation });
    if (assessment.dependants.length === 0) return;
    const targets = bookEditions.filter(({ id, archived }) => id !== edition.id && !archived);
    const list = section.createEl('ul', { cls: 'pm-dependant-list' });
    for (const dependant of assessment.dependants) {
      const item = list.createEl('li');
      item.createEl('strong', { text: `${dependant.type} · ${dependant.id}` });
      item.createEl('small', { text: dependant.path });
      if (targets.length === 0) {
        item.createEl('p', {
          text: 'Create another active edition before reassigning this record.'
        });
        continue;
      }
      const row = item.createDiv({ cls: 'pm-action-row' });
      const select = row.createEl('select', {
        attr: { 'aria-label': `Target edition for ${dependant.id}` }
      });
      for (const target of targets) {
        select.createEl('option', { value: target.id, text: editionRecordLabel(target) });
      }
      const reassign = editionAction(row, 'Reassign record');
      reassign.addEventListener('click', () => {
        reassign.disabled = true;
        void this.editions
          .reassignDependant(dependant.path, edition.id, select.value)
          .then(() => new Notice('Dependent record reassigned.'))
          .catch((error: unknown) => {
            this.operationError =
              error instanceof Error ? error.message : 'Dependent record could not be reassigned.';
            reassign.disabled = false;
            if (this.snapshot !== undefined) this.render(this.snapshot);
          });
      });
    }
  }

  /** Renders the read-mostly Diagnostics tab with path, field, explanation, and repair action. */
  private renderDiagnostics(
    parent: HTMLElement,
    record: CatalogRecord,
    snapshot: BookCatalogSnapshot
  ): void {
    const section = parent.createEl('section', { cls: 'pm-panel pm-diagnostics-page' });
    section.createEl('p', { cls: 'pm-eyebrow', text: 'Read-only guidance' });
    section.createEl('h2', { text: 'Book diagnostics' });
    section.createEl('p', {
      text: 'The plugin does not silently rewrite damaged data. Open the named Markdown note and follow the suggested repair.'
    });
    const diagnostics = diagnosticsFor(record, snapshot.diagnostics);
    if (diagnostics.length === 0) {
      section.createDiv({ cls: 'pm-success-state', text: '✓ No diagnostics for this book.' });
      return;
    }
    const list = section.createEl('ul', { cls: 'pm-diagnostic-list pm-diagnostic-list--full' });
    for (const diagnostic of diagnostics) {
      const item = list.createEl('li');
      item.createEl('strong', { text: `⚠ ${diagnostic.message}` });
      item.createEl('p', {
        text: `Field: ${diagnostic.field ?? 'record'} · Path: ${diagnostic.path}`
      });
      item.createEl('p', { text: diagnostic.suggestedAction });
      const open = item.createEl('button', {
        cls: 'pm-button pm-button--secondary',
        text: 'Open Markdown note',
        attr: { type: 'button' }
      });
      open.addEventListener('click', () => void this.openCanonicalNote(diagnostic.path));
    }
  }

  /** Persists the current valid draft and refreshes its baseline from the accepted catalog record. */
  private async saveDraft(record: CatalogRecord, button: HTMLButtonElement): Promise<void> {
    button.setAttr('disabled', 'true');
    this.operationError = undefined;
    try {
      const result = await this.books.edit(record.path, this.drafts.toEditInput(record.path));
      const accepted = this.catalog.recordById(result.book.id);
      if (accepted !== undefined) this.drafts.markSaved(accepted);
      new Notice('Book overview saved.');
    } catch (error) {
      this.operationError =
        error instanceof Error ? error.message : 'Book overview could not be saved.';
    }
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Changes only edition archive state and keeps the selected identity for immediate review. */
  private async changeEditionArchiveState(record: CatalogRecord, archived: boolean): Promise<void> {
    this.operationError = undefined;
    try {
      if (archived) await this.editions.archive(record.path);
      else await this.editions.restore(record.path);
      new Notice(archived ? 'Edition archived with links retained.' : 'Edition restored.');
    } catch (error) {
      this.operationError =
        error instanceof Error ? error.message : 'Edition lifecycle change failed.';
      if (this.snapshot !== undefined) this.render(this.snapshot);
    }
  }

  /** Archives/restores through application services and retains any unrelated overview draft. */
  private async changeArchiveState(record: CatalogRecord): Promise<void> {
    this.operationError = undefined;
    try {
      if (record.archived) await this.books.restore(record.path);
      else await this.books.archive(record.path);
    } catch (error) {
      this.operationError =
        error instanceof Error ? error.message : 'Book lifecycle change failed.';
      if (this.snapshot !== undefined) this.render(this.snapshot);
    }
  }

  /** Opens canonical Markdown using Obsidian workspace APIs only. */
  private async openCanonicalNote(path: VaultPath): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Managed note is no longer available: ${path}`);
  }

  /** Resolves the human series label without making the title a relationship key. */
  private seriesLabel(record: CatalogRecord): string {
    const seriesId = record.fields['series-id'];
    if (typeof seriesId !== 'string') return 'Standalone book';
    const series = this.catalog.recordById(seriesId);
    if (typeof series?.fields.name !== 'string') return 'Series link requires repair';
    const position = record.fields['series-position'];
    return `${series.fields.name} · Book ${typeof position === 'number' ? String(position) : '—'}`;
  }

  /** Changes tabs without touching the shared draft store. */
  private selectTab(tab: WorkspaceTab): void {
    this.activeTab = tab;
    if (this.snapshot !== undefined) this.render(this.snapshot);
  }

  /** Implements wrapping arrow/home/end tab navigation and moves focus to the selected tab. */
  private handleTabKey(event: KeyboardEvent, tab: WorkspaceTab, tablist: HTMLElement): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = nextWorkspaceTab(tab, event.key as 'ArrowLeft' | 'ArrowRight' | 'End' | 'Home');
    this.selectTab(next);
    const target = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent?.toLowerCase() === next
    );
    window.setTimeout(() => target?.focus(), 0);
  }
}

/** Renders catalog lifecycle above retained partial content. */
function renderWorkspaceState(
  root: HTMLElement,
  state: Exclude<BookCatalogSnapshot['availability']['state'], 'ready'>,
  message?: string
): void {
  const panel = root.createDiv({
    cls: `pm-state-banner pm-state-banner--${state}`,
    attr: { role: state === 'error' || state === 'unavailable' ? 'alert' : 'status' }
  });
  panel.createEl('strong', { text: capitalize(state) });
  panel.createSpan({ text: message ?? 'Catalog state is changing.' });
}

/** Renders empty/unavailable workspace state with a route back to portfolio context. */
function renderNoBook(
  root: HTMLElement,
  snapshot: BookCatalogSnapshot,
  openDashboard: () => void
): void {
  const empty = root.createDiv({ cls: 'pm-empty-state' });
  const icon = empty.createDiv({ cls: 'pm-empty-state__icon' });
  setIcon(icon, snapshot.diagnostics.length > 0 ? 'stethoscope' : 'book-open');
  empty.createEl('h1', {
    text: snapshot.diagnostics.length > 0 ? 'No valid book available' : 'Choose or create a book'
  });
  empty.createEl('p', {
    text:
      snapshot.diagnostics.length > 0
        ? 'Return to the dashboard for catalog repair guidance.'
        : 'The Book Workspace opens after a valid book project exists.'
  });
  const button = empty.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Open dashboard',
    attr: { type: 'button' }
  });
  button.addEventListener('click', openDashboard);
}

/** Builds one header context cell with explicit availability detail. */
function renderContextItem(
  parent: HTMLElement,
  label: string,
  value: string,
  detail: string
): void {
  const item = parent.createDiv({ cls: 'pm-context-item' });
  item.createSpan({ text: label });
  item.createEl('strong', { text: value });
  item.createEl('small', { text: detail });
}

/** Creates one labelled text input and returns the native control for draft events. */
function createInputField(
  parent: HTMLElement,
  label: string,
  type: 'text',
  value: string
): HTMLInputElement {
  const wrapper = parent.createEl('label', { cls: 'pm-field' });
  wrapper.createSpan({ text: label });
  return wrapper.createEl('input', { type, value });
}

/** Replaces inline validation without rerendering controls or disturbing keyboard focus. */
function renderDraftValidation(parent: HTMLElement, draft: BookOverviewDraft): void {
  parent.empty();
  if (draft.diagnostics.length === 0) {
    parent.createSpan({ text: draft.dirty ? 'Ready to save.' : 'No unsaved changes.' });
    return;
  }
  parent.createEl('strong', { text: 'Fix these fields before saving:' });
  const list = parent.createEl('ul');
  for (const diagnostic of draft.diagnostics) list.createEl('li', { text: diagnostic.message });
}

/** Renders book-scoped diagnostic summary on Overview. */
function renderBookDiagnostics(
  parent: HTMLElement,
  record: CatalogRecord,
  allDiagnostics: readonly CatalogDiagnostic[]
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Diagnostics' });
  const diagnostics = diagnosticsFor(record, allDiagnostics);
  section.createEl('p', {
    text:
      diagnostics.length === 0
        ? '✓ No diagnostics for this book.'
        : `⚠ ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'} require attention.`
  });
}

/** Renders recent activity belonging to the selected stable identity. */
function renderBookActivity(
  parent: HTMLElement,
  record: CatalogRecord,
  snapshot: BookCatalogSnapshot
): void {
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h2', { text: 'Recent activity' });
  const activities = snapshot.recentActivity.filter(({ entityId }) => entityId === record.id);
  if (activities.length === 0) {
    section.createEl('p', { cls: 'pm-muted', text: 'No activity for this book in this session.' });
    return;
  }
  const list = section.createEl('ol', { cls: 'pm-activity-list' });
  for (const activity of activities.slice(0, 6)) {
    list.createEl('li', { text: `${activity.action} · ${activity.occurredAt}` });
  }
}

/** Includes path-level and stable-identity diagnostics for the selected book. */
function diagnosticsFor(
  record: CatalogRecord,
  diagnostics: readonly CatalogDiagnostic[]
): readonly CatalogDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.path === record.path || diagnostic.entityId === record.id
  );
}

/** Creates one consistent secondary action inside edition cards and subsections. */
function editionAction(parent: HTMLElement, text: string): HTMLButtonElement {
  return parent.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text,
    attr: { type: 'button' }
  });
}

/** Converts stable role/state vocabulary to visible labels without changing persisted values. */
function assetRoleLabel(value: string): string {
  return value
    .split('-')
    .map((part) => capitalize(part))
    .join(' ');
}

/** Human label retains stable revision and archive context without using a filename as identity. */
function editionRecordLabel(record: CatalogRecord): string {
  const type = record.fields.type as EditionType;
  const customType = record.fields['custom-type'];
  const label = editionTypeLabel({
    type,
    ...(typeof customType === 'string' ? { customType } : {})
  });
  return `${label} · Revision ${String(record.fields.revision)}`;
}

/** Adds one term/description pair to the edition fact grid. */
function editionFact(parent: HTMLDListElement, label: string, value: string): void {
  const item = parent.createDiv({ cls: 'pm-edition-fact' });
  item.createEl('dt', { text: label });
  item.createEl('dd', { text: value });
}

/** Makes missing or structured projection values explicit for assistive technology. */
function valueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (typeof value === 'object') return mapText(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return 'Unsupported value';
}

/** Renders text maps in stable key order and rejects malformed external shapes visibly. */
function mapText(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Not recorded';
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return entries.length === 0
    ? 'Not recorded'
    : entries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${key}: ${entry}`)
        .join('; ');
}

/** Displays complete trim evidence without silently converting persisted units. */
function trimText(record: CatalogRecord): string {
  const width = record.fields['trim-width'];
  const height = record.fields['trim-height'];
  const unit = record.fields['trim-unit'];
  return typeof width !== 'string' || typeof height !== 'string' || typeof unit !== 'string'
    ? 'Not recorded'
    : `${width} × ${height} ${unit}`;
}

/** Displays whole-minute audio duration with a human-readable unit. */
function durationText(value: unknown): string {
  return typeof value === 'number' ? `${value} minutes` : 'Not recorded';
}

/** Uppercases only the first character for human labels. */
function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1);
}

/** Narrows restored Obsidian state to a safe object before reading properties. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
