/**
 * Provides the only domain-approved way to construct managed vault paths. Obsidian paths are
 * forward-slash, vault-relative identifiers rather than operating-system paths. Rejecting
 * ambiguous input before it reaches an adapter prevents traversal, accidental absolute paths,
 * platform-dependent backslash behavior, and visually surprising whitespace collisions.
 */

/** Branded vault-relative path that has passed every DAT-003 safety check. */
export type VaultPath = string & { readonly __vaultPath: unique symbol };

/** Actionable failure returned when a path cannot safely identify one vault target. */
export class InvalidVaultPathError extends Error {
  /** Retains the rejected input and stable reason so diagnostics can be specific. */
  public constructor(
    public readonly input: string,
    public readonly reason:
      | 'absolute'
      | 'ambiguous-separator'
      | 'control-character'
      | 'dot-segment'
      | 'empty'
      | 'leading-or-trailing-whitespace'
      | 'path-too-long'
      | 'segment-too-long'
      | 'too-many-segments'
      | 'segment-whitespace'
      | 'uri-scheme'
      | 'windows-drive'
  ) {
    super(`Unsafe vault path (${reason}): ${JSON.stringify(input)}`);
    this.name = 'InvalidVaultPathError';
  }
}

/**
 * Normalizes Unicode to NFC while rejecting changes that could point at a different target.
 * The function intentionally rejects rather than repairs separators and dot segments because a
 * silent cleanup could turn malicious or mistaken input into a valid but unintended filename.
 */
export function normalizeVaultPath(input: string): VaultPath {
  if (input.length === 0) {
    throw new InvalidVaultPathError(input, 'empty');
  }
  if (input !== input.trim()) {
    throw new InvalidVaultPathError(input, 'leading-or-trailing-whitespace');
  }
  if (new TextEncoder().encode(input).byteLength > 1_024) {
    throw new InvalidVaultPathError(input, 'path-too-long');
  }
  if (input.startsWith('/') || input.startsWith('~')) {
    throw new InvalidVaultPathError(input, 'absolute');
  }
  if (/^[a-z]:/iu.test(input)) {
    throw new InvalidVaultPathError(input, 'windows-drive');
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(input)) {
    throw new InvalidVaultPathError(input, 'uri-scheme');
  }
  if (input.includes('\\') || input.includes('//')) {
    throw new InvalidVaultPathError(input, 'ambiguous-separator');
  }
  if (hasControlCharacter(input)) {
    throw new InvalidVaultPathError(input, 'control-character');
  }

  const segments = input.split('/');
  if (segments.length > 128) {
    throw new InvalidVaultPathError(input, 'too-many-segments');
  }
  if (segments.some((segment) => new TextEncoder().encode(segment).byteLength > 255)) {
    throw new InvalidVaultPathError(input, 'segment-too-long');
  }
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    throw new InvalidVaultPathError(input, 'dot-segment');
  }
  if (segments.some((segment) => segment !== segment.trim())) {
    throw new InvalidVaultPathError(input, 'segment-whitespace');
  }

  return input.normalize('NFC') as VaultPath;
}

/** Avoids control characters without embedding them in a regular expression rejected by lint. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

/** Joins already meaningful segments and validates the resulting target exactly once. */
export function joinVaultPath(...segments: readonly string[]): VaultPath {
  return normalizeVaultPath(segments.join('/'));
}

/** Returns the containing folder, or undefined when the file is at vault root. */
export function parentVaultPath(path: VaultPath): VaultPath | undefined {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? undefined : normalizeVaultPath(path.slice(0, separator));
}
