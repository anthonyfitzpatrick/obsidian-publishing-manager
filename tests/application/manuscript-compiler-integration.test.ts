/** Proves optional negotiation, explicit enablement, bounded requests, and stale/provider guards. */
import { describe, expect, it } from 'vitest';
import {
  COMPILER_CONTRACT,
  COMPILER_CONTRACT_VERSION,
  ManuscriptCompilerIntegrationService,
  type CompilerCapabilityTransport,
  type CompilerExportRequest
} from '../../src/application/integrations/manuscript-compiler-integration';
import {
  DEFAULT_PUBLISHING_SETTINGS,
  type PublishingManagerSettings
} from '../../src/application/settings/publishing-settings-service';
import type { BookCatalogSnapshot } from '../../src/domain/catalog/catalog-model';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T19:00:00.000Z');
  }
}
class FixedIds implements IdGenerator {
  public generate(): string {
    return 'correlation-0001';
  }
}
class MemoryTransport implements CompilerCapabilityTransport {
  public descriptors: unknown[] = [];
  public requests: CompilerExportRequest[] = [];
  public acknowledgement: unknown;
  private resultListener: ((payload: unknown) => void) | undefined;
  public async discover(): Promise<readonly unknown[]> {
    return structuredClone(this.descriptors);
  }
  public async request(payload: CompilerExportRequest): Promise<unknown> {
    this.requests.push(structuredClone(payload));
    return structuredClone(this.acknowledgement);
  }
  public subscribeResults(listener: (payload: unknown) => void): () => void {
    this.resultListener = listener;
    return () => {
      this.resultListener = undefined;
    };
  }
  public emitResult(payload: unknown): void {
    this.resultListener?.(structuredClone(payload));
  }
}

function descriptor(overrides: Record<string, unknown> = {}): unknown {
  return {
    contract: COMPILER_CONTRACT,
    contractVersion: COMPILER_CONTRACT_VERSION,
    providerId: 'manuscript-compiler',
    providerVersion: '1.0.0',
    supportedFormats: ['docx', 'epub', 'markdown'],
    requestMode: 'local-event',
    deliveryMode: 'host-download',
    ...overrides
  };
}

function snapshot(): BookCatalogSnapshot {
  return {
    availability: { state: 'ready' },
    books: [
      {
        path: normalizeVaultPath('Publishing Manager/Books/book.md'),
        id: 'pm-book-0001',
        type: 'book',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'book-r1',
        fields: {
          title: 'Private title',
          status: 'active',
          'primary-language': 'en',
          summary: 'Private prose'
        }
      }
    ],
    editions: [
      {
        path: normalizeVaultPath('Publishing Manager/Editions/edition.md'),
        id: 'pm-edition-0001',
        type: 'edition',
        schemaVersion: 1,
        archived: false,
        sourceRevision: 'edition-r1',
        fields: {
          'book-id': 'pm-book-0001',
          type: 'paperback',
          revision: 1,
          medium: 'print',
          status: 'active',
          notes: 'Private notes'
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
    tasks: [],
    launches: [],
    diagnostics: [],
    recentActivity: [],
    nextMilestone: { code: 'manage-editions', title: 'Manage editions', explanation: 'Test.' }
  };
}

function fixture() {
  const transport = new MemoryTransport();
  let settings = structuredClone(DEFAULT_PUBLISHING_SETTINGS);
  const service = new ManuscriptCompilerIntegrationService(
    { snapshot },
    {
      current: () => structuredClone(settings),
      saveSection: async (
        _section: 'integrations',
        candidate: PublishingManagerSettings['integrations']
      ) => {
        settings = { ...settings, integrations: structuredClone(candidate) };
        return structuredClone(candidate);
      }
    },
    transport,
    new FixedClock(),
    new FixedIds()
  );
  return { service, transport, settings: () => settings };
}

function result(correlationId: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    contract: COMPILER_CONTRACT,
    contractVersion: COMPILER_CONTRACT_VERSION,
    kind: 'export-result',
    correlationId,
    providerId: 'manuscript-compiler',
    compilerVersion: '1.0.0',
    compiledAt: '2026-07-19T19:01:00.000Z',
    bookId: 'pm-book-0001',
    editionId: 'pm-edition-0001',
    semanticFingerprint: 'sha256:source-current',
    sourceFingerprint: 'sha256:source-current',
    outputFingerprint: 'sha256:output-docx',
    format: 'docx',
    vaultPath: 'Books/Private/output.docx',
    warnings: ['Fictional warning.'],
    historyId: 'compiler-history-0001',
    ...overrides
  };
}

describe('Manuscript Compiler integration', () => {
  it('fails closed for absent, ambiguous, and incompatible providers', async () => {
    const state = fixture();
    await expect(state.service.negotiate()).resolves.toMatchObject({ state: 'absent' });
    state.transport.descriptors = [descriptor(), descriptor({ providerId: 'second' })];
    await expect(state.service.negotiate()).resolves.toMatchObject({ state: 'ambiguous' });
    state.transport.descriptors = [descriptor({ contractVersion: 2, supportedFormats: ['exe'] })];
    const incompatible = await state.service.negotiate();
    expect(incompatible.state).toBe('incompatible');
    if (incompatible.state === 'incompatible')
      expect(incompatible.reasons.join(' ')).toContain('Contract version');
  });

  it('requires explicit enablement and preserves unrelated integration preferences', async () => {
    const state = fixture();
    state.transport.descriptors = [descriptor()];
    await expect(state.service.negotiate()).resolves.toMatchObject({
      state: 'compatible',
      enabled: false
    });
    await expect(
      state.service.previewRequest({
        bookId: 'pm-book-0001',
        editionId: 'pm-edition-0001',
        formats: ['docx']
      })
    ).rejects.toThrow('Enable');
    await state.service.setEnabled(true);
    expect(state.settings().integrations.discloseExchangedFields).toBe(true);
    expect(state.settings().integrations.enabledCapabilities).toEqual(['manuscript-compiler']);
    await expect(state.service.negotiate()).resolves.toMatchObject({
      state: 'compatible',
      enabled: true
    });
  });

  it('previews only contract evidence and sends one matching correlation-ID request', async () => {
    const state = fixture();
    state.transport.descriptors = [descriptor()];
    await state.service.setEnabled(true);
    const preview = await state.service.previewRequest({
      bookId: 'pm-book-0001',
      editionId: 'pm-edition-0001',
      formats: ['docx', 'epub', 'docx']
    });
    expect(preview.request.correlationId).toBe('pm-compile-correlation-0001');
    expect(preview.request.formats).toEqual(['docx', 'epub']);
    const serialized = JSON.stringify(preview.request);
    expect(serialized).not.toContain('Private title');
    expect(serialized).not.toContain('Private prose');
    expect(serialized).not.toContain('Publishing Manager/');
    state.transport.acknowledgement = {
      contract: COMPILER_CONTRACT,
      contractVersion: 1,
      kind: 'request-accepted',
      correlationId: preview.request.correlationId,
      providerId: 'manuscript-compiler',
      message: 'Opened compiler workspace.'
    };
    await expect(state.service.applyRequest(preview)).resolves.toMatchObject({
      state: 'accepted',
      message: 'Opened compiler workspace.'
    });
    expect(state.transport.requests).toEqual([preview.request]);
  });

  it('rejects unsupported formats, unrelated editions, provider changes, and mismatched acknowledgements', async () => {
    const state = fixture();
    state.transport.descriptors = [descriptor()];
    await state.service.setEnabled(true);
    await expect(
      state.service.previewRequest({
        bookId: 'pm-book-0001',
        editionId: 'missing',
        formats: ['docx']
      })
    ).rejects.toThrow('edition');
    await expect(
      state.service.previewRequest({
        bookId: 'pm-book-0001',
        editionId: 'pm-edition-0001',
        formats: ['xml']
      })
    ).rejects.toThrow('does not support');
    const preview = await state.service.previewRequest({
      bookId: 'pm-book-0001',
      editionId: 'pm-edition-0001',
      formats: ['docx']
    });
    state.transport.descriptors = [descriptor({ providerVersion: '1.1.0' })];
    await expect(state.service.applyRequest(preview)).rejects.toThrow('changed after preview');
    state.transport.descriptors = [descriptor()];
    state.transport.acknowledgement = {
      contract: COMPILER_CONTRACT,
      contractVersion: 1,
      kind: 'request-accepted',
      correlationId: 'wrong',
      providerId: 'manuscript-compiler'
    };
    await expect(state.service.applyRequest(preview)).rejects.toThrow('does not match');
  });

  it('validates complete compiler evidence and derives current or stale from fingerprints', async () => {
    const state = fixture();
    state.transport.descriptors = [descriptor()];
    await state.service.setEnabled(true);
    const preview = await state.service.previewRequest({
      bookId: 'pm-book-0001',
      editionId: 'pm-edition-0001',
      formats: ['docx']
    });
    state.transport.acknowledgement = {
      contract: COMPILER_CONTRACT,
      contractVersion: 1,
      kind: 'request-accepted',
      correlationId: preview.request.correlationId,
      providerId: 'manuscript-compiler'
    };
    await state.service.applyRequest(preview);
    const current = await state.service.acceptResult(result(preview.request.correlationId));
    expect(current).toMatchObject({
      freshness: 'current',
      result: {
        compilerVersion: '1.0.0',
        compiledAt: '2026-07-19T19:01:00.000Z',
        semanticFingerprint: 'sha256:source-current',
        sourceFingerprint: 'sha256:source-current',
        outputFingerprint: 'sha256:output-docx',
        format: 'docx',
        vaultPath: 'Books/Private/output.docx',
        warnings: ['Fictional warning.'],
        historyId: 'compiler-history-0001'
      }
    });
    const stale = await state.service.acceptResult(
      result(preview.request.correlationId, {
        sourceFingerprint: 'sha256:older-source',
        historyId: 'compiler-history-0002'
      })
    );
    expect(stale.freshness).toBe('stale');
    expect(stale.freshnessExplanation).toContain('differs');
  });

  it('rejects uncorrelated, unsafe, incomplete, or out-of-scope result evidence', async () => {
    const state = fixture();
    state.transport.descriptors = [descriptor()];
    await state.service.setEnabled(true);
    await expect(state.service.acceptResult(result('unknown'))).rejects.toThrow('accepted');
    const preview = await state.service.previewRequest({
      bookId: 'pm-book-0001',
      editionId: 'pm-edition-0001',
      formats: ['docx']
    });
    state.transport.acknowledgement = {
      contract: COMPILER_CONTRACT,
      contractVersion: 1,
      kind: 'request-accepted',
      correlationId: preview.request.correlationId,
      providerId: 'manuscript-compiler'
    };
    await state.service.applyRequest(preview);
    await expect(
      state.service.acceptResult(
        result(preview.request.correlationId, { vaultPath: '../outside.docx' })
      )
    ).rejects.toThrow('safe vault-relative');
    await expect(
      state.service.acceptResult(result(preview.request.correlationId, { format: 'epub' }))
    ).rejects.toThrow('format');
    await expect(
      state.service.acceptResult(
        result(preview.request.correlationId, { compilerVersion: '2.0.0' })
      )
    ).rejects.toThrow('version');
    await expect(
      state.service.acceptResult(result(preview.request.correlationId, { warnings: 'not-a-list' }))
    ).rejects.toThrow('warnings');
  });
});
