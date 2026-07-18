/**
 * Shared deterministic doubles for storage tests. They model the exact application ports rather
 * than Obsidian internals, allowing repository behavior to be proven without a real vault or Node
 * filesystem. The JSON-frontmatter syntax is test-only; production uses Obsidian's YAML codec.
 */

import type {
  MarkdownFrontmatterCodec,
  ParsedMarkdownDocument,
  VaultTextPort
} from '../src/application/storage/record-storage-ports';
import type { VaultPath } from '../src/domain/storage/vault-path';

/** Deterministic codec that preserves arbitrary structured values and body bytes. */
export class JsonTestFrontmatterCodec implements MarkdownFrontmatterCodec {
  public parse(source: string): ParsedMarkdownDocument {
    const separator = source.indexOf('\n---\n');
    if (!source.startsWith('---json\n') || separator < 0) {
      throw new Error('Invalid test frontmatter document.');
    }
    const parsed: unknown = JSON.parse(source.slice('---json\n'.length, separator));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Test frontmatter must be an object.');
    }
    return {
      frontmatter: parsed as Readonly<Record<string, unknown>>,
      body: source.slice(separator + '\n---\n'.length)
    };
  }

  public serialize(document: ParsedMarkdownDocument): string {
    return `---json\n${JSON.stringify(document.frontmatter)}\n---\n${document.body}`;
  }
}

/** In-memory atomic text port with counters that prove minimal-write behavior. */
export class MemoryVaultTextPort implements VaultTextPort {
  public readonly files = new Map<VaultPath, string>();
  public readonly folders = new Set<VaultPath>();
  public processCount = 0;
  public changedProcessCount = 0;

  public async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  public async read(path: VaultPath): Promise<string> {
    const source = this.files.get(path);
    if (source === undefined) {
      throw new Error(`Missing test file ${path}.`);
    }
    return source;
  }

  public async create(path: VaultPath, source: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`Test file already exists at ${path}.`);
    }
    this.files.set(path, source);
  }

  public async process(path: VaultPath, transform: (current: string) => string): Promise<string> {
    const current = await this.read(path);
    this.processCount += 1;
    const next = transform(current);
    if (next !== current) {
      this.changedProcessCount += 1;
      this.files.set(path, next);
    }
    return next;
  }

  public async ensureFolder(path: VaultPath): Promise<void> {
    this.folders.add(path);
  }

  /** Simulates a user or another plugin changing the note outside the repository transaction. */
  public replaceExternally(path: VaultPath, source: string): void {
    this.files.set(path, source);
  }
}
