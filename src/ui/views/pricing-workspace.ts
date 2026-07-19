/**
 * Renders PRC-004/PRC-005/PRC-007 as an accessible book pricing surface. Exact values and warning
 * text remain available in both the desktop matrix and mobile cards; no behavior depends on color,
 * drag-and-drop, live exchange rates, or a retailer connection.
 */

import { Notice } from 'obsidian';

import type {
  PriceInput,
  PricePreview,
  PriceProjectService,
  PriceSeedPreview,
  SeedTarget
} from '../../application/pricing/price-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import { PRICE_HEURISTIC_DISCLOSURE } from '../../domain/pricing/price-record';

export interface PricingWorkspaceState {
  draft: PriceDraft;
  preview?: PricePreview;
  revisionSourceId?: string;
  seedSourceId?: string;
  seedText: string;
  seedPreview?: PriceSeedPreview;
}

interface PriceDraft {
  editionId: string;
  platform: string;
  territory: string;
  currency: string;
  amount: string;
  taxIncluded: boolean;
  taxRate: string;
  effectiveFrom: string;
  effectiveTo: string;
  source: string;
  notes: string;
  printCost: string;
}

export function createPricingWorkspaceState(): PricingWorkspaceState {
  return {
    draft: emptyDraft(),
    seedText: ''
  };
}

export function renderPricingWorkspace(context: {
  readonly parent: HTMLElement;
  readonly book: CatalogRecord;
  readonly snapshot: BookCatalogSnapshot;
  readonly prices: PriceProjectService;
  readonly state: PricingWorkspaceState;
  readonly rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-pricing-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Effective-dated local price records' });
  title.createEl('h2', { text: 'Pricing' });
  title.createEl('p', { text: PRICE_HEURISTIC_DISCLOSURE });
  renderPreview(page, context);
  renderEditor(page, context);
  renderSeed(page, context);
  renderMatrix(page, context);
}

function renderEditor(
  parent: HTMLElement,
  context: Parameters<typeof renderPricingWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel', attr: { open: 'true' } });
  details.createEl('summary', {
    text:
      context.state.revisionSourceId === undefined ? 'Add price snapshot' : 'Revise price snapshot'
  });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const editions = context.snapshot.editions.filter(
    (edition) => edition.fields['book-id'] === context.book.id
  );
  const edition = form.createEl('select', { attr: { 'aria-label': 'Price edition' } });
  edition.createEl('option', { value: '', text: 'Choose edition' });
  for (const record of editions)
    edition.createEl('option', {
      value: record.id,
      text: `${String(record.fields.type)} · revision ${String(record.fields.revision)}`,
      attr: record.id === context.state.draft.editionId ? { selected: 'true' } : {}
    });
  bindSelect(edition, (value) => (context.state.draft.editionId = value));
  for (const field of [
    ['platform', 'Platform or marketplace'],
    ['territory', 'Territory (GB)'],
    ['currency', 'Currency (GBP)'],
    ['amount', 'List price'],
    ['taxRate', 'Tax rate percent (optional)'],
    ['effectiveFrom', 'Effective from (YYYY-MM-DD)'],
    ['effectiveTo', 'Effective to (optional)'],
    ['source', 'Source'],
    ['printCost', 'Print cost (optional)'],
    ['notes', 'Notes (optional)']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state.draft[field[0]],
      attr: { type: 'text', placeholder: field[1], 'aria-label': field[1] }
    });
    input.addEventListener('input', () => (context.state.draft[field[0]] = input.value));
  }
  const tax = form.createEl('label');
  const checkbox = tax.createEl('input', { attr: { type: 'checkbox' } });
  checkbox.checked = context.state.draft.taxIncluded;
  tax.appendText(' Tax included');
  checkbox.addEventListener('change', () => (context.state.draft.taxIncluded = checkbox.checked));
  const button = form.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Preview price',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const input = toInput(context.state.draft);
      context.state.preview =
        context.state.revisionSourceId === undefined
          ? context.prices.previewCreate(input)
          : context.prices.previewRevision(context.state.revisionSourceId, input);
      context.rerender();
    } catch (cause) {
      new Notice(errorMessage(cause));
      button.disabled = false;
    }
  });
}

function renderPreview(
  parent: HTMLElement,
  context: Parameters<typeof renderPricingWorkspace>[0]
): void {
  const preview = context.state.preview;
  if (preview === undefined) return;
  const panel = parent.createEl('section', { cls: 'pm-panel pm-inline-alert' });
  panel.createEl('h3', { text: 'Review price snapshot' });
  panel.createEl('p', { text: preview.disclosure });
  for (const diagnostic of preview.diagnostics)
    panel.createEl('p', { text: `${diagnostic.severity.toUpperCase()}: ${diagnostic.message}` });
  panel.createEl('pre', { text: JSON.stringify(preview.fields, null, 2) });
  const actions = panel.createDiv({ cls: 'pm-action-row' });
  const apply = actions.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Apply reviewed price',
    attr: { type: 'button' }
  });
  apply.disabled = preview.diagnostics.some(({ severity }) => severity === 'error');
  apply.addEventListener('click', () => {
    apply.disabled = true;
    void context.prices
      .apply(preview)
      .then(() => {
        new Notice('Price snapshot created.');
        context.state.draft = emptyDraft();
        delete context.state.preview;
        delete context.state.revisionSourceId;
        context.rerender();
      })
      .catch((cause: unknown) => {
        new Notice(errorMessage(cause));
        apply.disabled = false;
      });
  });
  const cancel = actions.createEl('button', {
    cls: 'pm-button',
    text: 'Cancel',
    attr: { type: 'button' }
  });
  cancel.addEventListener('click', () => {
    delete context.state.preview;
    context.rerender();
  });
}

function renderSeed(
  parent: HTMLElement,
  context: Parameters<typeof renderPricingWorkspace>[0]
): void {
  const prices = context.prices.forBook(context.book.id);
  if (prices.length === 0) return;
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Seed markets from a reviewed price' });
  details.createEl('p', {
    text: 'One target per line: territory | currency | local rate | rate date | rate source | optional ending. No network rate is fetched.'
  });
  const source = details.createEl('select', { attr: { 'aria-label': 'Seed source price' } });
  source.createEl('option', { value: '', text: 'Choose source price' });
  for (const record of prices)
    source.createEl('option', { value: record.id, text: priceLabel(record) });
  bindSelect(source, (value) => {
    if (value) context.state.seedSourceId = value;
    else delete context.state.seedSourceId;
  });
  const text = details.createEl('textarea', {
    text: context.state.seedText,
    attr: {
      rows: '5',
      placeholder: 'SE | SEK | 10.25 | 2026-07-19 | Local planning assumption | 9'
    }
  });
  text.addEventListener('input', () => (context.state.seedText = text.value));
  const preview = details.createEl('button', {
    cls: 'pm-button',
    text: 'Preview seeded prices',
    attr: { type: 'button' }
  });
  preview.addEventListener('click', () => {
    try {
      if (!context.state.seedSourceId) throw new Error('Choose a source price.');
      context.state.seedPreview = context.prices.previewSeed(
        context.state.seedSourceId,
        parseSeedTargets(text.value)
      );
      context.rerender();
    } catch (cause) {
      new Notice(errorMessage(cause));
    }
  });
  if (context.state.seedPreview === undefined) return;
  for (const row of context.state.seedPreview.rows) {
    const card = details.createDiv({ cls: 'pm-price-card' });
    card.createEl('strong', {
      text: `${String(row.fields.territory)} · ${String(row.fields.currency)} ${String(row.fields.amount)}`
    });
    for (const issue of row.diagnostics)
      card.createEl('p', { text: `${issue.severity}: ${issue.message}` });
    const apply = card.createEl('button', {
      cls: 'pm-button',
      text: 'Apply this seeded price',
      attr: { type: 'button' }
    });
    apply.disabled = row.diagnostics.some(({ severity }) => severity === 'error');
    apply.addEventListener(
      'click',
      () =>
        void context.prices
          .apply(row)
          .then(() => context.rerender())
          .catch((cause: unknown) => new Notice(errorMessage(cause)))
    );
  }
}

function renderMatrix(
  parent: HTMLElement,
  context: Parameters<typeof renderPricingWorkspace>[0]
): void {
  const records = context.prices.forBook(context.book.id);
  const panel = parent.createEl('section', { cls: 'pm-panel' });
  panel.createEl('h3', { text: `Territory and currency matrix · ${records.length}` });
  if (records.length === 0) {
    panel.createEl('p', { text: 'No prices for this book.' });
    return;
  }
  const table = panel.createEl('table', { cls: 'pm-price-table' });
  const head = table.createEl('thead').createEl('tr');
  for (const label of [
    'Edition',
    'Platform',
    'Territory',
    'Price',
    'Tax',
    'Effective',
    'History',
    'Action'
  ])
    head.createEl('th', { text: label });
  const body = table.createEl('tbody');
  const cards = panel.createDiv({ cls: 'pm-price-cards' });
  for (const record of records) {
    const values = rowValues(record, context.prices.history(record).length);
    const tr = body.createEl('tr');
    for (const value of values) tr.createEl('td', { text: value });
    const action = tr.createEl('td');
    actionButton(action, context, record);
    const card = cards.createEl('article', { cls: 'pm-price-card' });
    card.createEl('strong', { text: priceLabel(record) });
    for (const value of values.slice(4)) card.createEl('p', { text: value });
    actionButton(card, context, record);
  }
}

function actionButton(
  parent: HTMLElement,
  context: Parameters<typeof renderPricingWorkspace>[0],
  record: CatalogRecord
): void {
  const revise = parent.createEl('button', {
    cls: 'pm-text-button',
    text: 'Create revision',
    attr: { type: 'button' }
  });
  revise.addEventListener('click', () => {
    context.state.revisionSourceId = record.id;
    context.state.draft = draftFromRecord(record);
    delete context.state.preview;
    context.rerender();
  });
}

function toInput(draft: PriceDraft): PriceInput {
  return {
    editionId: draft.editionId,
    platform: draft.platform,
    territory: draft.territory,
    currency: draft.currency,
    amount: draft.amount,
    taxIncluded: draft.taxIncluded,
    effectiveFrom: draft.effectiveFrom,
    source: draft.source,
    ...(draft.taxRate ? { taxRate: draft.taxRate } : {}),
    ...(draft.effectiveTo ? { effectiveTo: draft.effectiveTo } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(draft.printCost ? { printCost: draft.printCost } : {})
  };
}
function emptyDraft(): PriceDraft {
  return {
    editionId: '',
    platform: '',
    territory: '',
    currency: '',
    amount: '',
    taxIncluded: false,
    taxRate: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
    source: '',
    notes: '',
    printCost: ''
  };
}
function draftFromRecord(record: CatalogRecord): PriceDraft {
  return {
    editionId: text(record, 'edition-id'),
    platform: text(record, 'platform'),
    territory: text(record, 'territory'),
    currency: text(record, 'currency'),
    amount: text(record, 'amount'),
    taxIncluded: record.fields['tax-included'] === true,
    taxRate: text(record, 'tax-rate'),
    effectiveFrom: '',
    effectiveTo: '',
    source: text(record, 'source'),
    notes: text(record, 'notes'),
    printCost: text(record, 'print-cost')
  };
}
function text(record: CatalogRecord, field: string): string {
  return typeof record.fields[field] === 'string' ? record.fields[field] : '';
}
function bindSelect(select: HTMLSelectElement, update: (value: string) => void): void {
  select.addEventListener('change', () => update(select.value));
}
function priceLabel(record: CatalogRecord): string {
  return `${text(record, 'territory')} · ${text(record, 'currency')} ${text(record, 'amount')} · ${text(record, 'platform')}`;
}
function rowValues(record: CatalogRecord, history: number): readonly string[] {
  return [
    text(record, 'edition-id'),
    text(record, 'platform'),
    text(record, 'territory'),
    `${text(record, 'currency')} ${text(record, 'amount')}`,
    record.fields['tax-included'] === true
      ? `Tax included${text(record, 'tax-rate') ? ` · ${text(record, 'tax-rate')}%` : ''}`
      : 'Tax excluded',
    `${text(record, 'effective-from')}${text(record, 'effective-to') ? ` to ${text(record, 'effective-to')}` : ' onward'}`,
    `${history} snapshot${history === 1 ? '' : 's'}`
  ];
}
function parseSeedTargets(value: string): readonly SeedTarget[] {
  return value
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      const [territory = '', currency = '', rate = '', rateDate = '', rateSource = '', ending] =
        line.split('|').map((part) => part.trim());
      if (!territory || !currency || !rate || !rateDate || !rateSource)
        throw new Error(
          `Seed row ${index + 1} requires territory, currency, rate, date, and source.`
        );
      return { territory, currency, rate, rateDate, rateSource, ...(ending ? { ending } : {}) };
    });
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Pricing operation failed.';
}
