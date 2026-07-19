/** Proves DSH-006 saved views persist locally without erasing unrelated plugin data. */
import { describe, expect, it } from 'vitest';
import {
  DashboardPreferencesService,
  EMPTY_DASHBOARD_FILTERS
} from '../../src/application/dashboard/dashboard-preferences-service';

describe('dashboard preferences service', () => {
  it('round-trips filters and columns while preserving other settings', async () => {
    let value: unknown = { unrelated: { retained: true } };
    const service = new DashboardPreferencesService({
      load: async () => value,
      save: async (next) => {
        value = next;
      }
    });
    await service.saveView({
      id: 'dashboard-view-launches',
      name: 'Launches',
      filters: { ...EMPTY_DASHBOARD_FILTERS, territory: 'GB', launchWindow: '30' },
      columns: ['book', 'score']
    });
    const views = await service.savedViews();
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe('Launches');
    expect(views[0]?.columns).toEqual(['book', 'score']);
    expect(views[0]?.filters.territory).toBe('GB');
    expect(views[0]?.filters.launchWindow).toBe('30');
    expect(value).toMatchObject({ unrelated: { retained: true } });
  });
});
