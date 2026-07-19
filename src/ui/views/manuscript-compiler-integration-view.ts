/** Native INT-C-001/002 capability status, request preview, and complete manual fallback surface. */
import { ItemView, Notice, setIcon, type Plugin, type WorkspaceLeaf } from 'obsidian';
import {
  COMPILER_EXPORT_FORMATS,
  type CompilerExportFormat,
  type CompilerResultState,
  type CompilerNegotiation,
  type CompilerRequestPreview,
  type ManuscriptCompilerIntegrationService
} from '../../application/integrations/manuscript-compiler-integration';
import type {
  CompilerOutputLinkPreview,
  EditionProjectService
} from '../../application/editions/edition-project-service';
import { ManualCancellationToken } from '../../domain/foundation/cancellation';
import type { BookCatalog } from '../../application/catalog/book-catalog';
import type { BookCatalogSnapshot } from '../../domain/catalog/catalog-model';
import { BOOK_WORKSPACE_VIEW_TYPE } from './book-workspace-view';

export const COMPILER_INTEGRATION_VIEW_TYPE = 'publishing-manager-compiler-integration';

export class ManuscriptCompilerIntegrationView extends ItemView {
  private unsubscribeCatalog: (() => void) | undefined;
  private unsubscribeResults: (() => void) | undefined;
  private snapshot: BookCatalogSnapshot | undefined;
  private negotiation: CompilerNegotiation | undefined;
  private bookId = '';
  private editionId = '';
  private readonly formats = new Set<CompilerExportFormat>();
  private preview: CompilerRequestPreview | undefined;
  private resultState: CompilerResultState = { results: [] };
  private linkPreview: CompilerOutputLinkPreview | undefined;
  private requestCancellation: ManualCancellationToken | undefined;
  private requestPending = false;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly catalog: BookCatalog,
    private readonly compiler: ManuscriptCompilerIntegrationService,
    private readonly editions: EditionProjectService
  ) {
    super(leaf);
    this.icon = 'package-open';
    this.navigation = true;
  }
  public getViewType(): string {
    return COMPILER_INTEGRATION_VIEW_TYPE;
  }
  public getDisplayText(): string {
    return 'Compiler integration';
  }
  protected override async onOpen(): Promise<void> {
    this.unsubscribeCatalog = this.catalog.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.reconcileScope();
      this.render();
    });
    this.unsubscribeResults = this.compiler.subscribeResults((state) => {
      this.resultState = state;
      this.render();
    });
    await this.refreshCapability();
  }
  protected override async onClose(): Promise<void> {
    this.unsubscribeCatalog?.();
    this.unsubscribeCatalog = undefined;
    this.unsubscribeResults?.();
    this.unsubscribeResults = undefined;
    this.contentEl.empty();
  }

  private async refreshCapability(): Promise<void> {
    try {
      this.negotiation = await this.compiler.negotiate();
    } catch (error) {
      this.negotiation = {
        state: 'absent',
        explanation: message(error, 'Capability discovery failed closed.')
      };
    }
    this.preview = undefined;
    this.render();
  }

  private reconcileScope(): void {
    const snapshot = this.snapshot;
    if (snapshot === undefined) return;
    const books = snapshot.books.filter(({ archived }) => !archived);
    if (!books.some(({ id }) => id === this.bookId)) this.bookId = books[0]?.id ?? '';
    const editions = snapshot.editions.filter(
      ({ archived, fields }) => !archived && fields['book-id'] === this.bookId
    );
    if (!editions.some(({ id }) => id === this.editionId)) this.editionId = editions[0]?.id ?? '';
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('publishing-manager', 'pm-compiler-integration');
    const header = root.createDiv({ cls: 'pm-page-header' });
    const titles = header.createDiv({ cls: 'pm-page-header__titles' });
    titles.createEl('p', { cls: 'pm-eyebrow', text: 'Optional local capability' });
    titles.createEl('h1', { text: 'Manuscript Compiler' });
    titles.createEl('p', {
      cls: 'pm-page-subtitle',
      text: 'Request compilation through a versioned local contract. Publishing Manager never compiles internally.'
    });
    const actions = header.createDiv({ cls: 'pm-action-row' });
    control(actions, 'Refresh capability', 'refresh-cw', () => void this.refreshCapability());
    this.renderCapability(root);
    this.renderRequest(root);
    this.renderResults(root);
  }

  private renderCapability(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Capability negotiation' });
    const state = this.negotiation;
    if (state === undefined) {
      panel.createEl('p', { text: 'Checking for an explicit v1 capability…' });
      return;
    }
    panel.createEl('p', {
      text: `${symbol(state.state)} ${sentence(state.state)} — ${state.explanation}`
    });
    if (state.state === 'incompatible') {
      const list = panel.createEl('ul');
      for (const reason of state.reasons) list.createEl('li', { text: reason });
    }
    if (state.state !== 'compatible') {
      panel.createEl('p', {
        cls: 'pm-muted',
        text: 'Installing or enabling a plugin is not enough: it must explicitly publish the compatible contract. Publishing Manager does not inspect private plugin APIs.'
      });
      return;
    }
    panel.createEl('p', {
      text: `Provider: ${state.descriptor.providerId} ${state.descriptor.providerVersion} · Contract v${state.descriptor.contractVersion} · Delivery: ${state.descriptor.deliveryMode}`
    });
    panel.createEl('p', { text: `Formats: ${state.descriptor.supportedFormats.join(', ')}` });
    const disclosure = panel.createEl('details');
    disclosure.createEl('summary', { text: 'Exchanged field groups' });
    const list = disclosure.createEl('ul');
    for (const field of state.exchangedFields) list.createEl('li', { text: field });
    control(
      panel,
      state.enabled ? 'Disable compiler capability' : 'Enable compiler capability',
      state.enabled ? 'unplug' : 'plug',
      () => {
        void this.compiler
          .setEnabled(!state.enabled)
          .then(() => this.refreshCapability())
          .catch(
            (error: unknown) =>
              new Notice(message(error, 'Capability preference could not be saved.'))
          );
      }
    );
  }

  private renderRequest(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Request an export' });
    panel.createEl('p', {
      text: 'Choose stable project scope and output formats, inspect the exact local payload, then send one correlation-ID request. Manuscript text, paths, private notes, assets, and credentials are never included.'
    });
    const snapshot = this.snapshot;
    if (snapshot === undefined || snapshot.books.length === 0) {
      panel.createEl('p', {
        cls: 'pm-muted',
        text: 'Create an active book and edition before requesting an export.'
      });
      return;
    }
    const bookSelect = select(
      panel,
      'Book',
      snapshot.books
        .filter(({ archived }) => !archived)
        .map((book) => [book.id, String(book.fields.title)] as const),
      this.bookId
    );
    bookSelect.addEventListener('change', () => {
      this.bookId = bookSelect.value;
      this.editionId = '';
      this.preview = undefined;
      this.reconcileScope();
      this.render();
    });
    const editions = snapshot.editions.filter(
      ({ archived, fields }) => !archived && fields['book-id'] === this.bookId
    );
    const editionSelect = select(
      panel,
      'Edition',
      editions.map(
        (edition) =>
          [
            edition.id,
            `${String(edition.fields.type)} · revision ${String(edition.fields.revision)}`
          ] as const
      ),
      this.editionId
    );
    editionSelect.addEventListener('change', () => {
      this.editionId = editionSelect.value;
      this.preview = undefined;
    });
    const fieldset = panel.createEl('fieldset');
    fieldset.createEl('legend', { text: 'Requested output formats' });
    const supported =
      this.negotiation?.state === 'compatible'
        ? this.negotiation.descriptor.supportedFormats
        : COMPILER_EXPORT_FORMATS;
    for (const format of COMPILER_EXPORT_FORMATS) {
      const label = fieldset.createEl('label', { cls: 'pm-checkbox-row' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.formats.has(format);
      checkbox.disabled = !supported.includes(format);
      label.createSpan({ text: format.toUpperCase() });
      checkbox.addEventListener('change', () => {
        checkbox.checked ? this.formats.add(format) : this.formats.delete(format);
        this.preview = undefined;
      });
    }
    const requestEnabled = this.negotiation?.state === 'compatible' && this.negotiation.enabled;
    const preview = control(
      panel,
      'Preview compiler request',
      'file-search',
      () => void this.previewRequest()
    );
    preview.disabled = !requestEnabled || this.editionId.length === 0;
    const fallback = control(
      panel,
      'Open manual asset linking',
      'paperclip',
      () => void this.openManualFallback()
    );
    fallback.disabled = this.bookId.length === 0;
    panel.createEl('p', {
      cls: 'pm-muted',
      text: 'Manual asset linking is a complete core workflow and remains available when the compiler is absent, disabled, incompatible, declined, or later interrupted.'
    });
    this.renderPreview(panel);
  }

  private async previewRequest(): Promise<void> {
    try {
      this.preview = await this.compiler.previewRequest({
        bookId: this.bookId,
        editionId: this.editionId,
        formats: [...this.formats]
      });
      this.render();
    } catch (error) {
      new Notice(message(error, 'Compiler request preview failed.'));
    }
  }

  private renderPreview(panel: HTMLElement): void {
    const preview = this.preview;
    if (preview === undefined) return;
    const box = panel.createEl('details', { attr: { open: 'open' } });
    box.createEl('summary', { text: 'Reviewed local request' });
    box.createEl('p', {
      text: `Provider: ${preview.providerId} ${preview.providerVersion} · ${preview.byteCount} bytes · Correlation: ${preview.request.correlationId}`
    });
    const list = box.createEl('ul');
    for (const consequence of preview.consequences) list.createEl('li', { text: consequence });
    box.createEl('pre').createEl('code', { text: JSON.stringify(preview.request, null, 2) });
    if (this.requestPending) {
      control(box, 'Cancel pending request', 'x-circle', () => this.requestCancellation?.cancel());
    } else {
      control(box, 'Send this local request', 'send', () => void this.sendRequest(preview));
    }
  }

  private async sendRequest(preview: CompilerRequestPreview): Promise<void> {
    this.requestPending = true;
    this.requestCancellation = new ManualCancellationToken();
    this.render();
    try {
      const acknowledgement = await this.compiler.applyRequest(preview, {
        timeoutMilliseconds: 10_000,
        cancellation: this.requestCancellation
      });
      this.preview = undefined;
      new Notice(
        acknowledgement.state === 'accepted'
          ? acknowledgement.message
          : `Compiler declined: ${acknowledgement.reason}`
      );
    } catch (error) {
      new Notice(message(error, 'Compiler request stopped.'));
    } finally {
      this.requestPending = false;
      this.requestCancellation = undefined;
      this.render();
    }
  }

  private async openManualFallback(): Promise<void> {
    const book = this.snapshot?.books.find(({ id }) => id === this.bookId);
    if (book === undefined) return;
    const leaf =
      this.app.workspace.getLeavesOfType(BOOK_WORKSPACE_VIEW_TYPE)[0] ??
      this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: BOOK_WORKSPACE_VIEW_TYPE,
      active: true,
      state: { bookPath: book.path, tab: 'assets' }
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Shows validated provider evidence without updating canonical format or asset records yet. */
  private renderResults(root: HTMLElement): void {
    const panel = root.createEl('section', { cls: 'pm-panel' });
    panel.createEl('h2', { text: 'Validated compiler results' });
    panel.createEl('p', {
      text: 'These are session-only result records. Current or stale is fingerprint evidence, not byte inspection, and linked formats are unchanged until the next validation stage.'
    });
    if (this.resultState.lastRejected !== undefined) {
      panel.createEl('p', {
        cls: 'pm-notice pm-notice--warning',
        text: `Last result rejected — ${this.resultState.lastRejected}`
      });
    }
    const scoped = this.resultState.results.filter(
      ({ result }) => this.bookId.length === 0 || result.bookId === this.bookId
    );
    if (scoped.length === 0) {
      panel.createEl('p', {
        cls: 'pm-muted',
        text: 'No validated result evidence has been received in this plugin session.'
      });
      return;
    }
    for (const evidence of scoped) {
      const details = panel.createEl('details');
      details.createEl('summary', {
        text: `${evidence.freshness === 'current' ? '✓ Current' : '⚠ Stale'} · ${evidence.result.format.toUpperCase()} · ${evidence.result.vaultPath}`
      });
      details.createEl('p', { text: evidence.freshnessExplanation });
      const list = details.createEl('ul');
      for (const line of [
        `Compiler: ${evidence.result.providerId} ${evidence.result.compilerVersion}`,
        `Compiled: ${evidence.result.compiledAt}`,
        `Semantic fingerprint: ${evidence.result.semanticFingerprint}`,
        `Recorded source fingerprint: ${evidence.result.sourceFingerprint}`,
        `Output fingerprint: ${evidence.result.outputFingerprint}`,
        `History ID: ${evidence.result.historyId}`,
        `Correlation ID: ${evidence.result.correlationId}`
      ])
        list.createEl('li', { text: line });
      if (evidence.result.warnings.length > 0) {
        details.createEl('h3', { text: 'Compiler warnings' });
        const warnings = details.createEl('ul');
        for (const warning of evidence.result.warnings) warnings.createEl('li', { text: warning });
      }
      const formats = this.snapshot?.formats.filter(
        ({ archived, fields }) =>
          !archived &&
          fields['edition-id'] === evidence.result.editionId &&
          (fields.kind === evidence.result.format ||
            (evidence.result.format === 'markdown' && fields.kind === 'md'))
      );
      if (formats === undefined || formats.length === 0) {
        details.createEl('p', {
          cls: 'pm-muted',
          text: 'Create a matching format record before linking this validated output.'
        });
      } else {
        const target = select(
          details,
          'Format record target',
          formats.map((format) => [format.id, String(format.fields.label ?? format.fields.kind)]),
          formats[0]!.id
        );
        control(details, 'Preview format link', 'link', () => {
          void this.previewResultLink(evidence, target.value);
        });
      }
    }
    this.renderLinkPreview(panel);
  }

  private async previewResultLink(
    evidence: CompilerResultState['results'][number],
    formatId: string
  ): Promise<void> {
    try {
      this.linkPreview = await this.editions.previewCompilerOutputLink({
        formatId,
        editionId: evidence.result.editionId,
        compilerFormat: evidence.result.format,
        vaultPath: evidence.result.vaultPath,
        providerId: evidence.result.providerId,
        compilerVersion: evidence.result.compilerVersion,
        compiledAt: evidence.result.compiledAt,
        semanticFingerprint: evidence.result.semanticFingerprint,
        sourceFingerprint: evidence.result.sourceFingerprint,
        outputFingerprint: evidence.result.outputFingerprint,
        historyId: evidence.result.historyId,
        correlationId: evidence.result.correlationId,
        freshness: evidence.freshness
      });
      this.render();
    } catch (error) {
      new Notice(message(error, 'Compiler output link preview failed.'));
    }
  }

  private renderLinkPreview(panel: HTMLElement): void {
    const preview = this.linkPreview;
    if (preview === undefined) return;
    const box = panel.createEl('details', { attr: { open: 'open' } });
    box.createEl('summary', { text: 'Reviewed canonical format link' });
    box.createEl('p', {
      text: `Format: ${preview.formatId} · Before: ${preview.previousFilePath ?? 'No file'} · After: ${preview.proposedFilePath}`
    });
    const consequences = box.createEl('ul');
    for (const consequence of preview.consequences)
      consequences.createEl('li', { text: consequence });
    box.createEl('pre').createEl('code', {
      text: JSON.stringify(
        { 'file-path': preview.proposedFilePath, metadata: preview.proposedMetadata },
        null,
        2
      )
    });
    control(box, 'Apply reviewed format link', 'check', () => {
      void this.editions
        .applyCompilerOutputLink(preview)
        .then(() => {
          this.linkPreview = undefined;
          this.render();
          new Notice('Validated compiler output linked to the format.');
        })
        .catch((error: unknown) => new Notice(message(error, 'Format link stopped.')));
    });
  }
}

export function registerManuscriptCompilerIntegrationView(
  plugin: Plugin,
  catalog: BookCatalog,
  compiler: ManuscriptCompilerIntegrationService,
  editions: EditionProjectService
): void {
  const open = async (): Promise<void> => {
    const leaf =
      plugin.app.workspace.getLeavesOfType(COMPILER_INTEGRATION_VIEW_TYPE)[0] ??
      plugin.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: COMPILER_INTEGRATION_VIEW_TYPE, active: true });
    await plugin.app.workspace.revealLeaf(leaf);
  };
  plugin.registerView(
    COMPILER_INTEGRATION_VIEW_TYPE,
    (leaf) => new ManuscriptCompilerIntegrationView(leaf, catalog, compiler, editions)
  );
  plugin.addRibbonIcon('package-open', 'Open Manuscript Compiler integration', () => void open());
  plugin.addCommand({
    id: 'open-compiler-integration',
    name: 'Open Manuscript Compiler integration',
    callback: () => void open()
  });
  plugin.register(() => plugin.app.workspace.detachLeavesOfType(COMPILER_INTEGRATION_VIEW_TYPE));
}

function select(
  parent: HTMLElement,
  labelText: string,
  options: readonly (readonly [string, string])[],
  value: string
): HTMLSelectElement {
  const label = parent.createEl('label');
  label.createSpan({ text: labelText });
  const input = label.createEl('select');
  for (const [key, text] of options) input.createEl('option', { value: key, text });
  input.value = value;
  return input;
}
function control(
  parent: HTMLElement,
  text: string,
  icon: string,
  action: () => void
): HTMLButtonElement {
  const button = parent.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    attr: { type: 'button' }
  });
  const iconEl = button.createSpan({ cls: 'pm-button__icon' });
  setIcon(iconEl, icon);
  button.createSpan({ text });
  button.addEventListener('click', action);
  return button;
}
function sentence(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
function symbol(state: string): string {
  return state === 'compatible'
    ? '✓'
    : state === 'incompatible' || state === 'ambiguous'
      ? '⚠'
      : 'ⓘ';
}
function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
