/** Native SAL-002/SAL-009/SAL-011/SAL-012 direct entry, preview, analytics, and provenance UI. */
import { Notice } from 'obsidian';
import type {
  SalesEntryInput,
  SalesProjectService,
  SalesQuery
} from '../../application/sales/sales-project-service';
import type { BookCatalogSnapshot } from '../../domain/catalog/catalog-model';
import type { SalesPreview } from '../../domain/sales/sales-ledger';

export interface SalesWorkspaceState {
  sourceId: string;
  isbn: string;
  targetId: string;
  country: string;
  kind: 'transaction' | 'period-summary';
  startDate: string;
  endDate: string;
  units: string;
  returns: string;
  currency: string;
  gross: string;
  net: string;
  tax: string;
  fees: string;
  discounts: string;
  proceeds: string;
  externalReference: string;
  preview?: SalesPreview;
  acceptOverlap: boolean;
  filterStart: string;
  filterEnd: string;
  filterCountry: string;
  filterCurrency: string;
  filterSourceId: string;
  filterBookId: string;
  filterSeriesId: string;
  filterEditionId: string;
  filterIsbn: string;
  filterFormatId: string;
  filterPlatform: string;
  filterLocation: string;
}
export function createSalesWorkspaceState(): SalesWorkspaceState {
  return {
    sourceId: '',
    isbn: '',
    targetId: '',
    country: '',
    kind: 'transaction',
    startDate: '',
    endDate: '',
    units: '1',
    returns: '0',
    currency: '',
    gross: '',
    net: '',
    tax: '',
    fees: '',
    discounts: '',
    proceeds: '',
    externalReference: '',
    acceptOverlap: false,
    filterStart: '',
    filterEnd: '',
    filterCountry: '',
    filterCurrency: '',
    filterSourceId: '',
    filterBookId: '',
    filterSeriesId: '',
    filterEditionId: '',
    filterIsbn: '',
    filterFormatId: '',
    filterPlatform: '',
    filterLocation: ''
  };
}

export function renderSalesWorkspace(context: {
  parent: HTMLElement;
  sales: SalesProjectService;
  snapshot: BookCatalogSnapshot;
  state: SalesWorkspaceState;
  bookId?: string;
  rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-sales-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', {
    cls: 'pm-eyebrow',
    text: 'Local immutable ledger · no retailer connection'
  });
  title.createEl('h2', { text: 'Sales performance' });
  const record = heading.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Record sale',
    attr: { type: 'button' }
  });
  const formPanel = page.createEl('details', { cls: 'pm-panel' });
  formPanel.createEl('summary', { text: 'Record an individual sale or period summary' });
  record.addEventListener('click', () => {
    formPanel.open = true;
    formPanel.scrollIntoView({ block: 'start' });
  });
  if (context.sales.sources().length === 0) {
    formPanel.createEl('p', {
      text: 'Install local source presets before entry. Presets contain defaults only—never credentials, endpoints, scripts, or network behavior.'
    });
    const install = formPanel.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: 'Install local source presets',
      attr: { type: 'button' }
    });
    install.addEventListener(
      'click',
      () => void context.sales.installSourcePresets().then(context.rerender)
    );
  } else renderEntryForm(formPanel, context);
  renderAnalyticsFilters(page, context);
  renderAggregates(page, context);
}

function activeQuery(context: Parameters<typeof renderSalesWorkspace>[0]): SalesQuery {
  return {
    ...(context.bookId === undefined ? {} : { bookId: context.bookId }),
    ...(context.bookId === undefined && context.state.filterBookId
      ? { bookId: context.state.filterBookId }
      : {}),
    ...(context.state.filterSeriesId ? { seriesId: context.state.filterSeriesId } : {}),
    ...(context.state.filterEditionId ? { editionId: context.state.filterEditionId } : {}),
    ...(context.state.filterIsbn ? { isbn: context.state.filterIsbn } : {}),
    ...(context.state.filterFormatId ? { formatId: context.state.filterFormatId } : {}),
    ...(context.state.filterPlatform ? { platform: context.state.filterPlatform } : {}),
    ...(context.state.filterLocation ? { publicationLocation: context.state.filterLocation } : {}),
    ...(context.state.filterStart ? { startDate: context.state.filterStart } : {}),
    ...(context.state.filterEnd ? { endDate: context.state.filterEnd } : {}),
    ...(context.state.filterCountry ? { country: context.state.filterCountry } : {}),
    ...(context.state.filterCurrency ? { currency: context.state.filterCurrency } : {}),
    ...(context.state.filterSourceId ? { sourceId: context.state.filterSourceId } : {})
  };
}

function renderAnalyticsFilters(
  parent: HTMLElement,
  context: Parameters<typeof renderSalesWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel' });
  details.createEl('summary', { text: 'Sales filters and attributed performance' });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  for (const [key, label, type] of [
    ['filterStart', 'Period begins', 'date'],
    ['filterEnd', 'Period ends', 'date'],
    ['filterCountry', 'Country', 'text'],
    ['filterCurrency', 'Currency', 'text']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state[key],
      attr: { type, placeholder: label, 'aria-label': label }
    });
    input.addEventListener('change', () => {
      context.state[key] = input.value;
      context.rerender();
    });
  }
  const source = select(
    form,
    'All sales sources',
    context.sales.sources().map((item) => [item.id, String(item.fields.label)])
  );
  source.value = context.state.filterSourceId;
  source.addEventListener('change', () => {
    context.state.filterSourceId = source.value;
    context.rerender();
  });
  const selectFilters: readonly [SalesFilterSelectKey, string, readonly CatalogRecordOption[]][] = [
    [
      'filterBookId',
      context.bookId === undefined ? 'All books' : 'This book',
      context.snapshot.books.map((item) => [item.id, String(item.fields.title)])
    ],
    [
      'filterEditionId',
      'All editions',
      context.snapshot.editions.map((item) => [item.id, String(item.fields.type)])
    ],
    [
      'filterFormatId',
      'All formats',
      context.snapshot.formats.map((item) => [
        item.id,
        typeof item.fields.type === 'string' ? item.fields.type : item.id
      ])
    ]
  ];
  for (const [key, label, options] of selectFilters) {
    const control = select(form, label, options);
    control.value = String(context.state[key]);
    control.disabled = key === 'filterBookId' && context.bookId !== undefined;
    control.addEventListener('change', () => {
      context.state[key] = control.value;
      context.rerender();
    });
  }
  for (const [key, label] of [
    ['filterSeriesId', 'Series stable ID'],
    ['filterIsbn', 'ISBN'],
    ['filterPlatform', 'Platform'],
    ['filterLocation', 'Publication location']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state[key],
      attr: { type: 'text', placeholder: label, 'aria-label': label }
    });
    input.addEventListener('change', () => {
      context.state[key] = input.value;
      context.rerender();
    });
  }
  const analytics = context.sales.analytics(activeQuery(context));
  details.createEl('p', {
    text: `${analytics.units} units · ${analytics.returns} returns · ${analytics.units - analytics.returns} net units · ${analytics.lines.length} contributing lines`
  });
  const grid = details.createDiv({ cls: 'pm-sales-grid' });
  for (const [title, rows] of [
    ['Monthly trend', analytics.trend],
    ['Top books', analytics.books],
    ['Platform / publication-location mix', analytics.locations],
    ['Country mix', analytics.countries]
  ] as const) {
    const card = grid.createEl('section', { cls: 'pm-panel' });
    card.createEl('h3', { text: title });
    const list = card.createEl('ol');
    for (const [label, units] of rows)
      list.createEl('li', { text: `${label} · ${units} net units` });
    if (!rows.length) card.createEl('p', { cls: 'pm-muted', text: 'No matching evidence.' });
  }
}

function renderEntryForm(
  parent: HTMLElement,
  context: Parameters<typeof renderSalesWorkspace>[0]
): void {
  const form = parent.createEl('form', { cls: 'pm-form-grid' });
  const source = select(
    form,
    'Sales source',
    context.sales.sources().map((item) => [item.id, String(item.fields.label)])
  );
  source.value = context.state.sourceId;
  source.addEventListener('change', () => {
    context.state.sourceId = source.value;
    clearPreview(context.state);
  });
  const editions =
    context.bookId === undefined
      ? context.snapshot.editions
      : context.snapshot.editions.filter((item) => item.fields['book-id'] === context.bookId);
  const editionIds = new Set(editions.map(({ id }) => id));
  const isbns = context.snapshot.isbns.filter(
    (item) =>
      editionIds.has(String(item.fields['edition-id'])) &&
      ['assigned', 'published'].includes(String(item.fields.status))
  );
  const isbn = select(
    form,
    'Assigned ISBN',
    isbns.map((item) => [String(item.fields.value), String(item.fields.value)])
  );
  isbn.value = context.state.isbn;
  isbn.addEventListener('change', () => {
    context.state.isbn = isbn.value;
    clearPreview(context.state);
  });
  const targets = context.snapshot.platformTargets.filter((item) =>
    editionIds.has(String(item.fields['edition-id']))
  );
  const target = select(
    form,
    'Publication location',
    targets.map((item) => [
      item.id,
      `${String(item.fields.platform)} · ${String(item.fields['publication-location'])} · ${String(item.fields.territory)}`
    ])
  );
  target.value = context.state.targetId;
  target.addEventListener('change', () => {
    context.state.targetId = target.value;
    clearPreview(context.state);
  });
  const kind = select(form, 'Entry kind', [
    ['transaction', 'Individual transaction'],
    ['period-summary', 'Period summary']
  ]);
  kind.value = context.state.kind;
  kind.addEventListener('change', () => {
    context.state.kind = kind.value as SalesWorkspaceState['kind'];
    clearPreview(context.state);
  });
  for (const [key, label, type] of [
    ['country', 'Sale country (GB)', 'text'],
    ['startDate', 'Sale/period start', 'date'],
    ['endDate', 'Sale/period end', 'date'],
    ['units', 'Units', 'number'],
    ['returns', 'Returns', 'number'],
    ['currency', 'Currency (GBP)', 'text'],
    ['gross', 'Gross revenue', 'text'],
    ['net', 'Net revenue', 'text'],
    ['tax', 'Tax', 'text'],
    ['fees', 'Fees', 'text'],
    ['discounts', 'Discounts', 'text'],
    ['proceeds', 'Reported proceeds / royalty', 'text'],
    ['externalReference', 'Optional external reference', 'text']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state[key],
      attr: { type, placeholder: label, 'aria-label': label }
    });
    input.addEventListener('input', () => {
      context.state[key] = input.value;
      clearPreview(context.state);
    });
  }
  const preview = form.createEl('button', {
    cls: 'pm-button pm-button--secondary',
    text: 'Preview sale',
    attr: { type: 'button' }
  });
  preview.addEventListener('click', () => {
    try {
      context.state.preview = context.sales.preview(entryInput(context.state));
      context.rerender();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : 'Sale preview failed.');
    }
  });
  if (context.state.preview !== undefined) {
    const review = parent.createEl('section', { cls: 'pm-inline-alert' });
    review.createEl('strong', {
      text: context.state.preview.exactDuplicateIds.length
        ? 'Exact duplicate — cannot save'
        : context.state.preview.overlappingIds.length
          ? 'Overlapping coverage'
          : 'Ready to record'
    });
    review.createEl('pre', {
      text: JSON.stringify(
        {
          attribution: context.state.preview.normalized,
          entryKey: context.state.preview.entryKey,
          warnings: context.state.preview.warnings
        },
        null,
        2
      )
    });
    if (context.state.preview.overlappingIds.length) {
      const label = review.createEl('label');
      const accept = label.createEl('input', { attr: { type: 'checkbox' } });
      accept.checked = context.state.acceptOverlap;
      label.appendText(' I reviewed the overlap and intend both entries to count.');
      accept.addEventListener('change', () => {
        context.state.acceptOverlap = accept.checked;
      });
    }
    const save = review.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Record accepted sale',
      attr: { type: 'button' }
    });
    save.disabled =
      context.state.preview.exactDuplicateIds.length > 0 ||
      (context.state.preview.overlappingIds.length > 0 && !context.state.acceptOverlap);
    save.addEventListener(
      'click',
      () =>
        void context.sales
          .record(entryInput(context.state), context.state.acceptOverlap)
          .then(() => {
            Object.assign(context.state, createSalesWorkspaceState());
            context.rerender();
          })
          .catch(
            (cause: unknown) =>
              new Notice(cause instanceof Error ? cause.message : 'Sale could not be recorded.')
          )
    );
  }
}

function renderAggregates(
  parent: HTMLElement,
  context: Parameters<typeof renderSalesWorkspace>[0]
): void {
  const groups = context.sales.aggregates(activeQuery(context));
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `Currency-safe totals · ${groups.length} currencies` });
  if (!groups.length) {
    section.createEl('p', {
      cls: 'pm-muted',
      text: 'No accepted local sales lines match this view.'
    });
    return;
  }
  const grid = section.createDiv({ cls: 'pm-sales-grid' });
  for (const group of groups) {
    const card = grid.createEl('details', { cls: 'pm-panel' });
    card.createEl('summary', {
      text: `${group.currency} · ${group.netUnits} net units · proceeds ${group.proceeds ?? '—'}`
    });
    card.createEl('p', {
      text: `Units ${group.units} · returns ${group.returns} · gross ${group.grossRevenue ?? '—'} · net ${group.netRevenue ?? '—'}`
    });
    const lines = card.createEl('ol');
    for (const line of group.lines) {
      const row = lines.createEl('li');
      row.createEl('strong', {
        text: `${String(line.fields['start-date'])}–${String(line.fields['end-date'])} · ${String(line.fields.country)} · ${String(line.fields['net-units'])} net`
      });
      row.createEl('p', {
        text: `ISBN ${String(line.fields['isbn-id'])} · target ${String(line.fields['platform-target-id'])} · source ${String(line.fields['source-id'])} · ${context.sales.corrections(line.id).length} corrections`
      });
      const details = row.createEl('details');
      details.createEl('summary', { text: 'Provenance and correction' });
      details.createEl('pre', {
        text: JSON.stringify(
          { provenance: line.fields.provenance, sourceValues: line.fields['source-values'] },
          null,
          2
        )
      });
      const form = details.createEl('form', { cls: 'pm-form-grid' });
      const reason = form.createEl('input', {
        attr: { type: 'text', placeholder: 'Correction reason', 'aria-label': 'Correction reason' }
      });
      const owner = form.createEl('input', {
        attr: { type: 'text', placeholder: 'Owner label', 'aria-label': 'Correction owner' }
      });
      const units = form.createEl('input', {
        attr: { type: 'number', placeholder: 'Unit adjustment', 'aria-label': 'Unit adjustment' }
      });
      form.createEl('button', {
        cls: 'pm-button pm-button--secondary',
        text: 'Record correction',
        attr: { type: 'submit' }
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void context.sales
          .correct({
            lineId: line.id,
            kind: 'correction',
            reason: reason.value,
            ownerLabel: owner.value,
            adjustment: { units: Number(units.value || 0) }
          })
          .then(context.rerender);
      });
    }
  }
}
function entryInput(state: SalesWorkspaceState): SalesEntryInput {
  return {
    sourceId: state.sourceId,
    isbn: state.isbn,
    platformTargetId: state.targetId,
    country: state.country,
    kind: state.kind,
    startDate: state.startDate,
    endDate: state.kind === 'transaction' ? state.startDate : state.endDate,
    units: Number(state.units),
    returns: Number(state.returns),
    currency: state.currency,
    money: {
      'gross-revenue': state.gross,
      'net-revenue': state.net,
      tax: state.tax,
      fees: state.fees,
      discounts: state.discounts,
      proceeds: state.proceeds
    },
    ...(state.externalReference.trim() ? { externalReference: state.externalReference.trim() } : {})
  };
}
function select(
  parent: HTMLElement,
  label: string,
  options: readonly (readonly [string, string])[]
): HTMLSelectElement {
  const element = parent.createEl('select', { attr: { 'aria-label': label } });
  element.createEl('option', { value: '', text: label });
  for (const [value, text] of options) element.createEl('option', { value, text });
  return element;
}
type CatalogRecordOption = readonly [string, string];
type SalesFilterSelectKey = 'filterBookId' | 'filterEditionId' | 'filterFormatId';
function clearPreview(state: SalesWorkspaceState): void {
  delete state.preview;
  state.acceptOverlap = false;
}
