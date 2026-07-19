/**
 * Protects MET-001–MET-006 as deterministic domain behavior. The cases prove structured
 * validation, field-by-field edition provenance, inheritance restoration, profile coverage, and
 * Markdown-to-text export without requiring Obsidian or current retailer rules.
 */
import { describe, expect, it } from 'vitest';

import {
  METADATA_COMPLETENESS_PROFILES,
  assessMetadataCompleteness,
  clearMetadataOverride,
  descriptionMarkdownToPlainText,
  resolveEffectiveMetadata,
  validateMetadataValues
} from '../../src/domain/metadata/metadata-set';

describe('metadata set domain', () => {
  it('validates codes, contributors, reading age, and returns all defects', () => {
    const diagnostics = validateMetadataValues({
      title: ' Valid title ',
      'bisac-codes': ['bad'],
      'thema-codes': ['?'],
      contributors: [{ name: '', role: 'Author' }],
      'reading-age-min': 18,
      'reading-age-max': 12
    });
    expect(diagnostics.map(({ field }) => field)).toEqual(
      expect.arrayContaining([
        'title',
        'bisac-codes',
        'thema-codes',
        'contributors',
        'reading-age-max'
      ])
    );
  });

  it('resolves exact provenance and restores inheritance when an override is removed', () => {
    const book = { title: 'Book title', subtitle: 'Book subtitle', language: 'en' };
    const edition = { subtitle: 'Large-print subtitle' };
    const effective = resolveEffectiveMetadata(book, edition);
    expect(effective.fields.subtitle).toMatchObject({
      value: 'Large-print subtitle',
      source: 'edition'
    });
    const restored = resolveEffectiveMetadata(book, clearMetadataOverride(edition, 'subtitle'));
    expect(restored.fields.subtitle).toMatchObject({ value: 'Book subtitle', source: 'book' });
  });

  it('names every missing profile field and produces a reproducible percentage', () => {
    const profile = METADATA_COMPLETENESS_PROFILES.find(({ id }) => id === 'core-book')!;
    const coverage = assessMetadataCompleteness(
      resolveEffectiveMetadata({ title: 'Title', language: 'en' }),
      profile
    );
    expect(coverage).toMatchObject({ present: 2, required: 6, percent: 33, complete: false });
    expect(coverage.missing).toContain('publisher');
  });

  it('retains link labels and paragraph order in deterministic plain-text description export', () => {
    const markdown =
      '# Heading\r\n\r\nA **bold** [link](https://example.invalid).\r\n\r\n- Final item';
    expect(descriptionMarkdownToPlainText(markdown)).toBe('Heading\nA bold link.\nFinal item');
  });

  it('validates territory-specific subject systems without pretending to validate headings', () => {
    expect(
      validateMetadataValues({
        'regional-subject-codes': [
          {
            territory: 'GB',
            scheme: 'thema',
            version: '1.6',
            code: 'FJH',
            primary: true,
            source: 'manual'
          },
          {
            territory: 'AU',
            scheme: 'thema',
            version: '1.6',
            code: 'FJH',
            primary: true,
            source: 'manual'
          },
          {
            territory: 'FR',
            scheme: 'clil',
            version: 'current-user-reference',
            code: '3430',
            primary: true,
            source: 'manual'
          },
          {
            territory: 'DE',
            scheme: 'wgs',
            version: '2.0',
            code: '1121',
            primary: true,
            source: 'manual'
          }
        ]
      })
    ).toEqual([]);
    expect(
      validateMetadataValues({
        'regional-subject-codes': [
          {
            territory: 'AU',
            scheme: 'wgs',
            version: '2.0',
            code: '1121',
            primary: true,
            source: 'manual'
          }
        ]
      })
    ).toContainEqual(expect.objectContaining({ field: 'regional-subject-codes' }));
  });
});
