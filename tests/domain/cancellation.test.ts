import { describe, expect, it } from 'vitest';

import { NeverCancelledToken } from '../../src/domain/foundation/cancellation';

describe('NeverCancelledToken', () => {
  it('remains active and does not throw', () => {
    const token = new NeverCancelledToken();

    expect(token.isCancellationRequested).toBe(false);
    expect(() => token.throwIfCancellationRequested()).not.toThrow();
  });
});
