/** Generates stable opaque identities without deriving them from filenames. */
export interface IdGenerator {
  generate(): string;
}
