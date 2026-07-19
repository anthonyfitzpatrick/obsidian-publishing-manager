/**
 * Adapts canonical Markdown/frontmatter to Obsidian's supported YAML helpers. The adapter owns
 * only the managed frontmatter block: the unrelated Markdown body is sliced from the original
 * source and returned unchanged. YAML comments/order may be normalized by Obsidian on a real
 * managed write, but every unknown key and value survives the structural merge.
 */

import { parseYaml, stringifyYaml } from 'obsidian';

import type {
  MarkdownFrontmatterCodec,
  ParsedMarkdownDocument
} from '../../application/storage/record-storage-ports';
import { inspectUntrustedData } from '../../domain/security/untrusted-data';

export const MAXIMUM_MANAGED_MARKDOWN_BYTES = 4_194_304;
export const MAXIMUM_MANAGED_FRONTMATTER_BYTES = 1_048_576;

/** Raised when a candidate note has no canonical frontmatter block or contains non-object YAML. */
export class InvalidFrontmatterDocumentError extends Error {
  /** Creates an actionable parse failure without including private note content. */
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidFrontmatterDocumentError';
  }
}

/** Production codec using Obsidian's browser/mobile-compatible YAML implementation. */
export class ObsidianFrontmatterCodec implements MarkdownFrontmatterCodec {
  /** Splits the first frontmatter block without trimming or otherwise changing body content. */
  public parse(source: string): ParsedMarkdownDocument {
    if (new TextEncoder().encode(source).byteLength > MAXIMUM_MANAGED_MARKDOWN_BYTES)
      throw new InvalidFrontmatterDocumentError('Managed record exceeds the 4 MiB Markdown limit.');
    const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
    if (match === null) {
      throw new InvalidFrontmatterDocumentError(
        'Managed record must begin with a complete YAML frontmatter block.'
      );
    }

    const yaml = match[1] ?? '';
    if (new TextEncoder().encode(yaml).byteLength > MAXIMUM_MANAGED_FRONTMATTER_BYTES)
      throw new InvalidFrontmatterDocumentError(
        'Managed record frontmatter exceeds the 1 MiB limit.'
      );
    const parsed: unknown = parseYaml(yaml);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InvalidFrontmatterDocumentError(
        'Managed record frontmatter must parse to a key/value object.'
      );
    }
    const shapeIssues = inspectUntrustedData(parsed);
    if (shapeIssues.length > 0)
      throw new InvalidFrontmatterDocumentError(
        `Managed record frontmatter is unsafe: ${shapeIssues[0]?.message ?? 'unsupported data shape.'}`
      );

    return {
      frontmatter: parsed as Readonly<Record<string, unknown>>,
      body: source.slice(match[0].length)
    };
  }

  /** Serializes through Obsidian and appends the caller-owned body byte-for-byte. */
  public serialize(document: ParsedMarkdownDocument): string {
    const yaml = stringifyYaml(document.frontmatter);
    const terminatedYaml = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
    return `---\n${terminatedYaml}---\n${document.body}`;
  }
}
