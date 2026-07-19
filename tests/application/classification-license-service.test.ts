/**
 * Proves that the MIT-safe licence acknowledgement and third-party authorization remain separate.
 * The protected-dataset gate opens only when both records exist and closes again on revocation.
 */
import { describe, expect, it } from 'vitest';

import {
  ClassificationLicenseService,
  type ClassificationLicenseDataPort
} from '../../src/application/metadata/classification-license-service';
import type { Clock } from '../../src/domain/foundation/clock';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-19T12:00:00.000Z');
  }
}
class MemoryData implements ClassificationLicenseDataPort {
  public value: unknown = { unrelated: 'preserved' };
  public async load(): Promise<unknown> {
    return structuredClone(this.value);
  }
  public async save(value: unknown): Promise<void> {
    this.value = structuredClone(value);
  }
}

describe('classification license service', () => {
  it('requires explicit acceptance and separate external authorization evidence', async () => {
    const port = new MemoryData();
    const service = new ClassificationLicenseService(port, new FixedClock());
    await service.initialize();
    await expect(service.acknowledge('A. Publisher', false)).rejects.toThrow('read');
    await service.acknowledge('A. Publisher', true);
    expect(service.status()).toMatchObject({ protectedDatasetEnabled: false });
    await service.recordAuthorization({
      licensor: 'Vocabulary Owner',
      agreementReference: 'EULA-123',
      sourceArtifact: 'authorized-list-2026.xlsx',
      recordedBy: 'A. Publisher'
    });
    expect(service.status()).toMatchObject({ protectedDatasetEnabled: true });
    expect(port.value).toMatchObject({ unrelated: 'preserved' });
    await service.revoke();
    expect(service.status()).toMatchObject({ protectedDatasetEnabled: false });
  });
});
