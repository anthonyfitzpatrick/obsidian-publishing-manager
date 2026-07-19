/** Proves resource, prototype, accessor, cycle, and external-URI boundaries for hostile data. */
import { describe, expect, it } from 'vitest';
import {
  inspectUntrustedData,
  safeExternalHttpUrl
} from '../../src/domain/security/untrusted-data';

describe('untrusted data inspection', () => {
  it('accepts bounded plain JSON-like data', () => {
    expect(
      inspectUntrustedData({ title: 'Fictional title', nested: { list: [1, true, null] } })
    ).toEqual([]);
  });

  it('rejects cycles, accessors, dangerous keys, deep values, and oversized collections', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(inspectUntrustedData(cyclic).map(({ code }) => code)).toContain('cycle');

    const accessor = Object.defineProperty({}, 'secret', { get: () => 'value', enumerable: true });
    expect(inspectUntrustedData(accessor).map(({ code }) => code)).toContain('accessor');

    const dangerous = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(dangerous, '__proto__', { value: {}, enumerable: true });
    expect(inspectUntrustedData(dangerous).map(({ code }) => code)).toContain('dangerous-key');

    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 22; index += 1) deep = { nested: deep };
    expect(inspectUntrustedData(deep).map(({ code }) => code)).toContain('depth');
    expect(inspectUntrustedData(new Array(1_001).fill('x')).map(({ code }) => code)).toContain(
      'list-size'
    );
  });
});

describe('safe external HTTP URL', () => {
  it('allows bounded HTTP(S) without credentials', () => {
    expect(safeExternalHttpUrl('https://example.invalid/path')).toBe(
      'https://example.invalid/path'
    );
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///private/file',
    'https://user:secret@example.invalid/',
    `https://example.invalid/${'x'.repeat(2_100)}`
  ])('rejects unsafe external target %s', (value) => {
    expect(safeExternalHttpUrl(value)).toBeUndefined();
  });
});
