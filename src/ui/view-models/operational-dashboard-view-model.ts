/** Pure DSH-001–DSH-008 operational projection over catalog and M5 evaluations. */
import type { DashboardFilterState } from '../../application/dashboard/dashboard-preferences-service';
import type { BookCatalogSnapshot, CatalogRecord } from '../../domain/catalog/catalog-model';
import type { ReadinessEvaluation } from '../../domain/readiness/readiness-engine';

export interface DashboardAttentionItem {
  readonly id: string;
  readonly kind: 'diagnostic' | 'launch' | 'readiness' | 'task';
  readonly priority: number;
  readonly title: string;
  readonly explanation: string;
  readonly bookId?: string;
  readonly record?: CatalogRecord;
}
export interface DashboardPortfolioRow {
  readonly book: CatalogRecord;
  readonly editions: number;
  readonly stage: string;
  readonly score: number | null;
  readonly confidence: number | null;
  readonly nextDeadline?: string;
  readonly staleAssets: number;
  readonly platformState: string;
}
export interface OperationalDashboardModel {
  readonly activeBooks: number;
  readonly launches30: number;
  readonly launches60: number;
  readonly launches90: number;
  readonly overdueTasks: number;
  readonly readinessBlockers: number;
  readonly attention: readonly DashboardAttentionItem[];
  readonly timeline: readonly { bookId: string; title: string; date: string; days: number }[];
  readonly workload: readonly { owner: string; open: number; overdue: number }[];
  readonly portfolio: readonly DashboardPortfolioRow[];
  readonly partial: boolean;
  readonly partialExplanation: string;
}

export function buildOperationalDashboardModel(
  snapshot: BookCatalogSnapshot,
  evaluations: ReadonlyMap<string, ReadinessEvaluation>,
  filters: DashboardFilterState,
  today: string
): OperationalDashboardModel {
  const now = Date.parse(`${today}T00:00:00Z`);
  const bookRows = snapshot.books.map((book) =>
    portfolioRow(book, snapshot, evaluations.get(book.id))
  );
  const portfolio = bookRows.filter((row) => matchesFilters(row, snapshot, filters, now));
  const visibleIds = new Set(portfolio.map(({ book }) => book.id));
  const tasks = snapshot.tasks.filter((task) => visibleIds.has(String(task.fields['book-id'])));
  const overdue = tasks.filter(
    (task) => task.fields.status !== 'done' && isPast(task.fields.deadline, now)
  );
  const plannedBookIds = new Set(
    snapshot.launches.map((launch) => String(launch.fields['book-id']))
  );
  const timelineSources = [
    ...snapshot.launches.map((launch) => ({
      bookId: launch.fields['book-id'],
      date: launch.fields['publication-date']
    })),
    ...snapshot.editions
      .filter((edition) => !plannedBookIds.has(String(edition.fields['book-id'])))
      .map((edition) => ({
        bookId: edition.fields['book-id'],
        date: edition.fields['publication-date']
      }))
  ];
  const timeline = timelineSources
    .flatMap((source) => {
      const book = snapshot.books.find(({ id }) => id === source.bookId);
      const date = source.date;
      if (book === undefined || !visibleIds.has(book.id) || typeof date !== 'string') return [];
      return [
        { bookId: book.id, title: String(book.fields.title), date, days: daysFrom(date, now) }
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const blockers = [...evaluations.entries()].flatMap(([bookId, evaluation]) =>
    visibleIds.has(bookId)
      ? evaluation.results
          .filter(
            ({ state, severity, override }) =>
              state === 'fail' && severity === 'blocking' && override === undefined
          )
          .map((result) => ({ bookId, result }))
      : []
  );
  const attention: DashboardAttentionItem[] = [
    ...snapshot.diagnostics.map((diagnostic) => ({
      id: `diagnostic:${diagnostic.path}`,
      kind: 'diagnostic' as const,
      priority: diagnostic.severity === 'error' ? 100 : 70,
      title: diagnostic.message,
      explanation: diagnostic.suggestedAction
    })),
    ...overdue.map((task) => ({
      id: `task:${task.id}`,
      kind: 'task' as const,
      priority: 80 + dependencyImpact(task, tasks) + ageScore(task.fields.deadline, now),
      title: String(task.fields.title),
      explanation: `Overdue since ${String(task.fields.deadline)}.`,
      bookId: String(task.fields['book-id']),
      record: task
    })),
    ...blockers.map(({ bookId, result }) => ({
      id: `readiness:${bookId}:${result.code}`,
      kind: 'readiness' as const,
      priority: 90 + result.weight,
      title: result.evidence.summary,
      explanation: result.remedy ?? 'Resolve the blocking readiness evidence.',
      bookId
    })),
    ...timeline
      .filter(({ days }) => days >= 0 && days <= 30)
      .map((item) => ({
        id: `launch:${item.bookId}:${item.date}`,
        kind: 'launch' as const,
        priority: 60 + Math.max(0, 30 - item.days),
        title: `${item.title} publishes ${item.date}`,
        explanation: `${item.days} days from the current local date.`,
        bookId: item.bookId
      }))
  ].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const owners = new Map<string, { open: number; overdue: number }>();
  for (const task of tasks.filter(({ fields }) => fields.status !== 'done')) {
    const owner =
      typeof task.fields.owner === 'string' && task.fields.owner ? task.fields.owner : 'Unassigned';
    const current = owners.get(owner) ?? { open: 0, overdue: 0 };
    owners.set(owner, {
      open: current.open + 1,
      overdue: current.overdue + (isPast(task.fields.deadline, now) ? 1 : 0)
    });
  }
  return {
    activeBooks: portfolio.filter(({ book }) => !book.archived).length,
    launches30: timeline.filter(({ days }) => days >= 0 && days <= 30).length,
    launches60: timeline.filter(({ days }) => days >= 0 && days <= 60).length,
    launches90: timeline.filter(({ days }) => days >= 0 && days <= 90).length,
    overdueTasks: overdue.length,
    readinessBlockers: blockers.length,
    attention,
    timeline,
    workload: [...owners.entries()]
      .map(([owner, value]) => ({ owner, ...value }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.owner.localeCompare(b.owner)),
    portfolio,
    partial:
      snapshot.availability.state !== 'ready' ||
      snapshot.diagnostics.length > 0 ||
      evaluations.size < snapshot.books.filter(({ archived }) => !archived).length,
    partialExplanation:
      snapshot.availability.state === 'rebuilding'
        ? 'Catalog/index rebuild is active; operational totals are partial.'
        : snapshot.diagnostics.length > 0
          ? 'Invalid records are excluded; operational totals are partial.'
          : evaluations.size < snapshot.books.filter(({ archived }) => !archived).length
            ? 'Readiness evaluations are still loading; blocker and score totals are partial.'
            : 'All current local projections are available.'
  };
}

function portfolioRow(
  book: CatalogRecord,
  snapshot: BookCatalogSnapshot,
  evaluation?: ReadinessEvaluation
): DashboardPortfolioRow {
  const editions = snapshot.editions.filter((item) => item.fields['book-id'] === book.id);
  const tasks = snapshot.tasks.filter(
    (item) => item.fields['book-id'] === book.id && item.fields.status !== 'done'
  );
  const workflow = snapshot.workflows.find(
    (item) => item.fields['book-id'] === book.id && item.fields.status === 'active'
  );
  const targets = snapshot.platformTargets.filter((item) =>
    editions.some(({ id }) => id === item.fields['edition-id'])
  );
  const freshness = evaluation?.results.find(({ code }) => code === 'CORE.FILE_FRESHNESS');
  const deadline = nextDeadline(tasks);
  return {
    book,
    editions: editions.length,
    stage: currentStage(workflow),
    score: evaluation?.score ?? null,
    confidence: evaluation?.confidence ?? null,
    ...(deadline === undefined ? {} : { nextDeadline: deadline }),
    staleAssets: freshness?.state === 'fail' ? 1 : 0,
    platformState:
      targets.length === 0
        ? 'No intended targets'
        : targets.every(
              (item) =>
                ['approved'].includes(String(item.fields['review-state'])) ||
                ['preorder', 'published'].includes(String(item.fields['publication-state']))
            )
          ? 'Confirmed'
          : `${targets.filter((item) => item.fields.intent === true).length} intended · action required`
  };
}
function matchesFilters(
  row: DashboardPortfolioRow,
  snapshot: BookCatalogSnapshot,
  filters: DashboardFilterState,
  now: number
): boolean {
  const editions = snapshot.editions.filter((item) => item.fields['book-id'] === row.book.id);
  const targets = snapshot.platformTargets.filter((item) =>
    editions.some(({ id }) => id === item.fields['edition-id'])
  );
  const tasks = snapshot.tasks.filter((item) => item.fields['book-id'] === row.book.id);
  const metadata = snapshot.metadataSets.find(
    (item) => item.fields['book-id'] === row.book.id && item.fields.scope === 'book'
  );
  const values =
    typeof metadata?.fields.values === 'object' && metadata.fields.values !== null
      ? (metadata.fields.values as Record<string, unknown>)
      : {};
  const dates = editions.flatMap((item) =>
    typeof item.fields['publication-date'] === 'string'
      ? [daysFrom(item.fields['publication-date'], now)]
      : []
  );
  return (
    (!filters.series || row.book.fields['series-id'] === filters.series) &&
    (!filters.imprint ||
      (typeof values.imprint === 'string' &&
        values.imprint.toLowerCase().includes(filters.imprint.toLowerCase()))) &&
    (!filters.owner || tasks.some((item) => item.fields.owner === filters.owner)) &&
    (!filters.status || row.book.fields.status === filters.status) &&
    (!filters.editionType || editions.some((item) => item.fields.type === filters.editionType)) &&
    (!filters.platform || targets.some((item) => item.fields.platform === filters.platform)) &&
    (!filters.territory ||
      targets.some((item) => item.fields.territory === filters.territory.toUpperCase())) &&
    (!filters.launchWindow ||
      dates.some((days) => days >= 0 && days <= Number(filters.launchWindow))) &&
    (!filters.maximumScore || (row.score !== null && row.score <= Number(filters.maximumScore)))
  );
}
function currentStage(workflow: CatalogRecord | undefined): string {
  const stages = workflow?.fields.stages;
  if (
    typeof stages !== 'object' ||
    stages === null ||
    !('items' in stages) ||
    !Array.isArray(stages.items)
  )
    return 'No active workflow';
  const current = (stages.items as unknown[]).find(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'status' in item &&
      item.status !== 'complete' &&
      item.status !== 'skipped' &&
      item.status !== 'archived'
  );
  return typeof current === 'object' && current !== null && 'label' in current
    ? String(current.label)
    : 'Complete';
}
function nextDeadline(tasks: readonly CatalogRecord[]): string | undefined {
  return tasks
    .flatMap((item) => (typeof item.fields.deadline === 'string' ? [item.fields.deadline] : []))
    .sort()[0];
}
function isPast(value: unknown, now: number): boolean {
  return typeof value === 'string' && Date.parse(`${value}T00:00:00Z`) < now;
}
function daysFrom(date: string, now: number): number {
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - now) / 86_400_000);
}
function dependencyImpact(task: CatalogRecord, tasks: readonly CatalogRecord[]): number {
  return Math.min(
    20,
    tasks.filter(
      (item) =>
        Array.isArray(item.fields['depends-on']) && item.fields['depends-on'].includes(task.id)
    ).length * 3
  );
}
function ageScore(value: unknown, now: number): number {
  return typeof value === 'string'
    ? Math.min(20, Math.max(0, Math.floor((now - Date.parse(`${value}T00:00:00Z`)) / 86_400_000)))
    : 0;
}
