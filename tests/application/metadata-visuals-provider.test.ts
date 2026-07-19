/** Proves the Metadata Visuals provider is versioned, bounded, normalized, and read-only. */
import { describe, expect, it } from 'vitest';
import {
  METADATA_VISUALS_CAPABILITY_ID,
  METADATA_VISUALS_CONTRACT,
  METADATA_VISUALS_CONTRACT_VERSION,
  MetadataVisualsProviderService
} from '../../src/application/integrations/metadata-visuals-provider';
import {
  DEFAULT_PUBLISHING_SETTINGS,
  type PublishingManagerSettings
} from '../../src/application/settings/publishing-settings-service';
import type { BookCatalogSnapshot } from '../../src/domain/catalog/catalog-model';
import type { Clock } from '../../src/domain/foundation/clock';
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
          notes: 'Private book notes.'
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
    formats: [],
    assets: [],
    metadataSets: [],
    isbns: [],
    prices: [],
    platformProfiles: [],
    platformTargets: [],
    workflows: [],
    tasks: [
      {
        path: normalizeVaultPath('Publishing Manager/Tasks/private.md'),
        id: 'pm-task-private-0001',
        type: 'task',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'task-r1',
        fields: { title: 'Private task free text' }
      }
    ],
    launches: [],
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

function fixture(enabled: boolean) {
  let settings: PublishingManagerSettings = structuredClone(DEFAULT_PUBLISHING_SETTINGS);
  if (enabled)
    settings = {
      ...settings,
      integrations: {
        ...settings.integrations,
        enabledCapabilities: [METADATA_VISUALS_CAPABILITY_ID]
      }
    };
  const service = new MetadataVisualsProviderService(
    { snapshot },
    { current: () => structuredClone(settings) },
    new FixedClock(),
    '0.1.0'
  );
  return { service };
}

describe('Metadata Visuals provider', () => {
  it('advertises an explicit read-only v1 descriptor and current enablement', () => {
    expect(fixture(false).service.descriptor()).toMatchObject({
      contract: METADATA_VISUALS_CONTRACT,
      contractVersion: 1,
      providerId: 'publishing-manager',
      providerVersion: '0.1.0',
      access: 'read-only',
      mode: 'local-event',
      enabled: false,
      capabilities: ['catalog-summary', 'book-snapshot', 'edition-snapshot']
    });
    expect(fixture(true).service.descriptor().enabled).toBe(true);
  });

  it('returns no catalog data while disabled and rejects malformed consumer requests', () => {
    expect(fixture(false).service.handle(request('catalog-summary-request'))).toMatchObject({
      kind: 'provider-error',
      code: 'disabled'
    });
    expect(
      fixture(true).service.handle(
        request('catalog-summary-request', { contractVersion: 2, consumerVersion: 'bad' })
      )
    ).toMatchObject({ kind: 'provider-error', code: 'invalid-request' });
  });

  it('exposes one bounded normalized catalog summary without paths or private fields', () => {
    const response = fixture(true).service.handle(request('catalog-summary-request'));
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

  it('returns on-demand book or edition snapshots and fails closed for unrelated IDs', () => {
    const service = fixture(true).service;
    const book = service.handle(
      request('book-snapshot-request', { bookId: 'pm-book-visual-0001' })
    );
    expect(book).toMatchObject({
      kind: 'book-snapshot',
      book: { id: 'pm-book-visual-0001', title: 'Fictional Visible Title' },
      editions: [{ id: 'pm-edition-visual-0001', bookId: 'pm-book-visual-0001' }]
    });
    const edition = service.handle(
      request('edition-snapshot-request', {
        bookId: 'pm-book-visual-0001',
        editionId: 'pm-edition-visual-0001'
      })
    );
    expect(edition).toMatchObject({
      kind: 'edition-snapshot',
      editions: [{ id: 'pm-edition-visual-0001', type: 'paperback', medium: 'print' }]
    });
    expect(
      service.handle(
        request('edition-snapshot-request', {
          bookId: 'pm-book-visual-0001',
          editionId: 'wrong'
        })
      )
    ).toMatchObject({ kind: 'provider-error', code: 'not-found' });
  });
});
