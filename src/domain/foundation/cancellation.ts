export class OperationCancelledError extends Error {
  public constructor() {
    super('The operation was cancelled.');
    this.name = 'OperationCancelledError';
  }
}

/** Allows long-running work to stop cleanly without depending on a host API. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  throwIfCancellationRequested(): void;
}

export class NeverCancelledToken implements CancellationToken {
  public readonly isCancellationRequested = false;

  public throwIfCancellationRequested(): void {
    // Intentionally remains active for the lifetime of the operation.
  }
}

/** Mutable token owned by one UI operation; cancellation is cooperative and side-effect free. */
export class ManualCancellationToken implements CancellationToken {
  private cancelled = false;
  public get isCancellationRequested(): boolean {
    return this.cancelled;
  }
  public cancel(): void {
    this.cancelled = true;
  }
  public throwIfCancellationRequested(): void {
    if (this.cancelled) throw new OperationCancelledError();
  }
}
