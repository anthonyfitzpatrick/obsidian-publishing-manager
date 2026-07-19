/**
 * Owns the local record for Publishing Manager's Classification Data Licence Acknowledgement.
 * This acknowledgement adds no condition to the MIT software licence and grants no rights from
 * BISG, EDItEUR, CLIL, BIC, or MVB. A separate authorization record is required before a user may
 * import their own protected vocabulary. The public plugin never bundles or redistributes it.
 */

import type { Clock } from '../../domain/foundation/clock';

export const CLASSIFICATION_DATA_ACKNOWLEDGEMENT_ID =
  'publishing-manager-classification-data-licence-acknowledgement';
export const CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION = '2.0';

/** Exact text displayed before acceptance and identified by the persisted version. */
export const CLASSIFICATION_DATA_ACKNOWLEDGEMENT_TEXT = `Classification Data Licence Acknowledgement v2.0

1. Publishing Manager's original software and documentation are licensed under the repository MIT Licence. This acknowledgement does not add a restriction to, replace, or modify that licence.
2. Publishing Manager does not bundle, redistribute, or relicense third-party subject headings, complete code lists, mappings, translations, or explanatory notes as MIT content.
3. You may use the supplied links to consult official sources and manually record codes. Syntax validation does not certify that a code or label is current, correct, licensed, or accepted by a retailer.
4. If a future import feature accepts a protected vocabulary, you must supply your own legitimately licensed artifact. Publishing Manager's public distribution will not contain that artifact.
5. A recorded authorization is evidence supplied by you. It does not purchase, replace, extend, verify, or grant a licence from BISG, EDItEUR, BIC, CLIL, MVB, or another owner.
6. Acknowledgement and authorization evidence remains local in Obsidian plugin data. Publishing Manager makes no automatic classification lookup request and transmits no evidence.
7. Third-party material remains governed solely by its owner's terms. You remain responsible for those terms and for the accuracy and legality of assigned metadata.`;

/** Minimal persistence port keeps Obsidian's Plugin API outside the application service. */
export interface ClassificationLicenseDataPort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export interface ClassificationLicenceAcknowledgement {
  readonly acknowledgementId: typeof CLASSIFICATION_DATA_ACKNOWLEDGEMENT_ID;
  readonly version: typeof CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION;
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
}

export interface ClassificationDatasetAuthorization {
  readonly licensor: string;
  readonly agreementReference: string;
  readonly sourceArtifact: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export interface ClassificationLicenseStatus {
  readonly acknowledgement?: ClassificationLicenceAcknowledgement;
  readonly authorization?: ClassificationDatasetAuthorization;
  readonly protectedDatasetEnabled: boolean;
}

type PluginData = Record<string, unknown> & {
  classificationLicense?: {
    acknowledgement?: ClassificationLicenceAcknowledgement;
    authorization?: ClassificationDatasetAuthorization;
  };
};

/** Loads once, validates every write, and preserves unrelated plugin settings losslessly. */
export class ClassificationLicenseService {
  private data: PluginData = {};

  public constructor(
    private readonly port: ClassificationLicenseDataPort,
    private readonly clock: Clock
  ) {}

  public async initialize(): Promise<void> {
    const loaded = await this.port.load();
    this.data = isRecord(loaded) ? structuredClone(loaded) : {};
  }

  public status(): ClassificationLicenseStatus {
    const acknowledgement = validAcknowledgement(this.data.classificationLicense?.acknowledgement);
    const authorization = validAuthorization(this.data.classificationLicense?.authorization);
    return {
      ...(acknowledgement === undefined ? {} : { acknowledgement }),
      ...(authorization === undefined ? {} : { authorization }),
      protectedDatasetEnabled: acknowledgement !== undefined && authorization !== undefined
    };
  }

  /** Explicit acknowledgement records the exact current notice and a named human actor. */
  public async acknowledge(acknowledgedBy: string, confirmed: boolean): Promise<void> {
    const actor = requiredText(
      acknowledgedBy,
      'Enter the name of the person recording the acknowledgement.'
    );
    if (!confirmed)
      throw new Error(
        'Confirm that you have read the Classification Data Licence Acknowledgement.'
      );
    const authorization = validAuthorization(this.data.classificationLicense?.authorization);
    await this.persist({
      ...(authorization === undefined ? {} : { authorization }),
      acknowledgement: {
        acknowledgementId: CLASSIFICATION_DATA_ACKNOWLEDGEMENT_ID,
        version: CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION,
        acknowledgedBy: actor,
        acknowledgedAt: this.clock.now().toISOString()
      }
    });
  }

  /** Vendor evidence is separate from product acceptance and requires auditable source details. */
  public async recordAuthorization(input: {
    licensor: string;
    agreementReference: string;
    sourceArtifact: string;
    recordedBy: string;
  }): Promise<void> {
    if (this.status().acknowledgement === undefined)
      throw new Error(
        'Record the Classification Data Licence Acknowledgement before recording dataset rights.'
      );
    await this.persist({
      ...(this.data.classificationLicense ?? {}),
      authorization: {
        licensor: requiredText(input.licensor, 'Enter the vocabulary licensor.'),
        agreementReference: requiredText(
          input.agreementReference,
          'Enter the external licence or agreement reference.'
        ),
        sourceArtifact: requiredText(
          input.sourceArtifact,
          'Enter the authorized dataset filename, version, or source reference.'
        ),
        recordedBy: requiredText(input.recordedBy, 'Enter the person recording authorization.'),
        recordedAt: this.clock.now().toISOString()
      }
    });
  }

  /** Revocation is intentional and immediately re-locks every protected local dataset. */
  public async revoke(): Promise<void> {
    const next = { ...this.data };
    delete next.classificationLicense;
    this.data = next;
    await this.port.save(structuredClone(next));
  }

  private async persist(
    classificationLicense: NonNullable<PluginData['classificationLicense']>
  ): Promise<void> {
    const next: PluginData = { ...this.data, classificationLicense };
    await this.port.save(structuredClone(next));
    this.data = next;
  }
}

function validAcknowledgement(value: unknown): ClassificationLicenceAcknowledgement | undefined {
  if (
    !isRecord(value) ||
    value.acknowledgementId !== CLASSIFICATION_DATA_ACKNOWLEDGEMENT_ID ||
    value.version !== CLASSIFICATION_DATA_ACKNOWLEDGEMENT_VERSION ||
    typeof value.acknowledgedBy !== 'string' ||
    typeof value.acknowledgedAt !== 'string'
  )
    return undefined;
  return value as unknown as ClassificationLicenceAcknowledgement;
}
function validAuthorization(value: unknown): ClassificationDatasetAuthorization | undefined {
  if (
    !isRecord(value) ||
    !['licensor', 'agreementReference', 'sourceArtifact', 'recordedBy', 'recordedAt'].every(
      (key) => typeof value[key] === 'string' && String(value[key]).trim().length > 0
    )
  )
    return undefined;
  return value as unknown as ClassificationDatasetAuthorization;
}
function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
