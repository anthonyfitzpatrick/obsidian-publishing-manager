/** Proves EXP serializers retain evidence, stable ordering, CSV safety, and portable ICS dates. */
import { describe, expect, it } from 'vitest';
import {
  serializeCsvTable,
  serializeJsonProject,
  serializeMarkdownDossier,
  serializePublishingIcs,
  type ExportMetadata
} from '../../src/domain/exports/publishing-export';

const metadata: ExportMetadata = {
  generatorVersion: '0.1.0',
  schemaVersion: 1,
  generatedAt: '2026-07-19T12:00:00.000Z',
  scope: { type: 'book', id: 'book-1', label: 'Fictional Export' },
  warnings: ['One warning']
};

describe('publishing export serializers', () => {
  it('creates a human-readable dossier with readiness and warnings', () => {
    const source = serializeMarkdownDossier({
      metadata,
      book: {
        id: 'book-1',
        type: 'book',
        schemaVersion: 1,
        fields: { title: 'Fictional Export', status: 'active' }
      },
      records: [{ id: 'edition-1', type: 'edition', schemaVersion: 1, fields: { type: 'ebook' } }],
      readiness: {
        state: 'attention',
        score: 75,
        confidence: 80,
        rulePackCode: 'core',
        rulePackVersion: 1,
        results: [
          {
            code: 'metadata.complete',
            version: 1,
            state: 'warning',
            severity: 'required',
            evidence: 'One field is missing.',
            remedy: 'Complete metadata.'
          }
        ]
      }
    });
    expect(source).toContain('# Publishing dossier — Fictional Export');
    expect(source).toContain('Score: 75%');
    expect(source).toContain('metadata.complete v1');
    expect(source).toContain('One warning');
  });

  it('quotes CSV cells and emits evidence even for an empty table', () => {
    const source = serializeCsvTable({
      metadata,
      dataset: 'tasks',
      columns: ['id', 'title'],
      rows: [{ id: 'task-1', title: 'Edit, proof "again"' }]
    });
    expect(source).toContain('generator-version,export-schema-version,generated-at');
    expect(source).toContain('"Edit, proof ""again"""');
    const empty = serializeCsvTable({
      metadata,
      dataset: 'editions',
      columns: ['id'],
      rows: []
    });
    expect(empty.split('\r\n')).toHaveLength(3);
    expect(empty).toContain('0.1.0,1,2026-07-19T12:00:00.000Z');
  });

  it('sorts JSON recursively and serializes local all-day ICS evidence', () => {
    const json = serializeJsonProject({
      metadata,
      records: [
        {
          id: 'book-1',
          type: 'book',
          schemaVersion: 1,
          fields: { z: 1, a: { z: 2, a: 1 } }
        }
      ]
    });
    expect(json.indexOf('"a"')).toBeLessThan(json.indexOf('"z"'));
    expect(json).toContain('publishing-manager-project-export');
    const ics = serializePublishingIcs(metadata, [
      {
        id: 'task:1',
        date: '2026-08-31',
        title: 'Proof, final',
        kind: 'task',
        recordId: 'task-1'
      }
    ]);
    expect(ics).toContain('X-PM-EXPORT-SCHEMA:1');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260831');
    expect(ics).toContain('DTEND;VALUE=DATE:20260901');
    expect(ics).toContain('SUMMARY:Proof\\, final');
    expect(() =>
      serializePublishingIcs(metadata, [
        {
          id: 'bad',
          date: '2026-02-31',
          title: 'Impossible',
          kind: 'task',
          recordId: 'task-bad'
        }
      ])
    ).toThrow('Invalid calendar date');
  });
});
