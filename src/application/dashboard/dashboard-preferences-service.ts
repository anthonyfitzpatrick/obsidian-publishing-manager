/** DSH-006 local saved-view persistence that preserves unrelated plugin settings. */
export interface DashboardFilterState {
  readonly series: string;
  readonly imprint: string;
  readonly owner: string;
  readonly status: string;
  readonly editionType: string;
  readonly platform: string;
  readonly territory: string;
  readonly launchWindow: '' | '30' | '60' | '90';
  readonly maximumScore: string;
}

export interface DashboardSavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: DashboardFilterState;
  readonly columns: readonly string[];
}

interface DashboardSettingsBlock {
  readonly savedViews: readonly DashboardSavedView[];
}
export interface DashboardPluginDataPort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilterState = {
  series: '',
  imprint: '',
  owner: '',
  status: '',
  editionType: '',
  platform: '',
  territory: '',
  launchWindow: '',
  maximumScore: ''
};
export const DEFAULT_DASHBOARD_COLUMNS = [
  'book',
  'editions',
  'stage',
  'score',
  'deadline',
  'stale-assets',
  'platform-state'
] as const;

export class DashboardPreferencesService {
  public constructor(private readonly data: DashboardPluginDataPort) {}
  public async savedViews(): Promise<readonly DashboardSavedView[]> {
    const root = asObject(await this.data.load());
    const dashboard = asObject(root.dashboard);
    return Array.isArray(dashboard.savedViews) ? dashboard.savedViews.flatMap(parseView) : [];
  }
  public async saveView(view: DashboardSavedView): Promise<void> {
    if (!view.name.trim()) throw new Error('Saved view name is required.');
    const root = asObject(await this.data.load());
    const existing = await this.savedViews();
    const next = [
      ...existing.filter(({ id }) => id !== view.id),
      { ...view, name: view.name.trim() }
    ];
    await this.data.save({
      ...root,
      dashboard: { savedViews: next } satisfies DashboardSettingsBlock
    });
  }
}
function parseView(value: unknown): DashboardSavedView[] {
  const item = asObject(value);
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.columns))
    return [];
  const filters = asObject(item.filters);
  return [
    {
      id: item.id,
      name: item.name,
      filters: {
        series: text(filters.series),
        imprint: text(filters.imprint),
        owner: text(filters.owner),
        status: text(filters.status),
        editionType: text(filters.editionType),
        platform: text(filters.platform),
        territory: text(filters.territory),
        launchWindow: ['30', '60', '90'].includes(text(filters.launchWindow))
          ? (text(filters.launchWindow) as '30' | '60' | '90')
          : '',
        maximumScore: text(filters.maximumScore)
      },
      columns: item.columns.filter((column): column is string => typeof column === 'string')
    }
  ];
}
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
