/** Pure bounded-window calculation shared by high-cardinality Obsidian workspaces. */
export interface PagedCollectionWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly offset: number;
  /** Exclusive upper bound suitable for `Array.prototype.slice`. */
  readonly end: number;
}

/**
 * Clamps a disposable requested page after filters, imports, archives, or external edits change
 * the collection. Strict inputs keep a malformed setting from manufacturing an unbounded DOM.
 */
export function pagedCollectionWindow(
  total: number,
  requestedPage: number,
  pageSize: number
): PagedCollectionWindow {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error('Paged collection total must be a non-negative safe integer.');
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0)
    throw new Error('Paged collection page must be a non-negative safe integer.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new Error('Paged collection size must be a positive safe integer.');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages - 1);
  const offset = page * pageSize;
  return { page, pageSize, total, totalPages, offset, end: Math.min(total, offset + pageSize) };
}

/** Returns only the visible references; it never clones or mutates the authoritative collection. */
export function pageCollection<T>(
  values: readonly T[],
  window: Pick<PagedCollectionWindow, 'offset' | 'end'>
): readonly T[] {
  return values.slice(window.offset, window.end);
}
