/**
 * Persists operational journals as readable JSON inside Markdown notes using the Obsidian-only
 * text port. Journals intentionally use a separate `pm-operation-journal` marker rather than
 * impersonating user/domain records. A damaged journal is never silently reset because doing so
 * could repeat already-applied multi-record writes.
 */

import type {
  MarkdownFrontmatterCodec,
  VaultTextPort
} from '../../application/storage/record-storage-ports';
import type {
  OperationJournal,
  OperationJournalStore
} from '../../application/storage/operation-journal';
import { joinVaultPath, normalizeVaultPath, type VaultPath } from '../../domain/storage/vault-path';

/** Vault-backed durable journal store used by multi-record operations and migrations. */
export class VaultOperationJournalStore implements OperationJournalStore {
  private readonly folder: VaultPath;

  /** Validates the journal folder once and retains only platform-safe storage capabilities. */
  public constructor(
    folder: string,
    private readonly vault: VaultTextPort,
    private readonly codec: MarkdownFrontmatterCodec
  ) {
    this.folder = normalizeVaultPath(folder);
  }

  /** Loads a journal when present and rejects malformed content with recovery context intact. */
  public async load(id: string): Promise<OperationJournal | undefined> {
    const path = this.pathFor(id);
    if (!(await this.vault.exists(path))) {
      return undefined;
    }
    const document = this.codec.parse(await this.vault.read(path));
    if (document.frontmatter['pm-operation-journal'] !== true) {
      throw new Error(`Journal marker is missing at ${path}.`);
    }
    const parsed: unknown = JSON.parse(document.body);
    if (!isOperationJournal(parsed)) {
      throw new Error(`Journal content is invalid at ${path}; preserve it for recovery.`);
    }
    return parsed;
  }

  /** Creates or atomically replaces one journal snapshot after every runner checkpoint. */
  public async save(journal: OperationJournal): Promise<void> {
    const path = this.pathFor(journal.id);
    const source = this.codec.serialize({
      frontmatter: {
        'pm-operation-journal': true,
        'pm-journal-schema': 1,
        'pm-journal-state': journal.state,
        'pm-journal-updated': journal.updatedAt
      },
      body: JSON.stringify(journal, null, 2)
    });
    await this.vault.ensureFolder(this.folder);
    if (await this.vault.exists(path)) {
      await this.vault.process(path, () => source);
    } else {
      await this.vault.create(path, source);
    }
  }

  /** Journal IDs are restricted before becoming filenames to prevent path injection. */
  private pathFor(id: string): VaultPath {
    if (!/^[a-z0-9][a-z0-9-]{7,127}$/u.test(id)) {
      throw new Error('Journal ID must be a lowercase collision-resistant identifier.');
    }
    return joinVaultPath(this.folder, `${id}.md`);
  }
}

/** Structural guard protects recovery from arbitrary JSON parsed out of a damaged note. */
function isOperationJournal(value: unknown): value is OperationJournal {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<OperationJournal>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.operation === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.steps) &&
    ['completed', 'pending', 'recovery-required', 'running'].includes(candidate.state ?? '')
  );
}
