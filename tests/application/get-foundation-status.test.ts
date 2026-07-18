import { describe, expect, it } from 'vitest';

import { GetFoundationStatus } from '../../src/application/foundation/get-foundation-status';
import type { Clock } from '../../src/domain/foundation/clock';
import type { IdGenerator } from '../../src/domain/foundation/id-generator';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-07-18T12:00:00.000Z');
  }
}

class FixedIdGenerator implements IdGenerator {
  public generate(): string {
    return 'foundation-check-1';
  }
}

describe('GetFoundationStatus', () => {
  it('returns a deterministic foundation snapshot', () => {
    const service = new GetFoundationStatus(new FixedClock(), new FixedIdGenerator());

    expect(service.execute()).toEqual({
      architecture: 'ui-application-domain',
      checkedAt: '2026-07-18T12:00:00.000Z',
      requestId: 'foundation-check-1',
      status: 'ready'
    });
  });
});
