/** Native RDY-007–RDY-011 result workspace with text evidence and audited override capture. */
import { Notice } from 'obsidian';
import type { ReadinessProjectService } from '../../application/readiness/readiness-project-service';
import type {
  ReadinessEvaluation,
  ReadinessRuleResult
} from '../../domain/readiness/readiness-engine';
import { buildReadinessSummary } from '../view-models/readiness-summary-view-model';

export function renderReadinessWorkspace(context: {
  readonly parent: HTMLElement;
  readonly evaluation: ReadinessEvaluation | undefined;
  readonly readiness: ReadinessProjectService;
  readonly openWorkspace: (workspace: string) => void;
  readonly rerender: () => void;
}): void {
  const page = context.parent.createEl('section', { cls: 'pm-readiness-page' });
  const heading = page.createDiv({ cls: 'pm-section-heading' });
  const title = heading.createDiv();
  title.createEl('p', { cls: 'pm-eyebrow', text: 'Deterministic local evidence' });
  title.createEl('h2', { text: 'Readiness' });
  if (context.evaluation === undefined) {
    page.createDiv({ cls: 'pm-empty-state', text: 'Evaluating current canonical evidence…' });
    return;
  }
  const summary = buildReadinessSummary(context.evaluation);
  const panel = page.createEl('section', { cls: 'pm-panel' });
  panel.createEl('h3', { text: summary.stateLabel });
  panel.createEl('p', { text: `${summary.scoreLabel} · ${summary.confidenceLabel}` });
  panel.createEl('p', {
    text: `Rule pack ${context.evaluation.rulePackCode} v${context.evaluation.rulePackVersion} · evaluated ${context.evaluation.evaluatedAt}`
  });
  panel.createEl('small', {
    text: `${context.evaluation.reusedRuleCodes.length} unchanged rules reused from declared dependency keys.`
  });
  const list = page.createDiv({ cls: 'pm-readiness-grid' });
  for (const result of context.evaluation.results) renderResult(list, result, context);
}

function renderResult(
  parent: HTMLElement,
  result: ReadinessRuleResult,
  context: Parameters<typeof renderReadinessWorkspace>[0]
): void {
  const card = parent.createEl('article', { cls: 'pm-panel pm-readiness-result' });
  card.createEl('strong', {
    text: `${stateLabel(result.state)} · ${result.code} v${result.version}`
  });
  card.createEl('p', { text: result.evidence.summary });
  card.createEl('small', { text: `Severity ${result.severity} · weight ${result.weight}` });
  if (result.remedy !== undefined) card.createEl('p', { text: `Remedy: ${result.remedy}` });
  if (result.override !== undefined)
    card.createEl('p', {
      text: `Override active — ${result.override.ownerLabel}: ${result.override.reason}${result.override.expiresAt === undefined ? '' : ` · expires ${result.override.expiresAt}`}`
    });
  if (result.destination !== undefined) {
    const open = card.createEl('button', {
      cls: 'pm-button pm-button--secondary',
      text: result.destination.label,
      attr: { type: 'button' }
    });
    open.addEventListener('click', () =>
      context.openWorkspace(result.destination?.workspace ?? 'overview')
    );
  }
  if (result.state === 'fail' && result.override === undefined)
    renderOverrideForm(card, result, context);
}

function renderOverrideForm(
  parent: HTMLElement,
  result: ReadinessRuleResult,
  context: Parameters<typeof renderReadinessWorkspace>[0]
): void {
  const details = parent.createEl('details');
  details.createEl('summary', { text: 'Record audited override' });
  details.createEl('p', {
    text: 'An override qualifies this failure; it does not erase the evidence or turn it into an unqualified pass.'
  });
  const form = details.createEl('form', { cls: 'pm-form-grid' });
  const reason = form.createEl('input', {
    attr: { type: 'text', placeholder: 'Reason', 'aria-label': 'Override reason' }
  });
  const owner = form.createEl('input', {
    attr: { type: 'text', placeholder: 'Owner label', 'aria-label': 'Override owner label' }
  });
  const expiry = form.createEl('input', {
    attr: { type: 'datetime-local', 'aria-label': 'Optional override expiry' }
  });
  const save = form.createEl('button', {
    cls: 'pm-button pm-button--primary',
    text: 'Record override',
    attr: { type: 'submit' }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    void context.readiness
      .createOverride({
        ruleCode: result.code,
        scope: context.evaluation?.scope ?? { kind: 'book', id: 'missing' },
        reason: reason.value,
        ownerLabel: owner.value,
        ...(expiry.value ? { expiresAt: new Date(expiry.value).toISOString() } : {})
      })
      .then(() => context.rerender())
      .catch((cause: unknown) => {
        new Notice(cause instanceof Error ? cause.message : 'Override could not be recorded.');
        save.disabled = false;
      });
  });
}

function stateLabel(state: ReadinessRuleResult['state']): string {
  return state === 'pass'
    ? '✓ Pass'
    : state === 'warning'
      ? '△ Warning'
      : state === 'fail'
        ? '✕ Fail'
        : state === 'unknown'
          ? '? Unknown'
          : '— Not applicable';
}
