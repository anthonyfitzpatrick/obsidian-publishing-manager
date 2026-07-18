import { type App, PluginSettingTab, Setting, type Plugin } from 'obsidian';

/** Provides the native Settings entry while product settings are introduced incrementally. */
export class PublishingManagerSettingsTab extends PluginSettingTab {
  public constructor(app: App, plugin: Plugin) {
    super(app, plugin);
  }

  /** Obsidian 1.13+ uses these definitions for rendering and settings search. */
  public getSettingDefinitions(): Array<{ name: string; desc: string }> {
    return [
      { name: 'Foundation status', desc: 'Ready' },
      {
        name: 'Local-first operation',
        desc: 'Publishing manager uses local vault data and makes no network requests.'
      }
    ];
  }

  /** Obsidian versions before 1.13 use the imperative settings API. */
  public display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('publishing-manager');

    new Setting(containerEl).setName('Foundation status').setDesc('Ready');
    new Setting(containerEl)
      .setName('Local-first operation')
      .setDesc('Publishing manager uses local vault data and makes no network requests.');
  }
}
