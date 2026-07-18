import type { Clock } from '../../domain/foundation/clock';

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
