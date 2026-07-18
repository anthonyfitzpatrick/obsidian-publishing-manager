/**
 * Proves the EDN-001–EDN-005 vocabulary and conditional invariants without involving storage or
 * Obsidian. The cases cover every preset, the custom escape hatch, print/audio boundaries, real
 * publication dates, safe vault paths, and format accessibility metadata.
 */

import { describe, expect, it } from 'vitest';

import {
  EDITION_TYPES,
  defaultMediumFor,
  validateEditionFormat,
  validateEditionProject
} from '../../src/domain/editions/edition-project';

function validEdition(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    'book-id': 'pm-book-edition-domain-0001',
    type: 'paperback',
    medium: 'print',
    revision: 1,
    status: 'planned',
    'retail-links': {},
    'audio-metadata': {},
    ...overrides
  };
}

describe('edition project domain', () => {
  it('defines every planned preset and stable default media mapping', () => {
    expect(EDITION_TYPES).toEqual([
      'paperback',
      'hardcover',
      'ebook',
      'audiobook',
      'large-print',
      'special-edition',
      'collector-edition',
      'box-set',
      'custom'
    ]);
    expect(defaultMediumFor('paperback')).toBe('print');
    expect(defaultMediumFor('ebook')).toBe('digital');
    expect(defaultMediumFor('audiobook')).toBe('audio');
    expect(defaultMediumFor('box-set')).toBe('mixed');
    expect(defaultMediumFor('custom')).toBeUndefined();
  });

  it('accepts complete print details and rejects them on digital editions', () => {
    expect(
      validateEditionProject(
        validEdition({
          'publication-date': '2027-02-28',
          'trim-width': '5.5',
          'trim-height': '8.5',
          'trim-unit': 'in',
          'page-count': 320,
          cover: 'Publishing Assets/Covers/fictional-cover.pdf'
        })
      )
    ).toEqual([]);
    expect(
      validateEditionProject(
        validEdition({ type: 'ebook', medium: 'digital', 'page-count': 320 })
      ).map(({ code }) => code)
    ).toContain('edition.conditional-print-field');
  });

  it('requires a labelled custom type and validates audio-specific fields', () => {
    expect(
      validateEditionProject(validEdition({ type: 'custom', medium: 'audio' })).map(
        ({ code }) => code
      )
    ).toContain('edition.custom-label-required');
    expect(
      validateEditionProject(
        validEdition({
          type: 'custom',
          'custom-type': 'Dramatized audio',
          medium: 'audio',
          narrator: 'Fictional Narrator',
          'duration-minutes': 615,
          'audio-metadata': { channels: 'stereo', abridged: 'no' }
        })
      )
    ).toEqual([]);
  });

  it('rejects impossible dates, unsafe paths, and incomplete trim dimensions together', () => {
    const codes = validateEditionProject(
      validEdition({
        'publication-date': '2027-02-30',
        cover: '../outside-vault.pdf',
        'trim-width': '5.5'
      })
    ).map(({ code }) => code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'edition.invalid-date',
        'edition.invalid-cover',
        'edition.invalid-trim'
      ])
    );
  });

  it('validates one digital format with file and accessibility evidence', () => {
    expect(
      validateEditionFormat({
        'edition-id': 'pm-edition-domain-0001',
        category: 'digital',
        kind: 'epub',
        label: 'Accessible EPUB',
        'file-path': 'Publishing Assets/Exports/fictional-book.epub',
        accessibility: { 'conforms-to': 'EPUB Accessibility 1.1' },
        metadata: { profile: 'reflowable' }
      })
    ).toEqual([]);
    expect(
      validateEditionFormat({
        'edition-id': 'pm-edition-domain-0001',
        category: 'digital',
        kind: 'EPUB file',
        'file-path': '/absolute/file.epub',
        accessibility: [],
        metadata: {}
      }).map(({ code }) => code)
    ).toEqual(
      expect.arrayContaining([
        'format.invalid-kind',
        'format.invalid-path',
        'format.invalid-accessibility'
      ])
    );
  });
});
