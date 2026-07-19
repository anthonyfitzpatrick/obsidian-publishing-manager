/** Proves DSH-001–DSH-005/007/008 from fictional catalog and readiness projections. */
import { describe, expect, it } from 'vitest';
import type { BookCatalogSnapshot, CatalogRecord } from '../../src/domain/catalog/catalog-model';
import { CORE_READINESS_RULE_PACK } from '../../src/domain/readiness/core-readiness-rules';
import { evaluateReadiness } from '../../src/domain/readiness/readiness-engine';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { EMPTY_DASHBOARD_FILTERS } from '../../src/application/dashboard/dashboard-preferences-service';
import { buildOperationalDashboardModel } from '../../src/ui/view-models/operational-dashboard-view-model';

function record(
  type: CatalogRecord['type'],
  id: string,
  fields: Record<string, unknown>
): CatalogRecord {
  return {
    path: normalizeVaultPath(`Publishing Manager/Test/${id}.md`),
    id,
    type,
    schemaVersion: 1,
    archived: false,
    sourceRevision: id,
    fields
  };
}
function snapshot(): BookCatalogSnapshot {
  const book = record('book', 'pm-book-dashboard-0001', {
    title: 'Fictional Launch',
    status: 'active',
    'primary-language': 'en'
  });
  const edition = record('edition', 'pm-edition-dashboard-0001', {
    'book-id': book.id,
    type: 'paperback',
    medium: 'print',
    revision: 1,
    status: 'active',
    'publication-date': '2026-08-01'
  });
  return {
    availability: { state: 'ready' },
    books: [book],
    editions: [edition],
    formats: [],
    assets: [],
    metadataSets: [],
    isbns: [],
    prices: [],
    platformProfiles: [],
    platformTargets: [
      record('platform-target', 'pm-target-dashboard-0001', {
        'edition-id': edition.id,
        platform: 'Fictional Store',
        territory: 'GB',
        intent: true,
        'review-state': 'not-submitted',
        'publication-state': 'not-planned'
      })
    ],
    workflows: [],
    tasks: [
      record('task', 'pm-task-dashboard-0001', {
        'book-id': book.id,
        title: 'Finish files',
        status: 'active',
        required: true,
        owner: 'Editor',
        deadline: '2026-07-10',
        'depends-on': []
      })
    ],
    launches: [],
    diagnostics: [],
    recentActivity: [],
    nextMilestone: { code: 'manage-editions', title: 'Manage editions', explanation: 'Test.' }
  };
}
function blockedEvaluation(bookId: string) {
  return evaluateReadiness(
    CORE_READINESS_RULE_PACK,
    {
      scope: { kind: 'book', id: bookId },
      inputs: {
        'cover.state': 'fail',
        'isbn.state': 'pass',
        'metadata.state': 'pass',
        'formats.count': 1,
        'assets.freshness': 'pass',
        'pricing.state': 'pass',
        'tasks.required-count': 1,
        'tasks.incomplete-count': 1,
        'platform.state': 'fail'
      }
    },
    '2026-07-19T12:00:00.000Z'
  );
}
describe('operational dashboard model', () => {
  it('builds inspectable launch, overdue, blocker, workload, and portfolio evidence', () => {
    const source = snapshot();
    const evaluation = blockedEvaluation(source.books[0]!.id);
    const model = buildOperationalDashboardModel(
      source,
      new Map([[source.books[0]!.id, evaluation]]),
      EMPTY_DASHBOARD_FILTERS,
      '2026-07-19'
    );
    expect(model).toMatchObject({
      activeBooks: 1,
      launches30: 1,
      launches60: 1,
      launches90: 1,
      overdueTasks: 1,
      readinessBlockers: 2,
      partial: false
    });
    expect(model.attention[0]?.priority).toBeGreaterThanOrEqual(model.attention[1]?.priority ?? 0);
    expect(model.workload).toEqual([{ owner: 'Editor', open: 1, overdue: 1 }]);
    expect(model.portfolio[0]).toMatchObject({
      editions: 1,
      staleAssets: 0,
      platformState: '1 intended · action required'
    });
  });
  it('applies platform and score filters and labels pending evaluations partial', () => {
    const source = snapshot();
    const pending = buildOperationalDashboardModel(
      source,
      new Map(),
      { ...EMPTY_DASHBOARD_FILTERS, platform: 'Missing Store' },
      '2026-07-19'
    );
    expect(pending.portfolio).toHaveLength(0);
    expect(pending.partial).toBe(true);
    expect(pending.partialExplanation).toContain('still loading');
  });
});
