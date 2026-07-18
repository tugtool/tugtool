/**
 * Public types for the Lens store — the persisted section-arrangement
 * state for the Lens panel (section order, per-section collapse, and
 * the preferred reopen width).
 *
 * The Lens's live geometry (open/width) belongs to the deck layout blob
 * (anchored-pane presence + `size.width`); this store owns only the
 * *arrangement* preferences and the reopen width — a preference, not
 * live geometry.
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
  COLLAPSED_SECTIONS: "collapsedSections",
  ANCHOR_SIDE: "anchorSide",
} as const;

/** Viewport edge the Lens rail pins to; the deck faces the opposite side. */
export type LensAnchorSide = "left" | "right";

/** Default anchor side — the rail opens on the right of the deck. */
export const DEFAULT_LENS_ANCHOR_SIDE: LensAnchorSide = "right";

/** Coerce an arbitrary persisted value to a valid anchor side. */
export function normalizeLensAnchorSide(value: unknown): LensAnchorSide {
  return value === "left" ? "left" : "right";
}

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
  /** Kinds the user has collapsed (band-only). */
  collapsedSections: readonly string[];
  /** Viewport edge the Lens rail pins to. */
  anchorSide: LensAnchorSide;
}
