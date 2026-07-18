/**
 * Protects DAT-004 through DAT-006 and the atomic/minimal portion of DAT-007. The in-memory port
 * proves behavior at the repository boundary: collision refusal, unknown-key/body preservation,
 * no-op writes, explicit field deletion, and conflict detection after an external vault edit.
 */

import { describe, expect, it } from 'vitest';

import type { ManagedRecordEnvelope } from '../../src/domain/records/record-envelope';
import { normalizeVaultPath } from '../../src/domain/storage/vault-path';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

const PATH = normalizeVaultPath('Publishing Manager/Books/fictional-book.md');
const ENVELOPE: ManagedRecordEnvelope = {
  pmId: 'pm-book-00000001',
  pmType: 'book',
  pmSchema: 1,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z'
};

describe('VaultManagedRecordRepository', () => {
  it('creates and loads a valid record without deriving identity from its filename', async () => {
    const { repository, vault } = setup();

    const loaded = await repository.create(PATH, {
      envelope: ENVELOPE,
      fields: validBookFields({ 'unknown-extension': { preserved: true } }),
      body: '# Human notes\nKeep this paragraph.\n'
    });

    expect(loaded.envelope.pmId).toBe('pm-book-00000001');
    expect(loaded.fields['unknown-extension']).toEqual({ preserved: true });
    expect(loaded.body).toBe('# Human notes\nKeep this paragraph.\n');
    expect(vault.folders).toContain('Publishing Manager/Books');
  });

  it('preserves unknown frontmatter and body while changing only explicit managed fields', async () => {
    const { repository } = setup();
    const created = await repository.create(PATH, {
      envelope: ENVELOPE,
      fields: validBookFields({
        'unknown-extension': 'retain me',
        removable: 'delete me'
      }),
      body: 'Unrelated human-authored body.\n'
    });

    const saved = await repository.save(
      created,
      {
        fields: {
          title: 'The Revised Fictional Meridian',
          removable: undefined
        }
      },
      '2026-07-18T13:00:00.000Z'
    );

    expect(saved.fields).toMatchObject({
      title: 'The Revised Fictional Meridian',
      'unknown-extension': 'retain me'
    });
    expect(saved.fields).not.toHaveProperty('removable');
    expect(saved.body).toBe('Unrelated human-authored body.\n');
    expect(saved.envelope.updatedAt).toBe('2026-07-18T13:00:00.000Z');
  });

  it('returns the original source for a semantic no-op instead of changing timestamps', async () => {
    const { repository, vault } = setup();
    const created = await repository.create(PATH, {
      envelope: ENVELOPE,
      fields: validBookFields()
    });

    const saved = await repository.save(
      created,
      { fields: { title: 'Fictional Book' } },
      '2099-01-01T00:00:00.000Z'
    );

    expect(saved.sourceRevision).toBe(created.sourceRevision);
    expect(saved.envelope.updatedAt).toBe(ENVELOPE.updatedAt);
    expect(vault.processCount).toBe(1);
    expect(vault.changedProcessCount).toBe(0);
  });

  it('blocks a stale save after an external edit instead of overwriting it', async () => {
    const { repository, vault, codec } = setup();
    const created = await repository.create(PATH, {
      envelope: ENVELOPE,
      fields: validBookFields(),
      body: 'Original body'
    });
    vault.replaceExternally(
      PATH,
      codec.serialize({
        frontmatter: {
          'pm-id': ENVELOPE.pmId,
          'pm-type': ENVELOPE.pmType,
          'pm-schema': ENVELOPE.pmSchema,
          'pm-created': ENVELOPE.createdAt,
          'pm-updated': '2026-07-18T12:30:00.000Z',
          ...validBookFields({ 'external-key': true })
        },
        body: 'Externally changed body'
      })
    );

    await expect(
      repository.save(created, { fields: { status: 'ready' } }, '2026-07-18T13:00:00.000Z')
    ).rejects.toMatchObject({ code: 'record-conflict' });
    expect(await vault.read(PATH)).toContain('Externally changed body');
  });

  it('refuses to create over an existing vault target', async () => {
    const { repository } = setup();
    await repository.create(PATH, {
      envelope: ENVELOPE,
      fields: validBookFields()
    });

    await expect(
      repository.create(PATH, {
        envelope: ENVELOPE,
        fields: validBookFields()
      })
    ).rejects.toMatchObject({ code: 'record-exists' });
  });
});

/** Adds optional unknown fields without weakening the canonical required book contract. */
function validBookFields(
  extensions: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    title: 'Fictional Book',
    status: 'active',
    'primary-language': 'en',
    ...extensions
  };
}

/** Creates isolated collaborators for each scenario so revisions cannot leak between tests. */
function setup(): {
  readonly codec: JsonTestFrontmatterCodec;
  readonly repository: VaultManagedRecordRepository;
  readonly vault: MemoryVaultTextPort;
} {
  const vault = new MemoryVaultTextPort();
  const codec = new JsonTestFrontmatterCodec();
  return {
    vault,
    codec,
    repository: new VaultManagedRecordRepository(vault, codec)
  };
}
