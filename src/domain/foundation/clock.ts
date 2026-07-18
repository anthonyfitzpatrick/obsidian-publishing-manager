/** Supplies time to domain and application services without binding them to the host clock. */
export interface Clock {
  now(): Date;
}
