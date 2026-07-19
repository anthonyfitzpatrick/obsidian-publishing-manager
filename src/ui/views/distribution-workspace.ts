/** Native DST-004 surface; all external states are explicit manual evidence. */
import { Notice } from 'obsidian';
import { safeExternalHttpUrl } from '../../domain/security/untrusted-data';
import type {
  DistributionProjectService,
  DistributionTargetInput
} from '../../application/distribution/distribution-project-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import { DISTRIBUTION_NO_CLIENT_DISCLOSURE } from '../../domain/distribution/distribution-record';
import {
  DISTRIBUTION_PUBLICATION_STATES,
  DISTRIBUTION_REVIEW_STATES
} from '../../domain/distribution/distribution-record';

export interface DistributionWorkspaceState {
  editionId: string;
  profileId: string;
  territory: string;
  location: string;
  intent: boolean;
  metadataReady: boolean;
  assetsReady: boolean;
  pricingReady: boolean;
  reviewState: string;
  publicationState: string;
  notes: string;
}
export function createDistributionWorkspaceState(): DistributionWorkspaceState {
  return {
    editionId: '',
    profileId: '',
    territory: '',
    location: '',
    intent: true,
    metadataReady: false,
    assetsReady: false,
    pricingReady: false,
    reviewState: 'not-submitted',
    publicationState: 'not-planned',
    notes: ''
  };
}

export function renderDistributionWorkspace(context: {
  parent: HTMLElement;
  book: CatalogRecord;
  snapshot: BookCatalogSnapshot;
  distribution: DistributionProjectService;
  state: DistributionWorkspaceState;
  rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-distribution-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Local manual distribution evidence' });
  title.createEl('h2', { text: 'Distribution' });
  title.createEl('p', { text: DISTRIBUTION_NO_CLIENT_DISCLOSURE });
  if (context.snapshot.platformProfiles.length === 0) {
    const empty = page.createEl('section', { cls: 'pm-panel' });
    empty.createEl('h3', { text: 'Install bundled local profiles' });
    empty.createEl('p', {
      text: 'Twelve conservative versioned profiles link to official sources and remain editable local planning templates.'
    });
    const install = empty.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: 'Install bundled profiles',
      attr: { type: 'button' }
    });
    install.addEventListener(
      'click',
      () =>
        void context.distribution
          .installBundledProfiles()
          .then(() => context.rerender())
          .catch((cause: unknown) => new Notice(message(cause)))
    );
    return;
  }
  const stale = page.createEl('details', { cls: 'pm-panel' });
  stale.createEl('summary', {
    text: `Profile review and versions · ${context.snapshot.platformProfiles.length}`
  });
  for (const profile of context.snapshot.platformProfiles) {
    const row = stale.createDiv({ cls: 'pm-distribution-profile' });
    row.createEl('strong', {
      text: `${String(profile.fields.label)} · v${String(profile.fields.version)}`
    });
    row.createEl('p', { text: `Reviewed ${String(profile.fields['reviewed-at'])}` });
    const officialUrl = safeExternalHttpUrl(profile.fields['official-url']);
    if (officialUrl === undefined)
      row.createEl('p', { cls: 'pm-muted', text: 'Official URL is invalid and cannot be opened.' });
    else
      row.createEl('a', {
        text: 'Open official requirements',
        href: officialUrl,
        attr: { target: '_blank', rel: 'noopener noreferrer' }
      });
    for (const issue of context.distribution.profileDiagnostics(profile))
      row.createEl('p', { text: `${issue.severity}: ${issue.message}` });
  }
  renderForm(page, context);
  renderTargets(page, context);
}
function renderForm(
  parent: HTMLElement,
  context: Parameters<typeof renderDistributionWorkspace>[0]
): void {
  const details = parent.createEl('details', { cls: 'pm-panel', attr: { open: 'true' } });
  details.createEl('summary', { text: 'Add distribution target' });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const edition = form.createEl('select', { attr: { 'aria-label': 'Distribution edition' } });
  edition.createEl('option', { value: '', text: 'Choose edition' });
  for (const item of context.snapshot.editions.filter(
    (e) => e.fields['book-id'] === context.book.id
  ))
    edition.createEl('option', {
      value: item.id,
      text: `${String(item.fields.type)} · revision ${String(item.fields.revision)}`
    });
  edition.addEventListener('change', () => (context.state.editionId = edition.value));
  const profile = form.createEl('select', { attr: { 'aria-label': 'Platform profile' } });
  profile.createEl('option', { value: '', text: 'Choose platform' });
  for (const item of context.snapshot.platformProfiles)
    profile.createEl('option', {
      value: item.id,
      text: `${String(item.fields.label)} · v${String(item.fields.version)}`
    });
  profile.addEventListener('change', () => (context.state.profileId = profile.value));
  for (const [key, label] of [
    ['territory', 'Territory (GB)'],
    ['location', 'Publication location identity'],
    ['notes', 'Notes']
  ] as const) {
    const input = form.createEl('input', {
      value: context.state[key],
      attr: { type: 'text', placeholder: label, 'aria-label': label }
    });
    input.addEventListener('input', () => (context.state[key] = input.value));
  }
  for (const [key, label] of [
    ['intent', 'Intended'],
    ['metadataReady', 'Metadata ready'],
    ['assetsReady', 'Assets ready'],
    ['pricingReady', 'Pricing ready']
  ] as const) {
    const field = form.createEl('label');
    const input = field.createEl('input', { attr: { type: 'checkbox' } });
    input.checked = context.state[key];
    field.appendText(` ${label}`);
    input.addEventListener('change', () => (context.state[key] = input.checked));
  }
  renderStateSelect(
    form,
    'Manual review state',
    DISTRIBUTION_REVIEW_STATES,
    context.state.reviewState,
    (value) => {
      context.state.reviewState = value;
    }
  );
  renderStateSelect(
    form,
    'Manual publication state',
    DISTRIBUTION_PUBLICATION_STATES,
    context.state.publicationState,
    (value) => {
      context.state.publicationState = value;
    }
  );
  const submit = form.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Create manual target',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input: DistributionTargetInput = {
      editionId: context.state.editionId,
      profileId: context.state.profileId,
      territory: context.state.territory,
      publicationLocation: context.state.location,
      intent: context.state.intent,
      metadataReady: context.state.metadataReady,
      assetsReady: context.state.assetsReady,
      pricingReady: context.state.pricingReady,
      reviewState: context.state.reviewState,
      publicationState: context.state.publicationState,
      notes: context.state.notes
    };
    submit.disabled = true;
    void context.distribution
      .saveTarget(input)
      .then(() => context.rerender())
      .catch((cause: unknown) => {
        new Notice(message(cause));
        submit.disabled = false;
      });
  });
}
function renderTargets(
  parent: HTMLElement,
  context: Parameters<typeof renderDistributionWorkspace>[0]
): void {
  const targets = context.distribution.targets(context.book.id);
  const section = parent.createEl('section', { cls: 'pm-panel' });
  section.createEl('h3', { text: `Platform × edition readiness · ${targets.length}` });
  const grid = section.createDiv({ cls: 'pm-distribution-grid' });
  for (const target of targets) {
    const card = grid.createEl('article', { cls: 'pm-distribution-card' });
    card.createEl('strong', {
      text: `${String(target.fields.platform)} · ${String(target.fields.territory)}`
    });
    card.createEl('p', { text: String(target.fields['publication-location']) });
    const readiness = context.distribution.readiness(target);
    card.createEl('p', {
      text: readiness.ready ? 'Ready from recorded local evidence' : 'Not ready'
    });
    for (const reason of readiness.reasons) card.createEl('p', { text: `• ${reason}` });
    for (const issue of context.distribution.targetDiagnostics(target))
      card.createEl('p', { text: `Warning: ${issue}` });
    card.createEl('p', {
      text: `Manual review: ${String(target.fields['review-state'])} · publication: ${String(target.fields['publication-state'])}`
    });
    renderTargetEvidenceEditor(card, target, context);
  }
}

/** Keeps every external-state change an explicit, reviewable user action. */
function renderTargetEvidenceEditor(
  parent: HTMLElement,
  target: CatalogRecord,
  context: Parameters<typeof renderDistributionWorkspace>[0]
): void {
  const details = parent.createEl('details');
  details.createEl('summary', { text: 'Update recorded evidence' });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const draft = targetInput(target);
  for (const [key, label] of [
    ['intent', 'Intended'],
    ['metadataReady', 'Metadata ready'],
    ['assetsReady', 'Assets ready'],
    ['pricingReady', 'Pricing ready']
  ] as const) {
    const field = form.createEl('label');
    const checkbox = field.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = draft[key];
    field.appendText(` ${label}`);
    checkbox.addEventListener('change', () => (draft[key] = checkbox.checked));
  }
  const checklist = draft.checklist ?? [];
  for (const item of checklist) {
    const field = form.createEl('label');
    const checkbox = field.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = item.done;
    field.appendText(` ${item.label}`);
    checkbox.addEventListener('change', () => (item.done = checkbox.checked));
  }
  renderStateSelect(
    form,
    'Manual review state',
    DISTRIBUTION_REVIEW_STATES,
    draft.reviewState,
    (value) => {
      draft.reviewState = value;
    }
  );
  renderStateSelect(
    form,
    'Manual publication state',
    DISTRIBUTION_PUBLICATION_STATES,
    draft.publicationState,
    (value) => {
      draft.publicationState = value;
    }
  );
  const save = form.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Save manual evidence',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    void context.distribution
      .saveTarget({ ...draft, lastVerified: new Date().toISOString().slice(0, 10) }, target.id)
      .then(() => context.rerender())
      .catch((cause: unknown) => {
        new Notice(message(cause));
        save.disabled = false;
      });
  });
}

function renderStateSelect(
  parent: HTMLElement,
  label: string,
  values: readonly string[],
  current: string,
  update: (value: string) => void
): void {
  const select = parent.createEl('select', { attr: { 'aria-label': label } });
  for (const value of values) {
    const option = select.createEl('option', { value, text: value });
    option.selected = value === current;
  }
  select.addEventListener('change', () => update(select.value));
}

function targetInput(target: CatalogRecord): DistributionTargetInput & {
  intent: boolean;
  metadataReady: boolean;
  assetsReady: boolean;
  pricingReady: boolean;
  reviewState: string;
  publicationState: string;
  checklist: { label: string; done: boolean }[];
} {
  return {
    editionId: String(target.fields['edition-id']),
    profileId: String(target.fields['profile-id']),
    territory: String(target.fields.territory),
    publicationLocation: String(target.fields['publication-location']),
    intent: target.fields.intent === true,
    metadataReady: target.fields['metadata-ready'] === true,
    assetsReady: target.fields['assets-ready'] === true,
    pricingReady: target.fields['pricing-ready'] === true,
    reviewState: String(target.fields['review-state']),
    publicationState: String(target.fields['publication-state']),
    ...(typeof target.fields.notes === 'string' ? { notes: target.fields.notes } : {}),
    checklist: checklistItems(target)
  };
}

function checklistItems(target: CatalogRecord): { label: string; done: boolean }[] {
  const checklist = target.fields.checklist;
  if (
    typeof checklist !== 'object' ||
    checklist === null ||
    !('items' in checklist) ||
    !Array.isArray(checklist.items)
  )
    return [];
  return (checklist.items as unknown[]).flatMap((item) =>
    typeof item === 'object' && item !== null && 'label' in item && typeof item.label === 'string'
      ? [{ label: item.label, done: 'done' in item && item.done === true }]
      : []
  );
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Distribution operation failed.';
}
