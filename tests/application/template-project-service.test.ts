/** Exercises copied bundled templates, validated import, resolution, and collision-safe local export. */
import { describe, expect, it } from 'vitest';
import { BookCatalog } from '../../src/application/catalog/book-catalog';
import { TemplateProjectService } from '../../src/application/templates/template-project-service';
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
    return `f0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
  }
}

describe('template project service', () => {
  it('copies before editing and exports portable deterministic JSON without envelope/body', async () => {
    const vault = new MemoryVaultTextPort();
    const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
    const clock = new FixedClock();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    await catalog.initialize([]);
    const templates = new TemplateProjectService(
      repository,
      catalog,
      layout,
      vault,
      clock,
      new Ids()
    );
    const copied = await templates.copyBundled('pm-bundled-book-basic-v1');
    expect(copied.path).toMatch(/^Publishing Manager\/Templates\//u);
    expect(copied.fields.source).toBe('bundled-copy');
    const preview = templates.preview(copied.id, { title: 'Fictional Harbour' });
    expect(preview.canApply).toBe(true);
    expect(preview.resolvedDefaults.title).toBe('Fictional Harbour');

    const exported = await templates.exportJson(copied.id);
    expect(exported.path).toMatch(/^Publishing Manager\/Exports\/Templates\//u);
    const source = await vault.read(exported.path);
    expect(source).toContain('publishing-manager-template');
    expect(source).not.toContain('pm-created');
    expect(source).not.toContain('This note contains inert local data');
  });

  it('imports a second safe template with a new canonical identity', async () => {
    const vault = new MemoryVaultTextPort();
    const repository = new VaultManagedRecordRepository(vault, new JsonTestFrontmatterCodec());
    const clock = new FixedClock();
    const layout = new ManagedFolderLayout({ root: 'Publishing Manager' });
    const catalog = new BookCatalog(repository, clock);
    await catalog.initialize([]);
    const templates = new TemplateProjectService(
      repository,
      catalog,
      layout,
      vault,
      clock,
      new Ids()
    );
    const imported = await templates.importJson(
      JSON.stringify({
        format: 'publishing-manager-template',
        schemaVersion: 1,
        templateId: 'external-checklist-v1',
        kind: 'checklist',
        name: 'External checklist',
        version: 1,
        applicability: {},
        defaults: { label: '{{label}}', items: [] },
        requiredFields: ['label', 'items'],
        variables: [{ name: 'label', label: 'Label', type: 'string', required: true }]
      })
    );
    expect(imported.record.id).toMatch(/^pm-template-/u);
    expect(imported.record.fields['source-template-id']).toBe('external-checklist-v1');
    expect(templates.installed()).toHaveLength(1);
  });
});
