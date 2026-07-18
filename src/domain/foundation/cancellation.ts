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
