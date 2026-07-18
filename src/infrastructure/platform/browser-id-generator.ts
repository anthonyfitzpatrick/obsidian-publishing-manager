import type { IdGenerator } from '../../domain/foundation/id-generator';

export class BrowserIdGenerator implements IdGenerator {
  public generate(): string {
    return window.crypto.randomUUID();
  }
}
