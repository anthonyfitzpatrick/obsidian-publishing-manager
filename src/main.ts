import { Plugin } from 'obsidian';

import { GetFoundationStatus } from './application/foundation/get-foundation-status';
import { BrowserIdGenerator } from './infrastructure/platform/browser-id-generator';
import { SystemClock } from './infrastructure/platform/system-clock';
import { registerFoundationCommand } from './ui/commands/register-foundation-command';
import { PublishingManagerSettingsTab } from './ui/settings/publishing-manager-settings-tab';

export default class PublishingManagerPlugin extends Plugin {
  public override onload(): void {
    const getFoundationStatus = new GetFoundationStatus(
      new SystemClock(),
      new BrowserIdGenerator()
    );

    registerFoundationCommand(this, getFoundationStatus);
    this.addSettingTab(new PublishingManagerSettingsTab(this.app, this));
  }
}
