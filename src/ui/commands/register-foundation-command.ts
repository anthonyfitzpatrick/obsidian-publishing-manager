import { Notice, type Plugin } from 'obsidian';

import type { GetFoundationStatus } from '../../application/foundation/get-foundation-status';

export function registerFoundationCommand(
  plugin: Plugin,
  getFoundationStatus: GetFoundationStatus
): void {
  plugin.addCommand({
    id: 'show-foundation-status',
    name: 'Show foundation status',
    callback: () => {
      const result = getFoundationStatus.execute();
      new Notice(`Publishing Manager foundation: ${result.status}`);
    }
  });
}
