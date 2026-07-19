/**
 * Owns the local acceptance record for Publishing Manager's Classification Data EULA. This is a
 * product acknowledgement, not a licence issued by BISG, EDItEUR, CLIL, BIC, or MVB. A separate
 * authorization record is therefore required before a protected complete vocabulary may be
 * bundled or imported. Keeping those facts separate prevents a checkbox from manufacturing rights.
 */

import type { Clock } from '../../domain/foundation/clock';

export const CLASSIFICATION_DATA_EULA_ID = 'publishing-manager-classification-data-eula';
export const CLASSIFICATION_DATA_EULA_VERSION = '1.0';

/** Exact text displayed before acceptance and identified by the persisted version. */
export const CLASSIFICATION_DATA_EULA_TEXT = `Classification Data End User Licence Agreement v1.0

1. Publishing Manager software remains available under its repository software licence. Subject headings, code lists, mappings, translations, and explanatory notes supplied by third parties remain the property of their respective owners and are not relicensed by Publishing Manager.
2. You may manually record subject codes that you are entitled to use. Syntax validation does not certify that a code or label is current, correct, or accepted by a retailer.
3. You must not import, enable, copy, redistribute, publish, or export a protected complete vocabulary unless you or your organisation holds the licence required by its owner for that use.
4. When recording a dataset authorization, you confirm that its agreement reference and source artifact are genuine, applicable to this installation, and within their permitted term and territory.
5. Publishing Manager stores acceptance and authorization evidence locally in Obsidian plugin data. It makes no classification lookup request and does not transmit the evidence.
6. Accepting this agreement does not purchase, replace, extend, or prove any licence from BISG, EDItEUR, BIC, CLIL, MVB, or another vocabulary owner.
7. You remain responsible for reviewing third-party terms and for the accuracy and legality of assigned metadata.`;

/** Minimal persistence port keeps Obsidian's Plugin API outside the application service. */
export interface ClassificationLicenseDataPort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export interface ClassificationEulaAcceptance {
  readonly eulaId: typeof CLASSIFICATION_DATA_EULA_ID;
  readonly version: typeof CLASSIFICATION_DATA_EULA_VERSION;
  readonly acceptedBy: string;
  readonly acceptedAt: string;
}

export interface ClassificationDatasetAuthorization {
  readonly licensor: string;
  readonly agreementReference: string;
  readonly sourceArtifact: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}

export interface ClassificationLicenseStatus {
  readonly acceptance?: ClassificationEulaAcceptance;
  readonly authorization?: ClassificationDatasetAuthorization;
  readonly protectedDatasetEnabled: boolean;
}

type PluginData = Record<string, unknown> & {
  classificationLicense?: {
    acceptance?: ClassificationEulaAcceptance;
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
    const acceptance = validAcceptance(this.data.classificationLicense?.acceptance);
    const authorization = validAuthorization(this.data.classificationLicense?.authorization);
    return {
      ...(acceptance === undefined ? {} : { acceptance }),
      ...(authorization === undefined ? {} : { authorization }),
      protectedDatasetEnabled: acceptance !== undefined && authorization !== undefined
    };
  }

  /** Explicit acknowledgement requires the exact current text and a named human actor. */
  public async accept(acceptedBy: string, confirmed: boolean): Promise<void> {
    const actor = requiredText(acceptedBy, 'Enter the name of the person accepting the EULA.');
    if (!confirmed)
      throw new Error('Confirm that you have read and agree to the Classification Data EULA.');
    await this.persist({
      ...(this.data.classificationLicense ?? {}),
      acceptance: {
        eulaId: CLASSIFICATION_DATA_EULA_ID,
        version: CLASSIFICATION_DATA_EULA_VERSION,
        acceptedBy: actor,
        acceptedAt: this.clock.now().toISOString()
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
    if (this.status().acceptance === undefined)
      throw new Error('Accept the Classification Data EULA before recording dataset rights.');
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

function validAcceptance(value: unknown): ClassificationEulaAcceptance | undefined {
  if (
    !isRecord(value) ||
    value.eulaId !== CLASSIFICATION_DATA_EULA_ID ||
    value.version !== CLASSIFICATION_DATA_EULA_VERSION ||
    typeof value.acceptedBy !== 'string' ||
    typeof value.acceptedAt !== 'string'
  )
    return undefined;
  return value as unknown as ClassificationEulaAcceptance;
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
