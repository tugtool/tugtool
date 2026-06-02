/**
 * list-view-separator.ts — pure resolution of `TugListView`'s
 * `rowSeparator` prop into the CSS custom-property values the scroll
 * container writes.
 *
 * `TugListView` draws a 1px hairline divider below each cell in the
 * `flush` row layout. `rowSeparator` lifts that hardcoded hairline into
 * a prop: tune its thickness, recolor it, or turn it off. This module is
 * the pure mapping from the prop to concrete values — kept out of the
 * component so it is unit-testable with no DOM.
 *
 * Defaults are byte-identical to the pre-`rowSeparator` behavior:
 * omitting the prop resolves to a hairline using the divider token's
 * default color, so the flush divider renders exactly as before.
 */

/** Named divider thicknesses. */
export type TugListViewSeparatorThickness = "hairline" | "thin" | "medium";

/** The object form of `rowSeparator` — tune thickness and/or color. */
export interface TugListViewRowSeparatorConfig {
  /** Divider thickness. Default `"hairline"` (1px). */
  thickness?: TugListViewSeparatorThickness;
  /** Divider color — any CSS color or token reference. Default: the
   *  `--tugx-list-view-divider-color` token. */
  color?: string;
}

/**
 * `rowSeparator` prop type. An object tunes the divider; `"none"`
 * removes it entirely. Omitted (`undefined`) reproduces today's
 * hairline.
 */
export type TugListViewRowSeparator = TugListViewRowSeparatorConfig | "none";

/**
 * Resolved separator. `thickness` is a CSS length for
 * `--tugx-list-view-divider-thickness`; `color` is an override for
 * `--tugx-list-view-divider-color`, or `null` to leave the token at its
 * theme default. `resolveRowSeparator` returns `null` for the `"none"`
 * case — no divider at all.
 */
export interface ResolvedRowSeparator {
  thickness: string;
  color: string | null;
}

/** Named thickness → CSS length. */
const THICKNESS_PX: Record<TugListViewSeparatorThickness, string> = {
  hairline: "1px",
  thin: "1.5px",
  medium: "2px",
};

/**
 * Resolve `rowSeparator` to the values the container writes, or `null`
 * for `"none"`. Pure; exported for the test suite.
 *
 * - `"none"` → `null` (suppress the divider).
 * - `undefined` → hairline, token-default color (today's behavior).
 * - object → the named thickness as px; `color` override or `null`.
 */
export function resolveRowSeparator(
  prop: TugListViewRowSeparator | undefined,
): ResolvedRowSeparator | null {
  if (prop === "none") return null;
  const thickness = THICKNESS_PX[prop?.thickness ?? "hairline"];
  const color = prop?.color ?? null;
  return { thickness, color };
}
