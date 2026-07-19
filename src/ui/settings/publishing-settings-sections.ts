/** Native SET-001–SET-005 section forms, storage recovery, and settings-only Forget confirmation. */
import { Notice, Setting } from 'obsidian';
import type {
  ForgetSettingsPreview,
  PublishingManagerSettings,
  PublishingSettingsService,
  SettingsSectionName,
  StorageMovePreview
} from '../../application/settings/publishing-settings-service';

export interface PublishingSettingsCallbacks {
  readonly refresh: () => void;
  readonly storageMoved: (target: string) => Promise<void>;
  readonly settingsForgotten: () => Promise<void>;
}

export class PublishingSettingsSections {
  private value: PublishingManagerSettings;
  public constructor(
    private readonly container: HTMLElement,
    private readonly settings: PublishingSettingsService,
    private readonly callbacks: PublishingSettingsCallbacks
  ) {
    this.value = settings.current();
  }

  public render(): void {
    this.storage();
    this.defaults();
    this.readiness();
    this.tasksDates();
    this.assets();
    this.sales();
    this.integrations();
    this.performance();
    this.privacyDiagnostics();
  }

  private storage(): void {
    const panel = section(
      this.container,
      'Storage',
      'Managed folder and naming preferences. Moving the managed root is a separate previewed, collision-checked, journaled operation.'
    );
    const draft = { ...this.value.storage };
    readonlyField(panel, 'Current managed root', draft.managedRoot);
    textField(
      panel,
      'Naming pattern',
      draft.namingPattern,
      (value) => (draft.namingPattern = value)
    );
    dropdown(
      panel,
      'History detail',
      draft.historyDetail,
      [
        ['minimal', 'Minimal'],
        ['standard', 'Standard'],
        ['verbose', 'Verbose']
      ],
      (value) => (draft.historyDetail = value as typeof draft.historyDetail)
    );
    textField(
      panel,
      'Archive folder',
      draft.archiveFolder,
      (value) => (draft.archiveFolder = value)
    );
    saveReset(panel, 'storage', () => draft, this.settings, this.callbacks.refresh);

    const move = panel.createEl('details', { cls: 'pm-panel' });
    move.createEl('summary', { text: 'Move managed storage' });
    move.createEl('p', {
      text: 'Preview inventories the complete tree and blocks existing targets. Apply renames through Obsidian, checkpoints outside the moving tree, then updates the shared runtime root.'
    });
    let target = '';
    textField(move, 'New managed root', target, (value) => (target = value));
    const previewArea = move.createDiv();
    new Setting(move)
      .setName('Preview storage move')
      .setDesc('No folder or setting changes occur during preview.')
      .addButton((button) =>
        button.setButtonText('Preview').onClick(() => {
          void this.settings
            .previewStorageMove(target)
            .then((result) => this.renderStorageMove(previewArea, result, false))
            .catch((cause: unknown) => new Notice(message(cause)));
        })
      );
    void this.settings.storageMoveRecovery().then((recovery) => {
      if (recovery !== undefined) this.renderStorageMove(previewArea, recovery, true);
    });
  }

  private renderStorageMove(
    parent: HTMLElement,
    preview: StorageMovePreview,
    recovery: boolean
  ): void {
    parent.empty();
    const box = parent.createDiv({ cls: 'pm-inline-alert' });
    box.createEl('strong', {
      text: recovery ? 'Storage move recovery required' : 'Storage move preview'
    });
    box.createEl('p', { text: `${preview.source} → ${preview.target}` });
    for (const consequence of preview.consequences) box.createEl('p', { text: `• ${consequence}` });
    for (const reason of preview.blockedReasons)
      box.createEl('p', { text: `Blocked: ${reason}`, attr: { role: 'alert' } });
    const paths = box.createEl('details');
    paths.createEl('summary', { text: `Previewed vault entries · ${preview.sourcePaths.length}` });
    const list = paths.createEl('ul');
    for (const path of preview.sourcePaths) list.createEl('li', { text: path });
    const apply = box.createEl('button', {
      cls: 'pm-button pm-button--primary',
      text: recovery ? 'Resume storage move' : 'Apply reviewed storage move',
      attr: { type: 'button' }
    });
    apply.disabled = preview.blockedReasons.length > 0;
    apply.addEventListener('click', () => {
      apply.disabled = true;
      void this.settings
        .applyStorageMove(preview)
        .then(() => this.callbacks.storageMoved(preview.target))
        .then(() => {
          new Notice('Managed storage move completed and catalog rebuilt.');
          this.callbacks.refresh();
        })
        .catch((cause: unknown) => {
          new Notice(message(cause));
          apply.disabled = false;
        });
    });
  }

  private defaults(): void {
    const panel = section(
      this.container,
      'Defaults',
      'Defaults initialize future work only. Saving or resetting them never rewrites existing projects.'
    );
    const draft = { ...this.value.defaults };
    for (const [key, label] of [
      ['imprint', 'Imprint'],
      ['language', 'Language code'],
      ['currency', 'Currency'],
      ['timezone', 'Timezone'],
      ['workflow', 'Workflow'],
      ['platformSet', 'Platform set'],
      ['template', 'Template']
    ] as const)
      textField(panel, label, draft[key], (value) => (draft[key] = value));
    saveReset(panel, 'defaults', () => draft, this.settings, this.callbacks.refresh);
  }

  private readiness(): void {
    const panel = section(
      this.container,
      'Readiness',
      'The core pack remains visible. Preferences do not erase rule evidence or existing audited overrides.'
    );
    const draft = {
      ...this.value.readiness,
      enabledRulePacks: [...this.value.readiness.enabledRulePacks]
    };
    listField(
      panel,
      'Enabled rule packs',
      draft.enabledRulePacks,
      (value) => (draft.enabledRulePacks = value)
    );
    numberField(
      panel,
      'Required weight',
      draft.requiredWeight,
      (value) => (draft.requiredWeight = value)
    );
    numberField(
      panel,
      'Advisory weight',
      draft.advisoryWeight,
      (value) => (draft.advisoryWeight = value)
    );
    dropdown(
      panel,
      'Blocker policy',
      draft.blockerPolicy,
      [
        ['cap-not-ready', 'Cap overall state at not ready'],
        ['warn-only', 'Warn with explicit override indicator']
      ],
      (value) => (draft.blockerPolicy = value as typeof draft.blockerPolicy)
    );
    numberField(
      panel,
      'Ready threshold',
      draft.readyThreshold,
      (value) => (draft.readyThreshold = value)
    );
    saveReset(panel, 'readiness', () => draft, this.settings, this.callbacks.refresh);
  }

  private tasksDates(): void {
    const panel = section(
      this.container,
      'Tasks and dates',
      'Calendar and estimate defaults for future task planning.'
    );
    const draft = { ...this.value.tasksDates, workingDays: [...this.value.tasksDates.workingDays] };
    dropdown(
      panel,
      'Week starts',
      draft.weekStart,
      [
        ['monday', 'Monday'],
        ['sunday', 'Sunday']
      ],
      (value) => (draft.weekStart = value as typeof draft.weekStart)
    );
    listField(panel, 'Working days', draft.workingDays, (value) => (draft.workingDays = value));
    numberField(
      panel,
      'Default estimate minutes',
      draft.defaultEstimateMinutes,
      (value) => (draft.defaultEstimateMinutes = value)
    );
    dropdown(
      panel,
      'Overdue policy',
      draft.overduePolicy,
      [
        ['calendar-day', 'Calendar day'],
        ['working-day', 'Working day']
      ],
      (value) => (draft.overduePolicy = value as typeof draft.overduePolicy)
    );
    saveReset(panel, 'tasksDates', () => draft, this.settings, this.callbacks.refresh);
  }

  private assets(): void {
    const panel = section(
      this.container,
      'Assets',
      'Fingerprint preferences never copy assets; content reads remain explicit and cancellable.'
    );
    const draft = {
      ...this.value.assets,
      allowedVaultLocations: [...this.value.assets.allowedVaultLocations]
    };
    dropdown(
      panel,
      'Fingerprint mode',
      draft.fingerprintMode,
      [
        ['off', 'Off'],
        ['metadata', 'Metadata'],
        ['content', 'Explicit content fingerprint']
      ],
      (value) => (draft.fingerprintMode = value as typeof draft.fingerprintMode)
    );
    numberField(
      panel,
      'Stale tolerance days',
      draft.staleToleranceDays,
      (value) => (draft.staleToleranceDays = value)
    );
    listField(
      panel,
      'Allowed vault locations',
      draft.allowedVaultLocations,
      (value) => (draft.allowedVaultLocations = value)
    );
    saveReset(panel, 'assets', () => draft, this.settings, this.callbacks.refresh);
  }

  private sales(): void {
    const panel = section(
      this.container,
      'Sales',
      'Local entry defaults never bypass attribution, duplicate/overlap preview, or confirmation. No credentials or endpoints are stored.'
    );
    const draft = { ...this.value.sales };
    for (const [key, label] of [
      ['sourceId', 'Source ID'],
      ['publicationLocation', 'Publication location'],
      ['country', 'Country'],
      ['currency', 'Currency'],
      ['displayCurrency', 'Optional display currency']
    ] as const)
      textField(panel, label, draft[key], (value) => (draft[key] = value));
    dropdown(
      panel,
      'Date grain',
      draft.dateGrain,
      [
        ['day', 'Day'],
        ['period', 'Period']
      ],
      (value) => (draft.dateGrain = value as typeof draft.dateGrain)
    );
    dropdown(
      panel,
      'Entry behavior',
      draft.entryBehavior,
      [
        ['confirm-every-entry', 'Confirm every entry'],
        ['reuse-last-safe-values', 'Reuse last safe values before preview']
      ],
      (value) => (draft.entryBehavior = value as typeof draft.entryBehavior)
    );
    toggle(panel, 'Sales diagnostics', draft.diagnostics, (value) => (draft.diagnostics = value));
    saveReset(panel, 'sales', () => draft, this.settings, this.callbacks.refresh);
  }

  private integrations(): void {
    const panel = section(
      this.container,
      'Integrations',
      'Capability preferences are local and opt-in. Runtime detection and compatibility evidence remain in each integration workspace.'
    );
    const draft = {
      ...this.value.integrations,
      enabledCapabilities: [...this.value.integrations.enabledCapabilities]
    };
    readonlyField(
      panel,
      'Enabled capability preferences',
      draft.enabledCapabilities.join(', ') || 'None'
    );
    toggle(
      panel,
      'Disclose exchanged fields',
      draft.discloseExchangedFields,
      (value) => (draft.discloseExchangedFields = value)
    );
    saveReset(panel, 'integrations', () => draft, this.settings, this.callbacks.refresh);
  }

  private performance(): void {
    const panel = section(
      this.container,
      'Performance',
      'Bounded local preferences for paging, indexing, and disposable caches. Low-resource mode never removes canonical data.'
    );
    const draft = { ...this.value.performance };
    numberField(panel, 'Page size', draft.pageSize, (value) => (draft.pageSize = value));
    numberField(
      panel,
      'Cache limit MB',
      draft.cacheLimitMb,
      (value) => (draft.cacheLimitMb = value)
    );
    toggle(
      panel,
      'Background indexing',
      draft.backgroundIndexing,
      (value) => (draft.backgroundIndexing = value)
    );
    toggle(
      panel,
      'Low-resource mode',
      draft.lowResourceMode,
      (value) => (draft.lowResourceMode = value)
    );
    saveReset(panel, 'performance', () => draft, this.settings, this.callbacks.refresh);
  }

  private privacyDiagnostics(): void {
    const panel = section(
      this.container,
      'Privacy and diagnostics',
      'Controls local diagnostic presentation only. It cannot delete project Markdown or linked assets.'
    );
    const draft = { ...this.value.privacyDiagnostics };
    dropdown(
      panel,
      'Redaction level',
      draft.redactionLevel,
      [
        ['maximum', 'Maximum'],
        ['balanced', 'Balanced'],
        ['none', 'None']
      ],
      (value) => (draft.redactionLevel = value as typeof draft.redactionLevel)
    );
    numberField(
      panel,
      'Local log retention days',
      draft.localLogRetentionDays,
      (value) => (draft.localLogRetentionDays = value)
    );
    toggle(
      panel,
      'Allow diagnostics export',
      draft.diagnosticsExport,
      (value) => (draft.diagnosticsExport = value)
    );
    saveReset(panel, 'privacyDiagnostics', () => draft, this.settings, this.callbacks.refresh);
    this.renderForget(panel);
  }

  private renderForget(parent: HTMLElement): void {
    const area = parent.createDiv();
    new Setting(parent)
      .setName('Forget plugin settings')
      .setDesc(
        'Preview removal of plugin preferences only. Project Markdown and linked assets are never deleted.'
      )
      .addButton((button) =>
        button
          .setButtonText('Preview Forget')
          .setWarning()
          .onClick(() => {
            void this.settings
              .previewForget()
              .then((preview) => this.renderForgetPreview(area, preview))
              .catch((cause: unknown) => new Notice(message(cause)));
          })
      );
  }

  private renderForgetPreview(parent: HTMLElement, preview: ForgetSettingsPreview): void {
    parent.empty();
    const box = parent.createDiv({ cls: 'pm-inline-alert' });
    box.createEl('strong', { text: 'Forget plugin settings preview' });
    for (const consequence of preview.consequences) box.createEl('p', { text: `• ${consequence}` });
    box.createEl('p', { text: `Plugin-data keys: ${preview.pluginDataKeys.join(', ') || 'none'}` });
    box.createEl('p', { text: 'Canonical projects deleted: No · linked assets deleted: No' });
    const label = box.createEl('label');
    const confirmed = label.createEl('input', { attr: { type: 'checkbox' } });
    label.appendText(' I understand only plugin settings will be forgotten');
    const apply = box.createEl('button', {
      cls: 'pm-button pm-button--danger',
      text: 'Forget plugin settings',
      attr: { type: 'button' }
    });
    apply.disabled = true;
    confirmed.addEventListener('change', () => (apply.disabled = !confirmed.checked));
    apply.addEventListener('click', () => {
      apply.disabled = true;
      void this.settings
        .forget(preview)
        .then(() => this.callbacks.settingsForgotten())
        .then(() => {
          new Notice(
            'Plugin settings forgotten. Project notes and linked assets remain untouched.'
          );
          this.callbacks.refresh();
        })
        .catch((cause: unknown) => {
          new Notice(message(cause));
          apply.disabled = false;
        });
    });
  }
}

function section(parent: HTMLElement, title: string, description: string): HTMLElement {
  new Setting(parent).setName(title).setHeading();
  const panel = parent.createEl('section', { cls: 'pm-settings-section' });
  panel.createEl('p', { text: description });
  return panel;
}

function textField(
  parent: HTMLElement,
  name: string,
  value: string,
  change: (value: string) => void
): void {
  new Setting(parent).setName(name).addText((control) => control.setValue(value).onChange(change));
}

function numberField(
  parent: HTMLElement,
  name: string,
  value: number,
  change: (value: number) => void
): void {
  new Setting(parent).setName(name).addText((control) => {
    control.inputEl.type = 'number';
    control.setValue(String(value)).onChange((next) => change(Number(next)));
  });
}

function listField(
  parent: HTMLElement,
  name: string,
  value: readonly string[],
  change: (value: string[]) => void
): void {
  textField(parent, name, value.join(', '), (next) =>
    change(
      next
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function readonlyField(parent: HTMLElement, name: string, value: string): void {
  new Setting(parent).setName(name).setDesc(value);
}

function toggle(
  parent: HTMLElement,
  name: string,
  value: boolean,
  change: (value: boolean) => void
): void {
  new Setting(parent)
    .setName(name)
    .addToggle((control) => control.setValue(value).onChange(change));
}

function dropdown(
  parent: HTMLElement,
  name: string,
  value: string,
  options: readonly (readonly [string, string])[],
  change: (value: string) => void
): void {
  new Setting(parent).setName(name).addDropdown((control) => {
    for (const [key, label] of options) control.addOption(key, label);
    control.setValue(value).onChange(change);
  });
}

function saveReset<K extends SettingsSectionName>(
  parent: HTMLElement,
  sectionName: K,
  value: () => PublishingManagerSettings[K],
  service: PublishingSettingsService,
  refresh: () => void
): void {
  new Setting(parent)
    .setName('Section actions')
    .setDesc('Save validates the complete section. Restore changes this preference section only.')
    .addButton((button) =>
      button
        .setButtonText('Save section')
        .setCta()
        .onClick(() => {
          void service
            .saveSection(sectionName, value())
            .then(() => {
              new Notice('Settings section saved. Existing projects were not changed.');
              refresh();
            })
            .catch((cause: unknown) => new Notice(message(cause)));
        })
    )
    .addButton((button) =>
      button.setButtonText('Restore section defaults').onClick(() => {
        void service
          .restoreSection(sectionName)
          .then(() => {
            new Notice('Section defaults restored. Existing projects were not changed.');
            refresh();
          })
          .catch((cause: unknown) => new Notice(message(cause)));
      })
    );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Settings operation failed.';
}
