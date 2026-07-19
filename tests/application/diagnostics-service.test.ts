/** Proves seven-area coverage, default redaction, stale guards, safe rebuild, and guided repair. */
import { describe, expect, it } from 'vitest';
import { DiagnosticsService } from '../../src/application/diagnostics/diagnostics-service';
import { DEFAULT_PUBLISHING_SETTINGS } from '../../src/application/settings/publishing-settings-service';
import type { StorageMovePreview } from '../../src/application/settings/publishing-settings-service';
import type {
  BookCatalogSnapshot,
  CatalogDiagnostic
} from '../../src/domain/catalog/catalog-model';
import type { Clock } from '../../src/domain/foundation/clock';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T18:00:00.000Z');
  }
}

function diagnostic(overrides: Partial<CatalogDiagnostic> = {}): CatalogDiagnostic {
  return {
    code: 'catalog.malformed-schema',
    severity: 'error',
    path: normalizeVaultPath('Publishing Manager/Books/private-title.md'),
    entityId: 'pm-book-private-0001',
    field: 'title',
    message: 'Private title value is invalid.',
    suggestedAction: 'Open private-title.md and replace the private title value.',
    ...overrides
  };
}

function snapshot(diagnostics: readonly CatalogDiagnostic[] = []): BookCatalogSnapshot {
  return {
    availability: { state: 'ready' },
    books: [],
    editions: [],
    formats: [],
    assets: [],
    metadataSets: [],
    isbns: [],
    prices: [],
    platformProfiles: [],
    platformTargets: [],
    workflows: [],
    tasks: [],
    launches: [],
    diagnostics,
    recentActivity: [],
    nextMilestone: { code: 'create-first-book', title: 'Create a book', explanation: 'Test.' }
  };
}

function fixture(
  diagnostics: readonly CatalogDiagnostic[] = [],
  recovery: StorageMovePreview | undefined = undefined
) {
  let current = snapshot(diagnostics);
  let rebuilds = 0;
  const vault = new MemoryVaultTextPort();
  const settings = {
    current: () => structuredClone(DEFAULT_PUBLISHING_SETTINGS),
    storageMoveRecovery: async () => recovery
  };
  const service = new DiagnosticsService(
    { snapshot: () => current },
    settings,
    vault,
    new ManagedFolderLayout({ root: 'Publishing Manager' }),
    new FixedClock(),
    async () => {
      rebuilds += 1;
    }
  );
  return {
    service,
    vault,
    setSnapshot: (next: BookCatalogSnapshot) => {
      current = next;
    },
    rebuilds: () => rebuilds
  };
}

describe('diagnostics service', () => {
  it('covers all seven areas and classifies canonical identity, link, dependency, and schema evidence', async () => {
    const { service } = fixture([
      diagnostic(),
      diagnostic({ code: 'catalog.duplicate-id', field: 'pm-id' }),
      diagnostic({ code: 'catalog.unresolved-link', field: 'book-id' }),
      diagnostic({ code: 'catalog.invalid-task', field: 'dependencies' }),
      diagnostic({ code: 'catalog.unsupported-future-schema', field: 'pm-schema' })
    ]);
    const report = await service.report();
    expect(new Set(report.items.map(({ category }) => category))).toEqual(
      new Set([
        'schema',
        'identity',
        'links',
        'dependencies',
        'integrations',
        'migrations',
        'caches'
      ])
    );
    expect(report.items.find(({ id }) => id === 'caches:catalog')?.severity).toBe('clear');
    expect(
      report.items.some(({ category, action }) => category === 'schema' && action === 'open-source')
    ).toBe(true);
  });

  it('redacts canonical paths, identifiers, messages, and guidance by default', async () => {
    const { service } = fixture([diagnostic()]);
    const safe = await service.previewExport();
    expect(safe.redacted).toBe(true);
    expect(safe.content).not.toContain('private-title');
    expect(safe.content).not.toContain('pm-book-private-0001');
    expect(safe.content).not.toContain('Private title value');
    const explicit = await service.previewExport(false);
    expect(explicit.content).toContain('Publishing Manager/Books/private-title.md');
    expect(explicit.content).toContain('pm-book-private-0001');
  });

  it('redacts plugin-setting recovery paths and all free-form item prose by default', async () => {
    const recovery: StorageMovePreview = {
      operationId: 'private-operation',
      source: normalizeVaultPath('Private Author/Secret Publishing Root'),
      target: normalizeVaultPath('Private Press/Recovered Root'),
      sourceExists: true,
      sourcePaths: [normalizeVaultPath('Private Author/Secret Publishing Root/Books/secret.md')],
      targetExists: false,
      blockedReasons: [],
      consequences: ['Private free-form recovery consequence.']
    };
    const { service } = fixture([diagnostic()], recovery);
    expect(JSON.stringify(await service.report())).toContain(
      'Private Author/Secret Publishing Root'
    );
    const safe = await service.previewExport();
    for (const privateValue of [
      'Private Author',
      'Private Press',
      'secret.md',
      'Private title value',
      'replace the private title value'
    ])
      expect(safe.content).not.toContain(privateValue);
    expect(safe.redactions).toContain('Plugin-setting recovery paths');

    const explicit = await service.previewExport(false);
    expect(explicit.content).toContain('Private title value is invalid.');
  });

  it('creates one never-overwritten export and rejects stale evidence or a target race', async () => {
    const state = fixture([diagnostic()]);
    const first = await state.service.previewExport();
    await state.service.applyExport(first);
    expect(state.vault.files.get(first.target)).toBe(first.content);
    const suffixed = await state.service.previewExport();
    expect(suffixed.target).not.toBe(first.target);
    state.setSnapshot(snapshot([]));
    await expect(state.service.applyExport(suffixed)).rejects.toThrow('changed after preview');
  });

  it('previews a canonical-write-free rebuild and offers navigation without automatic patches', async () => {
    const state = fixture([diagnostic()]);
    const rebuild = await state.service.previewCacheRebuild();
    expect(rebuild.canonicalWrites).toBe(false);
    expect(rebuild.consequences.join(' ')).toContain(
      'Do not edit, repair, migrate, rename, or delete'
    );
    await state.service.applyCacheRebuild(rebuild);
    expect(state.rebuilds()).toBe(1);
    expect(state.vault.processCount).toBe(0);
    const report = await state.service.report();
    const issue = report.items.find(({ source }) => source === 'canonical-record');
    expect(issue).toBeDefined();
    const guidance = await state.service.previewRemediation(issue?.id ?? 'missing');
    expect(guidance.mode).toBe('guided-navigation');
    expect(guidance.canonicalWrites).toBe(false);
    expect(guidance.path).toBe(normalizeVaultPath('Publishing Manager/Books/private-title.md'));
  });
});
