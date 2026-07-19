/** Proves bounded human summaries never copy private fields into append-only evidence. */
import { describe, expect, it } from 'vitest';
import {
  describeHistoryMutation,
  validateHistoryEvent
} from '../../src/domain/history/history-event';

const envelope = {
  pmId: 'pm-book-00000000-0000-4000-8000-000000000001',
  pmType: 'book' as const,
  pmSchema: 1,
  createdAt: '2026-07-19T12:00:00.000Z',
  updatedAt: '2026-07-19T12:00:00.000Z'
};

describe('history event evidence', () => {
  it('names meaningful changes while withholding summaries and notes', () => {
    const event = describeHistoryMutation(
      'updated',
      'Anthony',
      '2026-07-19T12:30:00.000Z',
      { envelope, fields: { title: 'Old title', status: 'draft', notes: 'private old text' } },
      {
        envelope: { ...envelope, updatedAt: '2026-07-19T12:30:00.000Z' },
        fields: { title: 'New title', status: 'active', notes: 'private new text' }
      },
      envelope.pmId
    );
    validateHistoryEvent(event);
    expect(event.summary).toContain('notes');
    expect(event.beforeSummary).toContain('notes: changed (content withheld)');
    expect(event.afterSummary).not.toContain('private new text');
    expect(event.changedFields).toEqual(['notes', 'status', 'title']);
  });

  it('bounds actor and event summaries', () => {
    const event = describeHistoryMutation(
      'created',
      'A'.repeat(200),
      '2026-07-19T12:30:00.000Z',
      undefined,
      { envelope, fields: { title: 'T'.repeat(500), summary: 'S'.repeat(500) } },
      envelope.pmId
    );
    expect(event.actorLabel).toHaveLength(80);
    expect(event.summary.length).toBeLessThanOrEqual(300);
    expect(event.afterSummary).not.toContain('S'.repeat(20));
  });
});
