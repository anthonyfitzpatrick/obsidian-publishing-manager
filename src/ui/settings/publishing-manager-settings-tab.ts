import { type App, Notice, PluginSettingTab, Setting, type Plugin } from 'obsidian';

import {
  CLASSIFICATION_DATA_EULA_TEXT,
  CLASSIFICATION_DATA_EULA_VERSION,
  type ClassificationLicenseService
} from '../../application/metadata/classification-license-service';

/** Provides the native Settings entry while product settings are introduced incrementally. */
export class PublishingManagerSettingsTab extends PluginSettingTab {
  public constructor(
    app: App,
    plugin: Plugin,
    private readonly classificationLicenses: ClassificationLicenseService
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
        name: 'Classification Data EULA',
        desc: `Version ${CLASSIFICATION_DATA_EULA_VERSION}; acceptance and third-party dataset authorization are recorded separately.`
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

    this.renderClassificationLicensing();
  }

  /**
   * Renders the complete agreement before any acceptance control. A second, deliberately separate
   * form records external vendor rights so accepting our terms can never masquerade as a BISG or
   * other third-party licence.
   */
  private renderClassificationLicensing(): void {
    const { containerEl } = this;
    const status = this.classificationLicenses.status();
    new Setting(containerEl).setName('Classification data licensing').setHeading();
    const agreement = containerEl.createEl('details');
    agreement.createEl('summary', {
      text: `Classification Data EULA · version ${CLASSIFICATION_DATA_EULA_VERSION}`
    });
    agreement.createEl('pre', { text: CLASSIFICATION_DATA_EULA_TEXT });

    if (status.acceptance !== undefined) {
      new Setting(containerEl)
        .setName('EULA accepted')
        .setDesc(
          `${status.acceptance.acceptedBy} · ${status.acceptance.acceptedAt} · version ${status.acceptance.version}`
        );
    } else {
      let actor = '';
      let confirmed = false;
      const acceptance = new Setting(containerEl)
        .setName('Accept Classification Data EULA')
        .setDesc(
          'This local acknowledgement does not purchase or grant a third-party vocabulary licence.'
        )
        .addText((control) => {
          control.setPlaceholder('Full name').onChange((value) => {
            actor = value;
          });
        })
        .addToggle((control) => {
          control.setTooltip('I have read and agree to the displayed EULA').onChange((value) => {
            confirmed = value;
          });
        });
      acceptance.addButton((button) => {
        button
          .setButtonText('Accept')
          .setCta()
          .onClick(() => {
            void this.classificationLicenses
              .accept(actor, confirmed)
              .then(() => {
                new Notice('Classification Data EULA acceptance recorded locally.');
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
      let recordedBy = status.acceptance?.acceptedBy ?? '';
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
          ? 'Authorized: EULA acceptance and external dataset evidence are both present.'
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
