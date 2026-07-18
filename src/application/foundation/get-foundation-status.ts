import type { Clock } from '../../domain/foundation/clock';
import type { IdGenerator } from '../../domain/foundation/id-generator';

export interface FoundationStatus {
  readonly architecture: 'ui-application-domain';
  readonly checkedAt: string;
  readonly requestId: string;
  readonly status: 'ready';
}

/** Reports a deterministic, side-effect-free snapshot used by the foundation smoke command. */
export class GetFoundationStatus {
  public constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator
  ) {}

  public execute(): FoundationStatus {
    return {
      architecture: 'ui-application-domain',
      checkedAt: this.clock.now().toISOString(),
      requestId: this.idGenerator.generate(),
      status: 'ready'
    };
  }
}
