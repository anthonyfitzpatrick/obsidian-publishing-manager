/** HIS-003 local actor and non-destructive history-window preferences. */
export type HistoryRetentionDays = 0 | 365 | 1095 | 1825;
export interface HistoryPreferences {
  readonly actorLabel: string;
  readonly retentionDays: HistoryRetentionDays;
}
export interface HistoryPluginDataPort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

const DEFAULTS: HistoryPreferences = { actorLabel: 'Local user', retentionDays: 0 };

export class HistoryPreferencesService {
  private value: HistoryPreferences = DEFAULTS;
  public constructor(private readonly data: HistoryPluginDataPort) {}
  public async initialize(): Promise<void> {
    const root = object(await this.data.load());
    const history = object(root.history);
    const retention = Number(history.retentionDays);
    this.value = {
      actorLabel:
        typeof history.actorLabel === 'string' && history.actorLabel.trim()
          ? history.actorLabel.trim().slice(0, 80)
          : DEFAULTS.actorLabel,
      retentionDays: [0, 365, 1095, 1825].includes(retention)
        ? (retention as HistoryRetentionDays)
        : DEFAULTS.retentionDays
    };
  }
  public current(): HistoryPreferences {
    return this.value;
  }
  public async save(next: HistoryPreferences): Promise<void> {
    const actorLabel = next.actorLabel.trim();
    if (!actorLabel) throw new Error('History actor label is required.');
    if (![0, 365, 1095, 1825].includes(next.retentionDays))
      throw new Error('Choose one supported history window.');
    const root = object(await this.data.load());
    this.value = { actorLabel: actorLabel.slice(0, 80), retentionDays: next.retentionDays };
    await this.data.save({ ...root, history: this.value });
  }
}
function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
