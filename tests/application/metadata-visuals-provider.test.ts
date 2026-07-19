/** Proves the Metadata Visuals provider is versioned, bounded, normalized, and read-only. */
import { describe, expect, it } from 'vitest';
import {
  METADATA_VISUALS_CAPABILITY_ID,
  METADATA_VISUALS_CONTRACT,
  METADATA_VISUALS_CONTRACT_VERSION,
  MetadataVisualsProviderService,
  projectMetadataForVisuals,
  resolvePublishingManagerDeepLink
} from '../../src/application/integrations/metadata-visuals-provider';
import {
  DEFAULT_PUBLISHING_SETTINGS,
  METADATA_VISUALS_OPTIONAL_FIELD_GROUPS,
  type MetadataVisualsOptionalFieldGroup,
  type PublishingManagerSettings
} from '../../src/application/settings/publishing-settings-service';
import type { BookCatalogSnapshot } from '../../src/domain/catalog/catalog-model';
import type { Clock } from '../../src/domain/foundation/clock';
import {
  METADATA_COMPLETENESS_PROFILES,
  assessMetadataCompleteness,
  resolveEffectiveMetadata
} from '../../src/domain/metadata/metadata-set';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T20:00:00.000Z');
  }
}

function snapshot(): BookCatalogSnapshot {
  return {
    availability: { state: 'ready' },
    books: [
      {
        path: normalizeVaultPath('Publishing Manager/Books/secret.md'),
        id: 'pm-book-visual-0001',
        type: 'book',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'book-source-r1',
        fields: {
          title: 'Fictional Visible Title',
          status: 'active',
          'primary-language': 'en',
          summary: 'Private summary must not cross the contract.',
          notes: 'Private book notes.',
          history: { detail: 'detailed-history-secret' }
        }
      }
    ],
    editions: [
      {
        path: normalizeVaultPath('Publishing Manager/Editions/secret.md'),
        id: 'pm-edition-visual-0001',
        type: 'edition',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'edition-source-r1',
        fields: {
          'book-id': 'pm-book-visual-0001',
          type: 'paperback',
          medium: 'print',
          status: 'active',
          revision: 1,
          notes: 'Private edition notes.'
        }
      }
    ],
    formats: [
      {
        path: normalizeVaultPath('Publishing Manager/Formats/format.md'),
        id: 'pm-format-visual-0001',
        type: 'format',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'format-r1',
        fields: { 'edition-id': 'pm-edition-visual-0001', type: 'print-interior-pdf' }
      }
    ],
    assets: [
      {
        path: normalizeVaultPath('Publishing Manager/Assets/private.md'),
        id: 'pm-asset-private-0001',
        type: 'asset-reference',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'asset-r1',
        fields: {
          'book-id': 'pm-book-visual-0001',
          content: 'PRIVATE_ASSET_BYTES_MUST_NOT_CROSS'
        }
      }
    ],
    metadataSets: [
      {
        path: normalizeVaultPath('Publishing Manager/Metadata/set.md'),
        id: 'pm-metadata-visual-0001',
        type: 'metadata-set',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'metadata-r1',
        fields: { 'book-id': 'pm-book-visual-0001', scope: 'book' }
      }
    ],
    isbns: [
      {
        path: normalizeVaultPath('Publishing Manager/ISBNs/isbn.md'),
        id: 'pm-isbn-visual-0001',
        type: 'isbn',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'isbn-r1',
        fields: { 'edition-id': 'pm-edition-visual-0001' }
      }
    ],
    prices: [],
    platformProfiles: [],
    platformTargets: [],
    workflows: [
      {
        path: normalizeVaultPath('Publishing Manager/Workflows/workflow.md'),
        id: 'pm-workflow-visual-0001',
        type: 'workflow',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'workflow-r1',
        fields: {
          'book-id': 'pm-book-visual-0001',
          stages: {
            items: [{ id: 'stage-proof', category: 'proofreading', notes: 'PRIVATE_STAGE_NOTES' }]
          }
        }
      }
    ],
    tasks: [
      {
        path: normalizeVaultPath('Publishing Manager/Tasks/private.md'),
        id: 'pm-task-private-0001',
        type: 'task',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'task-r1',
        fields: {
          'book-id': 'pm-book-visual-0001',
          'workflow-id': 'pm-workflow-visual-0001',
          'stage-id': 'stage-proof',
          status: 'active',
          title: 'Private task free text',
          notes: 'PRIVATE_TASK_NOTES',
          checklist: { items: [{ text: 'PRIVATE_CHECKLIST_TEXT' }] }
        }
      }
    ],
    launches: [
      {
        path: normalizeVaultPath('Publishing Manager/Launches/launch.md'),
        id: 'pm-launch-visual-0001',
        type: 'launch',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'launch-r1',
        fields: { 'book-id': 'pm-book-visual-0001', 'publication-date': '2026-08-01' }
      }
    ],
    diagnostics: [],
    recentActivity: [],
    nextMilestone: { code: 'manage-editions', title: 'Manage editions', explanation: 'Test.' }
  };
}

function request(
  kind: 'catalog-summary-request' | 'book-snapshot-request' | 'edition-snapshot-request',
  extra: Record<string, unknown> = {}
): unknown {
  return {
    contract: METADATA_VISUALS_CONTRACT,
    contractVersion: METADATA_VISUALS_CONTRACT_VERSION,
    kind,
    correlationId: 'mv-query-0001',
    consumerId: 'metadata-visuals',
    consumerVersion: '0.1.3',
    ...extra
  };
}

function fixture(
  enabled: boolean,
  readinessRejects = false,
  fieldGroups: readonly MetadataVisualsOptionalFieldGroup[] = METADATA_VISUALS_OPTIONAL_FIELD_GROUPS
) {
  const calls = { metadata: 0, readiness: 0, dates: 0 };
  let settings: PublishingManagerSettings = structuredClone(DEFAULT_PUBLISHING_SETTINGS);
  settings = {
    ...settings,
    integrations: {
      ...settings.integrations,
      enabledCapabilities: enabled ? [METADATA_VISUALS_CAPABILITY_ID] : [],
      metadataVisualsFieldGroups: fieldGroups
    }
  };
  const service = new MetadataVisualsProviderService(
    { snapshot },
    { current: () => structuredClone(settings) },
    new FixedClock(),
    '0.1.0',
    {
      resolve: (_bookId, editionId) => {
        calls.metadata += 1;
        return {
          profileId: editionId === undefined ? 'core-book' : 'print-general',
          profileVersion: 1,
          completeness: {
            complete: false,
            present: 4,
            required: 6,
            percent: 67,
            missing: ['copyright', 'contributors']
          },
          fields: [
            { key: 'title', source: 'book' as const, value: 'Fictional Visible Title' },
            {
              key: 'language',
              source: editionId === undefined ? ('book' as const) : ('edition' as const),
              value: 'en'
            }
          ]
        };
      }
    },
    {
      evaluate: async (_bookId, editionId) => {
        calls.readiness += 1;
        if (readinessRejects) throw new Error('PRIVATE_READINESS_FAILURE_DETAIL');
        return {
          rulePackCode: 'core-readiness',
          rulePackVersion: 1,
          evaluatedAt: '2026-07-19T20:00:00.000Z',
          state: editionId === undefined ? ('attention' as const) : ('not-ready' as const),
          score: 67,
          confidence: 100,
          rules: [
            { code: 'metadata.complete', state: 'fail' as const, severity: 'required' as const }
          ]
        };
      }
    },
    {
      events: () => {
        calls.dates += 1;
        return [
          { kind: 'launch', date: '2026-08-01', entityId: 'pm-launch-visual-0001' },
          { kind: 'task', date: '2026-07-20', entityId: 'pm-task-private-0001' }
        ];
      }
    }
  );
  return {
    calls,
    service,
    setEnabled: (enabledNow: boolean) => {
      settings = {
        ...settings,
        integrations: {
          ...settings.integrations,
          enabledCapabilities: enabledNow ? [METADATA_VISUALS_CAPABILITY_ID] : []
        }
      };
    }
  };
}

describe('Metadata Visuals provider', () => {
  it('advertises an explicit read-only v1 descriptor and current enablement', () => {
    const descriptor = fixture(false).service.descriptor();
    expect(descriptor).toMatchObject({
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: 1,
      providerId: 'publishing-manager',
      providerVersion: '0.1.0',
      access: 'read-only',
      mode: 'local-event',
      enabled: false,
      capabilities: ['catalog-summary', 'book-snapshot', 'edition-snapshot']
    });
    expect(descriptor.fieldGroups.find(({ id }) => id === 'identity')).toMatchObject({
      optional: false,
      enabled: true
    });
    expect(descriptor.fieldGroups.find(({ id }) => id === 'readiness')).toMatchObject({
      optional: true,
      enabled: true
    });
    expect(fixture(true).service.descriptor().enabled).toBe(true);
  });

  it('returns no catalog data while disabled and rejects malformed consumer requests', async () => {
    await expect(
      fixture(false).service.handle(request('catalog-summary-request'))
    ).resolves.toMatchObject({
      kind: 'provider-error',
      code: 'disabled'
    });
    await expect(
      fixture(true).service.handle(
        request('catalog-summary-request', { contractVersion: 2, consumerVersion: 'bad' })
      )
    ).resolves.toMatchObject({ kind: 'provider-error', code: 'invalid-request' });
    await expect(
      fixture(true).service.handle(
        request('catalog-summary-request', { padding: 'x'.repeat(5_000) })
      )
    ).resolves.toMatchObject({ kind: 'provider-error', code: 'invalid-request' });
    const cyclic = request('catalog-summary-request') as Record<string, unknown>;
    cyclic.self = cyclic;
    await expect(fixture(true).service.handle(cyclic)).resolves.toMatchObject({
      kind: 'provider-error',
      code: 'invalid-request'
    });
  });

  it('exposes one bounded normalized catalog summary without paths or private fields', async () => {
    const response = await fixture(true).service.handle(request('catalog-summary-request'));
    expect(response).toMatchObject({
      kind: 'catalog-summary',
      generatedAt: '2026-07-19T20:00:00.000Z',
      provenance: 'publishing-manager-derived-catalog',
      totals: { books: 1, editions: 1, activeBooks: 1, archivedBooks: 0 },
      books: [
        {
          id: 'pm-book-visual-0001',
          title: 'Fictional Visible Title',
          status: 'active',
          editionCount: 1
        }
      ]
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('Publishing Manager/');
    expect(serialized).not.toContain('Private summary');
    expect(serialized).not.toContain('Private task');
  });

  it('returns operational groups without asset, prose, or history details', async () => {
    const service = fixture(true).service;
    const book = await service.handle(
      request('book-snapshot-request', { bookId: 'pm-book-visual-0001' })
    );
    expect(book).toMatchObject({
      kind: 'book-snapshot',
      schemaVersion: 2,
      book: { id: 'pm-book-visual-0001', title: 'Fictional Visible Title' },
      editions: [{ id: 'pm-edition-visual-0001', bookId: 'pm-book-visual-0001' }],
      deepLink: {
        action: 'publishing-manager',
        route: 'book-workspace',
        bookId: 'pm-book-visual-0001',
        tab: 'overview',
        uri: 'obsidian://publishing-manager?route=book-workspace&bookId=pm-book-visual-0001&tab=overview'
      },
      operational: {
        scope: { kind: 'book', id: 'pm-book-visual-0001' },
        effectiveMetadata: {
          profileId: 'core-book',
          completeness: { percent: 67, missing: ['copyright', 'contributors'] }
        },
        relationships: {
          formatIds: ['pm-format-visual-0001'],
          metadataSetIds: ['pm-metadata-visual-0001'],
          isbnIds: ['pm-isbn-visual-0001'],
          workflowIds: ['pm-workflow-visual-0001'],
          launchIds: ['pm-launch-visual-0001']
        },
        workflowCategories: [
          { category: 'proofreading', stages: 1, tasks: { total: 1, active: 1 } }
        ],
        dates: [
          { kind: 'launch', date: '2026-08-01' },
          { kind: 'task', date: '2026-07-20' }
        ],
        readiness: { state: 'attention', rules: [{ code: 'metadata.complete', state: 'fail' }] }
      }
    });
    const serialized = JSON.stringify(book);
    for (const secret of [
      'PRIVATE_ASSET_BYTES_MUST_NOT_CROSS',
      'Private book notes',
      'Private task free text',
      'PRIVATE_TASK_NOTES',
      'PRIVATE_CHECKLIST_TEXT',
      'PRIVATE_STAGE_NOTES',
      'detailed-history-secret',
      'Publishing Manager/'
    ])
      expect(serialized).not.toContain(secret);
  });

  it('returns edition operational scope and fails closed for unrelated IDs', async () => {
    const service = fixture(true).service;
    const edition = await service.handle(
      request('edition-snapshot-request', {
        bookId: 'pm-book-visual-0001',
        editionId: 'pm-edition-visual-0001'
      })
    );
    expect(edition).toMatchObject({
      kind: 'edition-snapshot',
      editions: [{ id: 'pm-edition-visual-0001', type: 'paperback', medium: 'print' }],
      operational: {
        scope: { kind: 'edition', id: 'pm-edition-visual-0001' },
        effectiveMetadata: { profileId: 'print-general' },
        readiness: { state: 'not-ready' }
      }
    });
    await expect(
      service.handle(
        request('edition-snapshot-request', {
          bookId: 'pm-book-visual-0001',
          editionId: 'wrong'
        })
      )
    ).resolves.toMatchObject({ kind: 'provider-error', code: 'not-found' });
  });

  it('allowlists effective metadata and withholds description prose', () => {
    const effective = resolveEffectiveMetadata(
      {
        title: 'Public title',
        language: 'en',
        publisher: 'Public publisher',
        copyright: 'Copyright notice',
        contributors: [{ name: 'Public author', role: 'Author' }],
        'long-description-markdown': 'PRIVATE_LONG_DESCRIPTION_PROSE',
        'short-description-markdown': 'PRIVATE_SHORT_DESCRIPTION_PROSE'
      },
      { subtitle: 'Edition subtitle' }
    );
    const profile = METADATA_COMPLETENESS_PROFILES.find(({ id }) => id === 'core-book')!;
    const projection = projectMetadataForVisuals({
      effective,
      profile,
      coverage: assessMetadataCompleteness(effective, profile)
    });
    expect(projection.fields).toEqual(
      expect.arrayContaining([
        { key: 'title', source: 'book', value: 'Public title' },
        { key: 'subtitle', source: 'edition', value: 'Edition subtitle' }
      ])
    );
    expect(JSON.stringify(projection)).not.toContain('DESCRIPTION_PROSE');
  });

  it('redacts source-service failures into one bounded unavailable result', async () => {
    const response = await fixture(true, true).service.handle(
      request('book-snapshot-request', { bookId: 'pm-book-visual-0001' })
    );
    expect(response).toMatchObject({ kind: 'provider-error', code: 'projection-unavailable' });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_READINESS_FAILURE_DETAIL');
  });

  it('omits disabled field groups and never calls their source adapters', async () => {
    const state = fixture(true, false, ['relationships']);
    const response = await state.service.handle(
      request('book-snapshot-request', { bookId: 'pm-book-visual-0001' })
    );
    expect(response).toMatchObject({
      kind: 'book-snapshot',
      operational: {
        enabledFieldGroups: ['relationships'],
        relationships: { bookId: 'pm-book-visual-0001' }
      }
    });
    const operational = (response as { operational: Record<string, unknown> }).operational;
    expect(operational).not.toHaveProperty('effectiveMetadata');
    expect(operational).not.toHaveProperty('workflowCategories');
    expect(operational).not.toHaveProperty('dates');
    expect(operational).not.toHaveProperty('readiness');
    expect(state.calls).toEqual({ metadata: 0, readiness: 0, dates: 0 });
    expect(
      state.service.descriptor().fieldGroups.find(({ id }) => id === 'readiness')?.enabled
    ).toBe(false);
  });

  it('resolves generated deep links as navigation only and rejects smuggled commands', async () => {
    const response = await fixture(true).service.handle(
      request('edition-snapshot-request', {
        bookId: 'pm-book-visual-0001',
        editionId: 'pm-edition-visual-0001'
      })
    );
    const link = (response as { deepLink: { uri: string } }).deepLink;
    expect(link.uri).toBe(
      'obsidian://publishing-manager?route=book-workspace&bookId=pm-book-visual-0001&tab=editions&editionId=pm-edition-visual-0001'
    );
    expect(
      resolvePublishingManagerDeepLink(
        {
          route: 'book-workspace',
          bookId: 'pm-book-visual-0001',
          editionId: 'pm-edition-visual-0001',
          tab: 'editions'
        },
        snapshot()
      )
    ).toEqual({
      bookId: 'pm-book-visual-0001',
      editionId: 'pm-edition-visual-0001',
      tab: 'editions'
    });
    expect(
      resolvePublishingManagerDeepLink(
        {
          route: 'book-workspace',
          bookId: 'pm-book-visual-0001',
          tab: 'overview',
          delete: 'all'
        },
        snapshot()
      )
    ).toBeUndefined();
  });

  it('re-evaluates access on every request and stops projection immediately when disabled', async () => {
    const state = fixture(true);
    await expect(
      state.service.handle(request('book-snapshot-request', { bookId: 'pm-book-visual-0001' }))
    ).resolves.toMatchObject({ kind: 'book-snapshot' });
    expect(state.calls.metadata).toBe(1);
    state.setEnabled(false);
    expect(state.service.descriptor().enabled).toBe(false);
    await expect(
      state.service.handle(request('book-snapshot-request', { bookId: 'pm-book-visual-0001' }))
    ).resolves.toMatchObject({ kind: 'provider-error', code: 'disabled' });
    expect(state.calls.metadata).toBe(1);
  });
});
