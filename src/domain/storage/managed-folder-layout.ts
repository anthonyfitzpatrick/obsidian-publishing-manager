/**
 * Converts configurable storage preferences into safe, predictable vault paths. Human-facing
 * titles never become identities; they are used only as readable filename hints. Collision
 * suffixes are deterministic so retries choose the same first available name without overwriting
 * existing user files.
 */

import type { ManagedRecordType } from '../records/record-types';
import { joinVaultPath, normalizeVaultPath, type VaultPath } from './vault-path';

/** Configurable root plus optional per-type folder overrides. */
export interface ManagedFolderLayoutOptions {
  readonly root: string;
  readonly folders?: Partial<Readonly<Record<ManagedRecordType, string>>>;
}

const DEFAULT_FOLDERS: Readonly<Record<ManagedRecordType, string>> = {
  series: 'Series',
  book: 'Books',
  edition: 'Editions',
  format: 'Formats',
  'platform-target': 'Platforms',
  'platform-profile': 'Platform Profiles',
  'readiness-override': 'Readiness Overrides',
  'metadata-set': 'Metadata',
  isbn: 'ISBN Pool',
  price: 'Prices',
  workflow: 'Workflows',
  task: 'Tasks',
  launch: 'Launches',
  review: 'Reviews',
  template: 'Templates',
  'asset-reference': 'Asset References',
  'history-event': 'History',
  'sales-source': 'Sales/Sources',
  'sales-line': 'Sales/Lines',
  'sales-correction': 'Sales/Corrections'
};

/** Resolves managed locations without performing I/O or deriving record identity from paths. */
export class ManagedFolderLayout {
  private readonly root: VaultPath;
  private readonly folders: Readonly<Record<ManagedRecordType, string>>;

  /** Validates the configured root and every type override before any path is requested. */
  public constructor(options: ManagedFolderLayoutOptions) {
    this.root = normalizeVaultPath(options.root);
    this.folders = { ...DEFAULT_FOLDERS, ...options.folders };

    // Validate every override at construction so an invalid preference cannot fail halfway
    // through a later create or migration operation.
    for (const folder of Object.values(this.folders)) {
      normalizeVaultPath(folder);
    }
  }

  /** Returns the safe folder assigned to a record type. */
  public folderFor(type: ManagedRecordType): VaultPath {
    return joinVaultPath(this.root, this.folders[type]);
  }

  /** Exposes the validated managed root for catalog scanning and event filtering. */
  public rootPath(): VaultPath {
    return this.root;
  }

  /**
   * Chooses a readable Markdown filename that cannot overwrite any known existing path. The
   * caller supplies the existing set from its repository/index so this domain service remains
   * platform-independent and testable.
   */
  public collisionSafePath(
    type: ManagedRecordType,
    title: string,
    existingPaths: ReadonlySet<string>
  ): VaultPath {
    const slug = slugifyTitle(title);
    const folder = this.folderFor(type);
    let suffix = 1;
    let candidate = joinVaultPath(folder, `${slug}.md`);
    while (existingPaths.has(candidate)) {
      suffix += 1;
      candidate = joinVaultPath(folder, `${slug}-${suffix}.md`);
    }
    return candidate;
  }
}

/** Keeps filenames portable and readable while providing a stable fallback for punctuation-only titles. */
function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return slug.length === 0 ? 'untitled-record' : slug;
}
