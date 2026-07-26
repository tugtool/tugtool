/**
 * Public types for the Lens store — the persisted section-arrangement
 * state for the Lens panel (section order, the Sessions-section row order,
 * per-section collapse, and the preferred reopen width).
 *
 * The Lens's live geometry belongs to the deck layout blob — pane presence is
 * open/closed, `size.width` is the live width, and `imposition.lens` is the
 * side it holds. This store owns only the *arrangement* preferences and the
 * reopen width, which is a preference rather than live geometry.
 *
 * Conformance:
 *   - [L02] external store; React reads via `useSyncExternalStore`.
 *   - State persists across HMR / reloads via tugbank under the
 *     `dev.tugtool.lens` domain — never `localStorage`.
 *
 * @module lib/lens-store/types
 */

/** Tugbank domain owning the Lens's persisted arrangement state. */
export const LENS_DOMAIN = "dev.tugtool.lens";

/** Individual key names within the domain. */
export const LENS_KEYS = {
  WIDTH_PX: "widthPx",
  SECTION_ORDER: "sectionOrder",
  SESSION_ORDER: "sessionOrder",
  COLLAPSED_SECTIONS: "collapsedSections",
} as const;

/**
 * Default reopen width in pixels — matches the historical dev-panel
 * width so an existing user's rail feels the same after the swap.
 */
export const DEFAULT_LENS_WIDTH_PX = 420;

/**
 * Minimum Lens width — narrow enough to not feel oppressive on a small
 * display, wide enough to keep section content legible.
 */
export const MIN_LENS_WIDTH_PX = 320;

/**
 * Public snapshot returned by `LensStore.getSnapshot()`. Stable
 * reference between dispatches that produce no observable change; the
 * `readonly string[]` fields keep their reference too when unchanged.
 */
export interface LensSnapshot {
  /** Preferred reopen width in pixels (the live width lives on the pane). */
  widthPx: number;
  /** Persisted section order, most-preferred first. Unknown kinds tolerated. */
  sectionOrder: readonly string[];
  /**
   * Persisted user order of Sessions-section rows, by `tugSessionId`. Sessions
   * absent from this list (newly bound) sort AFTER the ordered set, so a new
   * session lands at the bottom without disturbing the user's arrangement.
   * Stale ids (closed sessions) are tolerated and ignored as sort keys.
   */
  sessionOrder: readonly string[];
  /** Kinds the user has collapsed (band-only). */
  collapsedSections: readonly string[];
}
