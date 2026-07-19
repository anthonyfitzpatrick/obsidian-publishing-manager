/**
 * Defines one resource-exhaustion boundary for parsed YAML, imported JSON, and event data. These
 * checks run before feature hydration so a hostile shape cannot acquire domain or repository
 * authority merely because its outer record envelope looks valid.
 */

export interface UntrustedDataLimits {
  readonly maximumArrayItems: number;
  readonly maximumDepth: number;
  readonly maximumKeysPerObject: number;
  readonly maximumNodes: number;
  readonly maximumStringBytes: number;
  readonly maximumTotalBytes: number;
}

export interface UntrustedDataIssue {
  readonly code:
    | 'accessor'
    | 'cycle'
    | 'dangerous-key'
    | 'depth'
    | 'invalid-number'
    | 'key-count'
    | 'key-length'
    | 'list-size'
    | 'node-count'
    | 'prototype'
    | 'string-size'
    | 'total-size'
    | 'unsupported-value';
  readonly path: string;
  readonly message: string;
}

export const MANAGED_RECORD_DATA_LIMITS: UntrustedDataLimits = {
  maximumArrayItems: 1_000,
  maximumDepth: 20,
  maximumKeysPerObject: 1_000,
  maximumNodes: 20_000,
  maximumStringBytes: 32_768,
  maximumTotalBytes: 1_048_576
};

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Returns bounded diagnostics without invoking accessors or following cyclic references. */
export function inspectUntrustedData(
  value: unknown,
  limits: UntrustedDataLimits = MANAGED_RECORD_DATA_LIMITS
): readonly UntrustedDataIssue[] {
  const issues: UntrustedDataIssue[] = [];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let approximateBytes = 0;

  const add = (issue: UntrustedDataIssue): void => {
    if (issues.length < 20) issues.push(issue);
  };
  const visit = (candidate: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > limits.maximumNodes) {
      add({ code: 'node-count', path, message: 'Data contains too many values.' });
      return;
    }
    if (depth > limits.maximumDepth) {
      add({ code: 'depth', path, message: 'Data exceeds the maximum nesting depth.' });
      return;
    }
    if (candidate === null || typeof candidate === 'boolean') return;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate))
        add({ code: 'invalid-number', path, message: 'Numbers must be finite.' });
      return;
    }
    if (typeof candidate === 'string') {
      const bytes = utf8Bytes(candidate);
      approximateBytes += bytes;
      if (bytes > limits.maximumStringBytes)
        add({ code: 'string-size', path, message: 'Text exceeds the managed-data limit.' });
      return;
    }
    if (typeof candidate !== 'object') {
      add({ code: 'unsupported-value', path, message: 'Data contains an unsupported value type.' });
      return;
    }
    if (ancestors.has(candidate)) {
      add({ code: 'cycle', path, message: 'Data must not contain cyclic references.' });
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(candidate) as unknown;
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
      add({ code: 'prototype', path, message: 'Data must use plain objects and lists only.' });
      return;
    }
    ancestors.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > limits.maximumArrayItems)
        add({ code: 'list-size', path, message: 'List contains too many items.' });
      for (let index = 0; index < Math.min(candidate.length, limits.maximumArrayItems); index += 1)
        visit(candidate[index], `${path}[${index}]`, depth + 1);
      ancestors.delete(candidate);
      return;
    }

    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors);
    if (keys.length > limits.maximumKeysPerObject)
      add({ code: 'key-count', path, message: 'Object contains too many fields.' });
    for (const key of keys.slice(0, limits.maximumKeysPerObject)) {
      approximateBytes += utf8Bytes(key);
      const nextPath = path === '$' ? `$.${key}` : `${path}.${key}`;
      if (utf8Bytes(key) > 200)
        add({ code: 'key-length', path: nextPath, message: 'Field name is too long.' });
      if (DANGEROUS_KEYS.has(key))
        add({
          code: 'dangerous-key',
          path: nextPath,
          message: 'Prototype-related fields are forbidden.'
        });
      const descriptor = descriptors[key];
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        add({ code: 'accessor', path: nextPath, message: 'Accessor properties are forbidden.' });
        continue;
      }
      visit(descriptor?.value, nextPath, depth + 1);
    }
    ancestors.delete(candidate);
  };

  visit(value, '$', 0);
  if (approximateBytes > limits.maximumTotalBytes)
    add({ code: 'total-size', path: '$', message: 'Managed data exceeds the 1 MiB limit.' });
  return issues;
}

/** Accepts only absolute HTTP(S) URLs and strips credentials from the allowed surface. */
export function safeExternalHttpUrl(value: unknown, maximumBytes = 2_048): string | undefined {
  if (typeof value !== 'string' || utf8Bytes(value) > maximumBytes) return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
