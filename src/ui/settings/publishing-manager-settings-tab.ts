import { type App, Notice, PluginSettingTab, Setting, type Plugin } from 'obsidian';

import {
  CLASSIFICATION_DATA_ACKNOWLEDGEMENT_TEXT,
  CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION,
  type ClassificationLicenseService
} from '../../application/metadata/classification-license-service';
import {
  type HistoryPreferencesService,
  type HistoryRetentionDays
} from '../../application/history/history-preferences-service';
import type { PublishingSettingsService } from '../../application/settings/publishing-settings-service';
import {
  PublishingSettingsSections,
  type PublishingSettingsCallbacks
} from './publishing-settings-sections';

/** Provides the native Settings entry while product settings are introduced incrementally. */
export class PublishingManagerSettingsTab extends PluginSettingTab {
  public constructor(
    app: App,
    plugin: Plugin,
    private readonly settings: PublishingSettingsService,
    private readonly classificationLicenses: ClassificationLicenseService,
    private readonly historyPreferences: HistoryPreferencesService,
    private readonly callbacks: Omit<PublishingSettingsCallbacks, 'refresh'>
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13+ uses these definitions for rendering and settings search. */
  public getSettingDefinitions(): Array<{ name: string; desc: string }> {
    return [
      { name: 'Foundation status', desc: 'Ready' },
      {
        name: 'Local-first operation',
        desc: 'Publishing manager uses local vault data and makes no network requests.'
      },
      {
        name: 'Classification data licence acknowledgement',
        desc: `Version ${CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION}; the MIT software licence and third-party dataset authorization remain separate.`
      },
      {
        name: 'Storage',
        desc: 'Managed root, naming, archive, and journaled move/recovery.'
      },
      {
        name: 'Defaults',
        desc: 'Future publisher, language, currency, workflow, platform, and template defaults.'
      },
      { name: 'Readiness', desc: 'Rule packs, weights, blocker policy, and score threshold.' },
      { name: 'Tasks and dates', desc: 'Week, working days, estimates, and overdue policy.' },
      { name: 'Assets', desc: 'Fingerprint mode, stale tolerance, and allowed vault locations.' },
      {
        name: 'Sales',
        desc: 'Local source, attribution, currency, date-grain, and entry defaults.'
      },
      {
        name: 'Integrations',
        desc: 'Detected optional capabilities and exchanged-field disclosure.'
      },
      { name: 'Performance', desc: 'Page, cache, indexing, and low-resource preferences.' },
      {
        name: 'Privacy and diagnostics',
        desc: 'Redaction, local retention, diagnostics export, and Forget.'
      },
      {
        name: 'History evidence',
        desc: 'Set the local actor label and non-destructive history retention window.'
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
    new PublishingSettingsSections(containerEl, this.settings, {
      ...this.callbacks,
      refresh: () => this.display()
    }).render();

    this.renderHistoryPreferences();

    this.renderClassificationLicensing();
  }

  /** Retention changes only the default visible window; canonical append-only notes stay intact. */
  private renderHistoryPreferences(): void {
    const current = this.historyPreferences.current();
    new Setting(this.containerEl).setName('History evidence').setHeading();
    new Setting(this.containerEl)
      .setName('Local actor label')
      .setDesc(
        'Written into future history events. This is a human label, not an account or login.'
      )
      .addText((control) => {
        control.setValue(current.actorLabel);
        control.inputEl.addEventListener('change', () => {
          const value = control.getValue();
          if (!value.trim()) return;
          void this.historyPreferences
            .save({ ...this.historyPreferences.current(), actorLabel: value })
            .catch((cause: unknown) => new Notice(errorMessage(cause)));
        });
      });
    new Setting(this.containerEl)
      .setName('History retention window')
      .setDesc(
        'Controls the default visible history window. Canonical history Markdown is not automatically edited or deleted.'
      )
      .addDropdown((control) => {
        control
          .addOption('0', 'All canonical history')
          .addOption('365', 'Most recent year')
          .addOption('1095', 'Most recent 3 years')
          .addOption('1825', 'Most recent 5 years')
          .setValue(String(current.retentionDays))
          .onChange((value) => {
            void this.historyPreferences
              .save({
                ...this.historyPreferences.current(),
                retentionDays: Number(value) as HistoryRetentionDays
              })
              .catch((cause: unknown) => new Notice(errorMessage(cause)));
          });
      });
  }

  /**
   * Renders the complete notice before acknowledgement. A second, deliberately separate form
   * records external vendor evidence so this notice can never masquerade as a BISG or other licence.
   */
  private renderClassificationLicensing(): void {
    const { containerEl } = this;
    const status = this.classificationLicenses.status();
    new Setting(containerEl).setName('Classification data licensing').setHeading();
    const agreement = containerEl.createEl('details');
    agreement.createEl('summary', {
      text: `Classification data licence acknowledgement · version ${CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION}`
    });
    agreement.createEl('pre', { text: CLASSIFICATION_DATA_ACKNOWLEDGEMENT_TEXT });

    if (status.acknowledgement !== undefined) {
      new Setting(containerEl)
        .setName('Licence notice acknowledged')
        .setDesc(
          `${status.acknowledgement.acknowledgedBy} · ${status.acknowledgement.acknowledgedAt} · version ${status.acknowledgement.version}`
        );
    } else {
      let actor = '';
      let confirmed = false;
      const acceptance = new Setting(containerEl)
        .setName('Acknowledge classification data licence notice')
        .setDesc(
          'This records that you read the notice. It adds no restriction to the MIT software licence and grants no third-party vocabulary rights.'
        )
        .addText((control) => {
          control.setPlaceholder('Full name').onChange((value) => {
            actor = value;
          });
        })
        .addToggle((control) => {
          control
            .setTooltip('I have read the displayed licence acknowledgement')
            .onChange((value) => {
              confirmed = value;
            });
        });
      acceptance.addButton((button) => {
        button
          .setButtonText('Accept')
          .setCta()
          .onClick(() => {
            void this.classificationLicenses
              .acknowledge(actor, confirmed)
              .then(() => {
                new Notice('Classification data licence acknowledgement recorded locally.');
                this.display();
              })
              .catch((cause: unknown) => new Notice(errorMessage(cause)));
          });
      });
    }

    if (status.authorization !== undefined) {
      new Setting(containerEl)
        .setName('Protected dataset authorization recorded')
        .setDesc(
          `${status.authorization.licensor} · ${status.authorization.agreementReference} · ${status.authorization.sourceArtifact} · recorded ${status.authorization.recordedAt}`
        );
    } else {
      let licensor = '';
      let agreementReference = '';
      let sourceArtifact = '';
      let recordedBy = status.acknowledgement?.acknowledgedBy ?? '';
      const authorization = new Setting(containerEl)
        .setName('Record external dataset authorization')
        .setDesc(
          'Complete this only after receiving the required licence from the vocabulary owner. The source artifact must be the authorized file or version, not a copied webpage.'
        );
      authorization.addText((control) =>
        control.setPlaceholder('Licensor').onChange((value) => {
          licensor = value;
        })
      );
      authorization.addText((control) =>
        control.setPlaceholder('Agreement reference').onChange((value) => {
          agreementReference = value;
        })
      );
      authorization.addText((control) =>
        control.setPlaceholder('Dataset artifact/version').onChange((value) => {
          sourceArtifact = value;
        })
      );
      authorization.addText((control) => {
        control
          .setPlaceholder('Recorded by')
          .setValue(recordedBy)
          .onChange((value) => {
            recordedBy = value;
          });
      });
      authorization.addButton((button) => {
        button.setButtonText('Record authorization').onClick(() => {
          void this.classificationLicenses
            .recordAuthorization({ licensor, agreementReference, sourceArtifact, recordedBy })
            .then(() => {
              new Notice('External dataset authorization recorded locally.');
              this.display();
            })
            .catch((cause: unknown) => new Notice(errorMessage(cause)));
        });
      });
    }

    new Setting(containerEl)
      .setName('Protected vocabulary state')
      .setDesc(
        status.protectedDatasetEnabled
          ? 'Authorized: licence acknowledgement and external dataset evidence are both present.'
          : 'Locked: manual code assignment is available, but no protected complete vocabulary may be enabled.'
      )
      .addButton((button) => {
        button
          .setButtonText('Revoke local records')
          .setWarning()
          .onClick(() => {
            void this.classificationLicenses
              .revoke()
              .then(() => {
                new Notice(
                  'Classification licensing records revoked; protected datasets are locked.'
                );
                this.display();
              })
              .catch((cause: unknown) => new Notice(errorMessage(cause)));
          });
      });
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Classification licensing could not be saved.';
}
