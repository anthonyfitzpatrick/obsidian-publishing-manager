/** Proves template kinds, inert-data boundaries, resolution previews, and portable sanitation. */
import { describe, expect, it } from 'vitest';
import { BUNDLED_PUBLISHING_TEMPLATES } from '../../src/domain/templates/bundled-templates';
import {
  parseTemplateImport,
  previewTemplateResolution,
  serializeTemplate
} from '../../src/domain/templates/publishing-template';

describe('publishing templates', () => {
  it('bundles one validated starter for every required template family', () => {
    expect(BUNDLED_PUBLISHING_TEMPLATES.map(({ kind }) => kind).sort()).toEqual([
      'book',
      'checklist',
      'edition',
      'launch',
      'metadata',
      'platform',
      'pricing',
      'task'
    ]);
  });

  it('resolves typed variables and names only unresolved required inputs', () => {
    const template = BUNDLED_PUBLISHING_TEMPLATES.find(({ kind }) => kind === 'pricing')!;
    const incomplete = previewTemplateResolution(template, {
      editionId: 'pm-edition-1',
      platform: 'Fictional Store',
      territory: 'SE',
      currency: 'SEK'
    });
    expect(incomplete.unresolvedVariables).toEqual(['amount', 'effectiveFrom']);
    expect(incomplete.canApply).toBe(false);
    const complete = previewTemplateResolution(template, {
      editionId: 'pm-edition-1',
      platform: 'Fictional Store',
      territory: 'SE',
      currency: 'SEK',
      amount: '49.00',
      effectiveFrom: '2026-08-01'
    });
    expect(complete.canApply).toBe(true);
    expect(complete.resolvedDefaults.amount).toBe('49.00');
  });

  it('rejects executable fields and excludes private instance content on import/export', () => {
    const safeSource = JSON.stringify({
      format: 'publishing-manager-template',
      schemaVersion: 1,
      templateId: 'fictional-book-v1',
      kind: 'book',
      name: 'Fictional book',
      version: 1,
      applicability: {},
      defaults: { title: '{{title}}', notes: 'private draft note' },
      requiredFields: ['title'],
      variables: [{ name: 'title', label: 'Title', type: 'string', required: true }],
      futureSafe: { retained: true },
      secret: 'not portable'
    });
    const parsed = parseTemplateImport(safeSource);
    expect(parsed.excludedPrivateFields).toEqual(['defaults.notes', 'secret']);
    expect(parsed.template.extensions).toEqual({ futureSafe: { retained: true } });
    const exported = serializeTemplate(parsed.template);
    expect(exported.source).not.toContain('private draft note');
    expect(exported.source).toContain('futureSafe');
    expect(() =>
      parseTemplateImport(
        JSON.stringify({
          ...JSON.parse(safeSource),
          defaults: { title: '{{title}}', script: 'do something' }
        })
      )
    ).toThrow(/Executable template field/u);
  });
});
