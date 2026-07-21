/** Proves SET section validation, isolated resets, journal recovery, collision safety, and Forget. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLISHING_SETTINGS,
  METADATA_VISUALS_OPTIONAL_FIELD_GROUPS,
  PublishingSettingsService,
  type ManagedStorageMovePort,
  type SettingsPluginDataPort
} from '../../src/application/settings/publishing-settings-service';
import type { Clock } from '../../src/domain/foundation/clock';
import { normalizeVaultPath, type VaultPath } from '../../src/domain/storage/vault-path';

class FixedClock implements Clock {
  private tick = 0;
  public now() {
    return new Date(Date.UTC(2026, 6, 19, 12, 0, this.tick++));
  }
}

class MemoryData implements SettingsPluginDataPort {
  public value: unknown;
  public saves = 0;
  public failAt?: number;
  public constructor(initial: unknown = {}) {
    this.value = structuredClone(initial);
  }
  public async load(): Promise<unknown> {
    return structuredClone(this.value);
  }
  public async save(value: unknown): Promise<void> {
    this.saves += 1;
    if (this.saves === this.failAt) throw new Error('Simulated plugin-data interruption.');
    this.value = structuredClone(value);
  }
}

class MemoryStorage implements ManagedStorageMovePort {
  public paths = new Set<VaultPath>();
  public renames = 0;
  public async exists(path: VaultPath): Promise<boolean> {
    return [...this.paths].some(
      (candidate) => candidate === path || candidate.startsWith(`${path}/`)
    );
  }
  public async listPaths(root: VaultPath): Promise<readonly VaultPath[]> {
    return [...this.paths].filter((path) => path === root || path.startsWith(`${root}/`)).sort();
  }
  public async rename(source: VaultPath, target: VaultPath): Promise<void> {
    if (await this.exists(target)) throw new Error('Target exists.');
    const moving = await this.listPaths(source);
    if (moving.length === 0) throw new Error('Source missing.');
    for (const path of moving) this.paths.delete(path);
    for (const path of moving)
      this.paths.add(normalizeVaultPath(`${target}${path.slice(source.length)}`));
    this.renames += 1;
  }
}

function storageFixture(): MemoryStorage {
  const storage = new MemoryStorage();
  for (const path of [
    'Publishing Manager',
    'Publishing Manager/Books',
    'Publishing Manager/Books/example.md',
    'Publishing Manager/Asset References/cover.md'
  ])
    storage.paths.add(normalizeVaultPath(path));
  return storage;
}

describe('publishing settings service', () => {
  it('retires the removed compiler capability while preserving metadata-visual field-group controls', async () => {
    const legacy = structuredClone(DEFAULT_PUBLISHING_SETTINGS) as unknown as Record<
      string,
      unknown
    >;
    legacy.integrations = {
      enabledCapabilities: ['manuscript-compiler'],
      discloseExchangedFields: true
    };
    const data = new MemoryData({ settings: legacy });
    const service = new PublishingSettingsService(data, storageFixture(), new FixedClock());
    await service.initialize();
    expect(service.current().integrations).toEqual({
      enabledCapabilities: [],
      discloseExchangedFields: true,
      metadataVisualsFieldGroups: METADATA_VISUALS_OPTIONAL_FIELD_GROUPS
    });
    expect(service.current().integrations.enabledCapabilities).not.toContain('metadata-visuals');

    await service.saveSection('integrations', {
      ...service.current().integrations,
      enabledCapabilities: ['metadata-visuals'],
      metadataVisualsFieldGroups: ['relationships', 'dates']
    });
    expect(service.current().integrations.metadataVisualsFieldGroups).toEqual([
      'relationships',
      'dates'
    ]);
    await expect(
      service.saveSection('integrations', {
        ...service.current().integrations,
        metadataVisualsFieldGroups: ['unknown-group'] as never
      })
    ).rejects.toThrow('recognized identifiers');
  });

  it('validates before save, preserves unrelated data, and resets one section only', async () => {
    const data = new MemoryData({ unrelated: { keep: true } });
    const service = new PublishingSettingsService(data, storageFixture(), new FixedClock());
    await service.initialize();
    expect(service.current()).toEqual(DEFAULT_PUBLISHING_SETTINGS);
    await expect(
      service.saveSection('performance', {
        pageSize: 0,
        backgroundIndexing: true,
        cacheLimitMb: 64,
        lowResourceMode: false
      })
    ).rejects.toThrow('Page size');
    expect(data.saves).toBe(0);
    await service.saveSection('defaults', {
      ...service.current().defaults,
      imprint: 'Fictional Press',
      currency: 'sek'
    });
    await service.saveSection('performance', {
      pageSize: 20,
      backgroundIndexing: false,
      cacheLimitMb: 16,
      lowResourceMode: true
    });
    expect(service.current().defaults.imprint).toBe('Fictional Press');
    expect(service.current().defaults.currency).toBe('SEK');
    expect(service.current().performance.lowResourceMode).toBe(true);
    await service.restoreSection('performance');
    expect(service.current().performance).toEqual(DEFAULT_PUBLISHING_SETTINGS.performance);
    expect(service.current().defaults.imprint).toBe('Fictional Press');
    expect((data.value as Record<string, unknown>).unrelated).toEqual({ keep: true });
    await expect(
      service.saveSection('readiness', {
        ...service.current().readiness,
        enabledRulePacks: ['custom']
      })
    ).rejects.toThrow('core readiness');
  });

  it('previews collisions and completes a journaled root move without touching linked assets', async () => {
    const data = new MemoryData();
    const storage = storageFixture();
    storage.paths.add(normalizeVaultPath('Occupied'));
    const service = new PublishingSettingsService(data, storage, new FixedClock());
    await service.initialize();
    const blocked = await service.previewStorageMove('Occupied');
    expect(blocked.blockedReasons).toContain('A vault entry already exists at Occupied.');
    await expect(service.applyStorageMove(blocked)).rejects.toThrow('blocked');
    const preview = await service.previewStorageMove('Operations/Publishing');
    expect(preview.sourcePaths).toHaveLength(4);
    expect(preview.consequences.join(' ')).toContain(
      'linked external asset paths are not rewritten'
    );
    await service.applyStorageMove(preview);
    expect(storage.renames).toBe(1);
    expect(await storage.exists(normalizeVaultPath('Operations/Publishing'))).toBe(true);
    expect(service.current().storage.managedRoot).toBe('Operations/Publishing');
    expect(service.current().storage.archiveFolder).toBe('Operations/Publishing/Archive');
    expect(await service.storageMoveRecovery()).toBeUndefined();
  });

  it('resumes after interruption without repeating an applied folder rename', async () => {
    const data = new MemoryData();
    data.failAt = 4;
    const storage = storageFixture();
    const service = new PublishingSettingsService(data, storage, new FixedClock());
    await service.initialize();
    const preview = await service.previewStorageMove('Recovered Publishing');
    await expect(service.applyStorageMove(preview)).rejects.toThrow('Simulated');
    expect(storage.renames).toBe(1);
    expect(await service.storageMoveRecovery()).toEqual(preview);
    await service.applyStorageMove(preview);
    expect(storage.renames).toBe(1);
    expect(service.current().storage.managedRoot).toBe('Recovered Publishing');
    expect(await service.storageMoveRecovery()).toBeUndefined();
  });

  it('forgets plugin data only after an exact preview and performs no storage mutation', async () => {
    const data = new MemoryData({
      settings: DEFAULT_PUBLISHING_SETTINGS,
      dashboard: {},
      history: {}
    });
    const storage = storageFixture();
    const service = new PublishingSettingsService(data, storage, new FixedClock());
    await service.initialize();
    const preview = await service.previewForget();
    expect(preview.canonicalProjectsDeleted).toBe(false);
    expect(preview.linkedAssetsDeleted).toBe(false);
    expect(preview.pluginDataKeys).toEqual(['dashboard', 'history', 'settings']);
    await service.forget(preview);
    expect(data.value).toEqual({});
    expect(storage.renames).toBe(0);
    expect(await storage.exists(normalizeVaultPath('Publishing Manager/Books/example.md'))).toBe(
      true
    );
    expect(service.current()).toEqual(DEFAULT_PUBLISHING_SETTINGS);
  });
});
