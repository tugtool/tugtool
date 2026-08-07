/**
 * lens-filter-store.ts — a tiny module store holding each Lens section's live
 * filter query.
 *
 * A section's filter field lives in its BAND and the list it trims lives in its
 * BODY — sibling components under `LensSection`, with the data source minted
 * inside the body's own hook. The band therefore cannot hand the body a
 * delegate, and lifting the data source into `LensSection` would break the
 * registry's host-agnostic body contract. A module store is the house [L02]
 * shape for exactly this seam (the same shape `lens-section-content.ts` uses):
 * the band's delegate writes, the body reads through `useSyncExternalStore` and
 * passes the query into its data source as an input.
 *
 * Transient by design — never persisted to tugbank, never to storage. The query
 * DOES survive a collapse/expand (module scope outlives the band's unmount), so
 * re-expanding a section shows the list you left, with the field seeded from
 * here as its `defaultValue`.
 *
 * Keyed by section kind (`"jots"`, `"sessions"`, `"files"`).
 *
 * @module components/lens/lens-filter-store
 */

const queryByKind = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

/** Subscribe to filter-query changes across all sections. */
export function subscribeFilterQuery(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A monotonic token that bumps on every change — the `useSyncExternalStore`
 *  snapshot paired with {@link subscribeFilterQuery}. */
export function getFilterVersion(): number {
  return version;
}

/** The section's live filter query; `""` when it has none. */
export function getFilterQuery(kind: string): string {
  return queryByKind.get(kind) ?? "";
}

/** Publish the section's filter query. */
export function setFilterQuery(kind: string, query: string): void {
  if (getFilterQuery(kind) === query) return;
  if (query === "") queryByKind.delete(kind);
  else queryByKind.set(kind, query);
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Test seam — drop every section's query so a test starts from a known state.
 * @internal
 */
export function _clearLensFiltersForTest(): void {
  queryByKind.clear();
  version += 1;
  for (const listener of listeners) listener();
}
