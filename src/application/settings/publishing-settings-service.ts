/**
 * SET-001–SET-005 settings contracts, validation, section resets, storage-move journaling, and
 * settings-only forgetting. Canonical project and asset ports are intentionally absent.
 */
import {
  JournaledOperationRunner,
  type OperationJournal,
  type OperationJournalStore
} from '../storage/operation-journal';
import type { Clock } from '../../domain/foundation/clock';
import { normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';

export type SettingsSectionName =
  | 'assets'
  | 'defaults'
  | 'integrations'
  | 'performance'
  | 'privacyDiagnostics'
  | 'readiness'
  | 'sales'
  | 'storage'
  | 'tasksDates';

export interface PublishingManagerSettings {
  readonly storage: {
    readonly managedRoot: string;
    readonly namingPattern: string;
    readonly historyDetail: 'minimal' | 'standard' | 'verbose';
    readonly archiveFolder: string;
  };
  readonly defaults: {
    readonly imprint: string;
    readonly language: string;
    readonly currency: string;
    readonly timezone: string;
    readonly workflow: string;
    readonly platformSet: string;
    readonly template: string;
  };
  readonly readiness: {
    readonly enabledRulePacks: readonly string[];
    readonly requiredWeight: number;
    readonly advisoryWeight: number;
    readonly blockerPolicy: 'cap-not-ready' | 'warn-only';
    readonly readyThreshold: number;
  };
  readonly tasksDates: {
    readonly weekStart: 'monday' | 'sunday';
    readonly workingDays: readonly string[];
    readonly defaultEstimateMinutes: number;
    readonly overduePolicy: 'calendar-day' | 'working-day';
  };
  readonly assets: {
    readonly fingerprintMode: 'content' | 'metadata' | 'off';
    readonly staleToleranceDays: number;
    readonly allowedVaultLocations: readonly string[];
  };
  readonly sales: {
    readonly sourceId: string;
    readonly publicationLocation: string;
    readonly country: string;
    readonly currency: string;
    readonly dateGrain: 'day' | 'period';
    readonly entryBehavior: 'confirm-every-entry' | 'reuse-last-safe-values';
    readonly displayCurrency: string;
    readonly diagnostics: boolean;
  };
  readonly integrations: {
    readonly enabledCapabilities: readonly string[];
    readonly discloseExchangedFields: boolean;
  };
  readonly performance: {
    readonly pageSize: number;
    readonly backgroundIndexing: boolean;
    readonly cacheLimitMb: number;
    readonly lowResourceMode: boolean;
  };
  readonly privacyDiagnostics: {
    readonly redactionLevel: 'balanced' | 'maximum' | 'none';
    readonly localLogRetentionDays: number;
    readonly diagnosticsExport: boolean;
  };
}

export interface SettingsPluginDataPort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

/** Narrow root-folder capability. It can rename vault entries but cannot read file bodies. */
export interface ManagedStorageMovePort {
  exists(path: VaultPath): Promise<boolean>;
  listPaths(root: VaultPath): Promise<readonly VaultPath[]>;
  rename(source: VaultPath, target: VaultPath): Promise<void>;
}

export interface StorageMovePreview {
  readonly operationId: string;
  readonly source: VaultPath;
  readonly target: VaultPath;
  readonly sourceExists: boolean;
  readonly sourcePaths: readonly VaultPath[];
  readonly targetExists: boolean;
  readonly blockedReasons: readonly string[];
  readonly consequences: readonly string[];
}

export interface ForgetSettingsPreview {
  readonly pluginDataKeys: readonly string[];
  readonly consequences: readonly string[];
  readonly canonicalProjectsDeleted: false;
  readonly linkedAssetsDeleted: false;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

export const DEFAULT_PUBLISHING_SETTINGS: PublishingManagerSettings = {
  storage: {
    managedRoot: 'Publishing Manager',
    namingPattern: '{type}-{title}',
    historyDetail: 'standard',
    archiveFolder: 'Publishing Manager/Archive'
  },
  defaults: {
    imprint: '',
    language: 'en',
    currency: 'USD',
    timezone: 'UTC',
    workflow: 'default-publishing-workflow',
    platformSet: '',
    template: ''
  },
  readiness: {
    enabledRulePacks: ['core'],
    requiredWeight: 100,
    advisoryWeight: 50,
    blockerPolicy: 'cap-not-ready',
    readyThreshold: 100
  },
  tasksDates: {
    weekStart: 'monday',
    workingDays: WEEKDAYS,
    defaultEstimateMinutes: 60,
    overduePolicy: 'calendar-day'
  },
  assets: {
    fingerprintMode: 'metadata',
    staleToleranceDays: 0,
    allowedVaultLocations: []
  },
  sales: {
    sourceId: '',
    publicationLocation: '',
    country: '',
    currency: 'USD',
    dateGrain: 'day',
    entryBehavior: 'confirm-every-entry',
    displayCurrency: '',
    diagnostics: true
  },
  integrations: {
    enabledCapabilities: [],
    discloseExchangedFields: true
  },
  performance: {
    pageSize: 50,
    backgroundIndexing: true,
    cacheLimitMb: 64,
    lowResourceMode: false
  },
  privacyDiagnostics: {
    redactionLevel: 'balanced',
    localLogRetentionDays: 30,
    diagnosticsExport: true
  }
};

export class PublishingSettingsService {
  private value: PublishingManagerSettings = structuredClone(DEFAULT_PUBLISHING_SETTINGS);
  private readonly journals: SettingsOperationJournalStore;
  private readonly runner: JournaledOperationRunner;

  public constructor(
    private readonly data: SettingsPluginDataPort,
    private readonly storage: ManagedStorageMovePort,
    private readonly clock: Clock
  ) {
    this.journals = new SettingsOperationJournalStore(data);
    this.runner = new JournaledOperationRunner(this.journals);
  }

  public async initialize(): Promise<void> {
    const root = object(await this.data.load());
    this.value = validateAll(object(root.settings), true);
  }

  public current(): PublishingManagerSettings {
    return structuredClone(this.value);
  }

  /** Validates a complete section before one plugin-data write and preserves every other key. */
  public async saveSection<K extends SettingsSectionName>(
    section: K,
    candidate: PublishingManagerSettings[K]
  ): Promise<PublishingManagerSettings[K]> {
    const validated = validateSection(section, candidate);
    const root = object(await this.data.load());
    const current = validateAll(object(root.settings), true);
    const next: PublishingManagerSettings = { ...current, [section]: validated };
    await this.data.save({ ...root, settings: next });
    this.value = next;
    return structuredClone(validated);
  }

  /** Resets only the selected preference block; canonical records are not reachable here. */
  public async restoreSection<K extends SettingsSectionName>(
    section: K
  ): Promise<PublishingManagerSettings[K]> {
    return this.saveSection(section, structuredClone(DEFAULT_PUBLISHING_SETTINGS[section]));
  }

  /** Builds a no-write storage plan with exact source inventory and collision evidence. */
  public async previewStorageMove(targetInput: string): Promise<StorageMovePreview> {
    const source = normalizeVaultPath(this.value.storage.managedRoot);
    const target = normalizeVaultPath(targetInput);
    const sourceExists = await this.storage.exists(source);
    const targetExists = await this.storage.exists(target);
    const sourcePaths = sourceExists ? await this.storage.listPaths(source) : [];
    const blockedReasons = [
      ...(source === target ? ['Source and target are the same managed folder.'] : []),
      ...(target.startsWith(`${source}/`) || source.startsWith(`${target}/`)
        ? ['Source and target cannot contain one another.']
        : []),
      ...(targetExists ? [`A vault entry already exists at ${target}.`] : [])
    ];
    return {
      operationId: storageMoveId(source, target),
      source,
      target,
      sourceExists,
      sourcePaths: [...sourcePaths].sort(),
      targetExists,
      blockedReasons,
      consequences: [
        `${sourcePaths.length} vault entries are in the previewed managed tree.`,
        sourceExists
          ? `The complete managed folder will move from ${source} to ${target}.`
          : 'No source folder exists; only the managed-root preference will change.',
        'Canonical record identities and linked external asset paths are not rewritten.',
        'A durable local journal supports retry after interruption.'
      ]
    };
  }

  /** Returns an interrupted move plan so the UI can resume it after plugin or app restart. */
  public async storageMoveRecovery(): Promise<StorageMovePreview | undefined> {
    const root = object(await this.data.load());
    return parseStorageMovePreview(root.settingsStorageMoveRecovery);
  }

  /** Applies or resumes the exact journaled move and updates the root preference last. */
  public async applyStorageMove(preview: StorageMovePreview): Promise<void> {
    if (preview.blockedReasons.length > 0)
      throw new Error(`Storage move is blocked: ${preview.blockedReasons.join(' ')}`);
    const existing = await this.journals.load(preview.operationId);
    if (existing === undefined) {
      if (this.value.storage.managedRoot !== preview.source)
        throw new Error('Managed-root setting changed after preview. Preview the move again.');
      if ((await this.storage.exists(preview.target)) || preview.targetExists)
        throw new Error('The target now exists. Preview the storage move again.');
      const currentPaths = preview.sourceExists ? await this.storage.listPaths(preview.source) : [];
      if (JSON.stringify([...currentPaths].sort()) !== JSON.stringify(preview.sourcePaths))
        throw new Error('The managed folder changed after preview. Preview the move again.');
      await this.persistRecovery(preview);
    }
    const steps = [
      {
        id: 'rename-managed-root',
        description: `Rename ${preview.source} to ${preview.target} without copying asset content.`,
        apply: async () => {
          if (preview.sourceExists) await this.storage.rename(preview.source, preview.target);
          return {};
        }
      },
      {
        id: 'save-managed-root-setting',
        description: `Save ${preview.target} as the managed root after the folder move.`,
        apply: async () => {
          const archiveFolder = this.value.storage.archiveFolder.startsWith(`${preview.source}/`)
            ? `${preview.target}${this.value.storage.archiveFolder.slice(preview.source.length)}`
            : this.value.storage.archiveFolder;
          await this.saveSection('storage', {
            ...this.value.storage,
            managedRoot: preview.target,
            archiveFolder
          });
          return {};
        }
      }
    ];
    await this.runner.run(
      preview.operationId,
      `move-managed-storage:${preview.source}:${preview.target}`,
      steps,
      () => this.clock.now().toISOString()
    );
    await this.clearRecovery();
  }

  /** The preview states exactly which plugin-data blocks disappear and what remains untouched. */
  public async previewForget(): Promise<ForgetSettingsPreview> {
    const root = object(await this.data.load());
    return {
      pluginDataKeys: Object.keys(root).sort(),
      consequences: [
        'Local preferences, saved views, licence evidence, and completed settings journals are removed.',
        'Publishing Manager project Markdown and linked production assets remain in the vault.',
        'Reload the plugin to reinitialize every runtime preference from defaults.'
      ],
      canonicalProjectsDeleted: false,
      linkedAssetsDeleted: false
    };
  }

  /** Clears only Obsidian plugin data and refuses to erase an active recovery checkpoint. */
  public async forget(preview: ForgetSettingsPreview): Promise<void> {
    if ((await this.storageMoveRecovery()) !== undefined)
      throw new Error('Finish or recover the managed-storage move before forgetting settings.');
    const current = await this.previewForget();
    if (JSON.stringify(current.pluginDataKeys) !== JSON.stringify(preview.pluginDataKeys))
      throw new Error('Plugin settings changed after preview. Preview Forget again.');
    await this.data.save({});
    this.value = structuredClone(DEFAULT_PUBLISHING_SETTINGS);
  }

  private async persistRecovery(preview: StorageMovePreview): Promise<void> {
    const root = object(await this.data.load());
    await this.data.save({ ...root, settingsStorageMoveRecovery: preview });
  }

  private async clearRecovery(): Promise<void> {
    const root = object(await this.data.load());
    delete root.settingsStorageMoveRecovery;
    await this.data.save(root);
  }
}

/** Plugin-data journal persistence keeps the checkpoint outside the vault tree being renamed. */
class SettingsOperationJournalStore implements OperationJournalStore {
  public constructor(private readonly data: SettingsPluginDataPort) {}
  public async load(id: string): Promise<OperationJournal | undefined> {
    const root = object(await this.data.load());
    const journals = object(root.settingsOperationJournals);
    return parseJournal(journals[id]);
  }
  public async save(journal: OperationJournal): Promise<void> {
    const root = object(await this.data.load());
    const journals = object(root.settingsOperationJournals);
    await this.data.save({
      ...root,
      settingsOperationJournals: { ...journals, [journal.id]: journal }
    });
  }
}

function validateAll(
  value: Record<string, unknown>,
  tolerateInvalid: boolean
): PublishingManagerSettings {
  const result = {} as Record<SettingsSectionName, unknown>;
  for (const section of Object.keys(DEFAULT_PUBLISHING_SETTINGS) as SettingsSectionName[]) {
    try {
      result[section] = validateSection(section, value[section]);
    } catch (cause) {
      if (!tolerateInvalid) throw cause;
      result[section] = structuredClone(DEFAULT_PUBLISHING_SETTINGS[section]);
    }
  }
  return result as unknown as PublishingManagerSettings;
}

function validateSection<K extends SettingsSectionName>(
  section: K,
  value: unknown
): PublishingManagerSettings[K] {
  const item = object(value);
  switch (section) {
    case 'storage':
      return {
        managedRoot: normalizeVaultPath(required(item.managedRoot, 'Managed root is required.')),
        namingPattern: bounded(required(item.namingPattern, 'Naming pattern is required.'), 120),
        historyDetail: oneOf(item.historyDetail, ['minimal', 'standard', 'verbose']),
        archiveFolder: normalizeVaultPath(
          required(item.archiveFolder, 'Archive folder is required.')
        )
      } as unknown as PublishingManagerSettings[K];
    case 'defaults':
      return {
        imprint: bounded(text(item.imprint), 160),
        language: code(item.language, 2, 16, 'Default language'),
        currency: currency(item.currency, 'Default currency'),
        timezone: bounded(required(item.timezone, 'Timezone is required.'), 80),
        workflow: bounded(required(item.workflow, 'Default workflow is required.'), 120),
        platformSet: bounded(text(item.platformSet), 120),
        template: bounded(text(item.template), 120)
      } as PublishingManagerSettings[K];
    case 'readiness': {
      const enabledRulePacks = uniqueStrings(item.enabledRulePacks, 16, true);
      if (!enabledRulePacks.includes('core'))
        throw new Error('The core readiness rule pack cannot be hidden.');
      return {
        enabledRulePacks,
        requiredWeight: integer(item.requiredWeight, 1, 1000, 'Required weight'),
        advisoryWeight: integer(item.advisoryWeight, 0, 1000, 'Advisory weight'),
        blockerPolicy: oneOf(item.blockerPolicy, ['cap-not-ready', 'warn-only']),
        readyThreshold: integer(item.readyThreshold, 1, 100, 'Ready threshold')
      } as PublishingManagerSettings[K];
    }
    case 'tasksDates': {
      const workingDays = uniqueStrings(item.workingDays, 7, true);
      if (workingDays.some((day) => !ALL_WEEKDAYS.some((candidate) => candidate === day)))
        throw new Error('Working days must use lowercase weekday names.');
      return {
        weekStart: oneOf(item.weekStart, ['monday', 'sunday']),
        workingDays,
        defaultEstimateMinutes: integer(
          item.defaultEstimateMinutes,
          0,
          100_000,
          'Default estimate'
        ),
        overduePolicy: oneOf(item.overduePolicy, ['calendar-day', 'working-day'])
      } as PublishingManagerSettings[K];
    }
    case 'assets':
      return {
        fingerprintMode: oneOf(item.fingerprintMode, ['content', 'metadata', 'off']),
        staleToleranceDays: integer(item.staleToleranceDays, 0, 3650, 'Stale tolerance'),
        allowedVaultLocations: uniqueStrings(item.allowedVaultLocations, 64).map((path) =>
          normalizeVaultPath(path)
        )
      } as unknown as PublishingManagerSettings[K];
    case 'sales':
      return {
        sourceId: bounded(text(item.sourceId), 160),
        publicationLocation: bounded(text(item.publicationLocation), 200),
        country: optionalCode(item.country, 2, 'Default country'),
        currency: currency(item.currency, 'Sales currency'),
        dateGrain: oneOf(item.dateGrain, ['day', 'period']),
        entryBehavior: oneOf(item.entryBehavior, ['confirm-every-entry', 'reuse-last-safe-values']),
        displayCurrency: optionalCurrency(item.displayCurrency),
        diagnostics: boolean(item.diagnostics, 'Sales diagnostics')
      } as PublishingManagerSettings[K];
    case 'integrations':
      return {
        enabledCapabilities: uniqueStrings(item.enabledCapabilities, 32),
        discloseExchangedFields: boolean(
          item.discloseExchangedFields,
          'Integration field disclosure'
        )
      } as PublishingManagerSettings[K];
    case 'performance':
      return {
        pageSize: integer(item.pageSize, 10, 500, 'Page size'),
        backgroundIndexing: boolean(item.backgroundIndexing, 'Background indexing'),
        cacheLimitMb: integer(item.cacheLimitMb, 1, 1024, 'Cache limit'),
        lowResourceMode: boolean(item.lowResourceMode, 'Low-resource mode')
      } as PublishingManagerSettings[K];
    case 'privacyDiagnostics':
      return {
        redactionLevel: oneOf(item.redactionLevel, ['balanced', 'maximum', 'none']),
        localLogRetentionDays: integer(item.localLogRetentionDays, 0, 3650, 'Local log retention'),
        diagnosticsExport: boolean(item.diagnosticsExport, 'Diagnostics export')
      } as PublishingManagerSettings[K];
  }
}

const ALL_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
] as const;

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function required(value: unknown, message: string): string {
  const result = text(value);
  if (!result) throw new Error(message);
  return result;
}

function bounded(value: string, maximum: number): string {
  if (value.length > maximum) throw new Error(`Value must be ${maximum} characters or fewer.`);
  return value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error(`Choose one of: ${choices.join(', ')}.`);
  return value as T;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum)
    throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be on or off.`);
  return value;
}

function code(value: unknown, minimum: number, maximum: number, label: string): string {
  const result = required(value, `${label} is required.`);
  if (!new RegExp(`^[A-Za-z][A-Za-z0-9-]{${minimum - 1},${maximum - 1}}$`, 'u').test(result))
    throw new Error(`${label} has an invalid code.`);
  return result;
}

function optionalCode(value: unknown, length: number, label: string): string {
  const result = text(value).toUpperCase();
  if (result && !new RegExp(`^[A-Z]{${length}}$`, 'u').test(result))
    throw new Error(`${label} must contain ${length} letters.`);
  return result;
}

function currency(value: unknown, label: string): string {
  const result = optionalCurrency(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function optionalCurrency(value: unknown): string {
  const result = text(value).toUpperCase();
  if (result && !/^[A-Z]{3}$/u.test(result))
    throw new Error('Currency must contain three letters.');
  return result;
}

function uniqueStrings(value: unknown, maximum: number, required = false): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Expected a list of text values.');
  const items: unknown[] = value;
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') throw new Error('Expected a list of text values.');
    const normalized = item.trim();
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  if ((required && result.length === 0) || result.length > maximum)
    throw new Error(`Choose ${required ? 'one to ' : ''}${maximum} values.`);
  return result;
}

function storageMoveId(source: string, target: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${source}|${target}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `storage-move-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function parseStorageMovePreview(value: unknown): StorageMovePreview | undefined {
  const item = object(value);
  if (
    typeof item.operationId !== 'string' ||
    typeof item.source !== 'string' ||
    typeof item.target !== 'string' ||
    typeof item.sourceExists !== 'boolean' ||
    typeof item.targetExists !== 'boolean' ||
    !Array.isArray(item.sourcePaths) ||
    !Array.isArray(item.blockedReasons) ||
    !Array.isArray(item.consequences)
  )
    return undefined;
  try {
    return {
      operationId: item.operationId,
      source: normalizeVaultPath(item.source),
      target: normalizeVaultPath(item.target),
      sourceExists: item.sourceExists,
      sourcePaths: item.sourcePaths.map((path) => normalizeVaultPath(String(path))),
      targetExists: item.targetExists,
      blockedReasons: item.blockedReasons.map(String),
      consequences: item.consequences.map(String)
    };
  } catch {
    return undefined;
  }
}

function parseJournal(value: unknown): OperationJournal | undefined {
  const item = object(value);
  if (
    typeof item.id !== 'string' ||
    typeof item.operation !== 'string' ||
    typeof item.state !== 'string' ||
    !['completed', 'pending', 'recovery-required', 'running'].includes(item.state) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    !Array.isArray(item.steps)
  )
    return undefined;
  return value as OperationJournal;
}
