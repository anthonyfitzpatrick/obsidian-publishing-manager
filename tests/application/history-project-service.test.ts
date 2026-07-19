/** Exercises automatic append-only capture, actor evidence, privacy bounds, filters, and lifecycle. */
import { describe, expect, it } from 'vitest';
import { BookProjectService } from '../../src/application/books/book-project-service';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { HistoryPreferencesService } from '../../src/application/history/history-preferences-service';
import { HistoryProjectService } from '../../src/application/history/history-project-service';
import { HistoryRecordingRepository } from '../../src/application/history/history-recording-repository';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';
import { ManagedFolderLayout } from '../../src/domain/storage/managed-folder-layout';
import { VaultManagedRecordRepository } from '../../src/infrastructure/storage/vault-managed-record-repository';
import { JsonTestFrontmatterCodec, MemoryVaultTextPort } from '../storage-test-doubles';

class FixedClock implements Clock {
  public now() {
    return new Date('2026-07-19T12:00:00.000Z');
  }
}
class Ids implements IdGenerator {
  private n = 0;
  public generate() {
    return `e0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('history project service', () => {
  it('captures create, update, archive, and restore without private content or recursion', async () => {
    const vault = new MemoryVaultTextPort();
    const canonical = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
    const clock = new FixedClock();
    const ids = new Ids();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(canonical, clock);
    await catalog.initialize([]);
    let pluginData: unknown = { history: { actorLabel: 'Test operator', retentionDays: 0 } };
    const preferences = new HistoryPreferencesService({
      load: async () => pluginData,
      save: async (value) => {
        pluginData = value;
      }
    });
    await preferences.initialize();
    const history = new HistoryProjectService(canonical, catalog, layout, clock, ids, preferences);
    const repository = new HistoryRecordingRepository(canonical, history);
    const books = new BookProjectService(repository, catalog, layout, clock, ids);

    const created = await books.create({
      title: 'History Test',
      primaryLanguage: 'en',
      status: 'planned',
      summary: 'Private synopsis'
    });
    await books.edit(created.path, { status: 'active', summary: 'Replacement private synopsis' });
    await books.archive(created.path);
    await books.restore(created.path);

    const events = history.eventsForBook(created.book.id);
    expect(events).toHaveLength(4);
    expect(events.map(({ fields }) => fields.action)).toEqual([
      'created',
      'updated',
      'archived',
      'restored'
    ]);
    expect(events.every(({ fields }) => fields['actor-label'] === 'Test operator')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Private synopsis');
    expect(JSON.stringify(events)).not.toContain('Replacement private synopsis');
    expect(
      history.eventsForBook(created.book.id, { action: 'updated', search: 'status' })
    ).toHaveLength(1);
    expect(catalog.recordsOfType('history-event')).toHaveLength(4);
    expect(history.failedCaptureCount()).toBe(0);
  });
});
