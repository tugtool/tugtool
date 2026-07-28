/**
 * list-view-striping.ts — pure resolution of `TugListView`'s `rowStriping`
 * prop into the CSS custom-property values the scroll container writes.
 *
 * Alternating row tint is the other way a dense list separates its rows: where
 * a divider draws a line BETWEEN rows, a stripe tints every other row, so the
 * list reads as banded without spending a pixel of height on rules. A row that
 * costs one line of text is easier to track across with a band than with a
 * hairline, which is the trade the BBEdit open-documents list makes.
 *
 * The tint is a wash of the surface's own FOREGROUND color at low alpha, which
 * is what makes one strength scale work in six themes: the text color is light
 * on the dark themes and dark on the light ones, so the wash always moves the
 * band away from the surface rather than toward it. No theme file declares a
 * stripe color.
 *
 * Kept out of the component so it is unit-testable with no DOM.
 */

/**
 * Named stripe strengths — how far the banded row's tint moves off the
 * surface. Authored as one scale rather than a free number so a consumer picks
 * a rung and every striped list in the app lands on the same few values.
 */
export type TugListViewStripeStrength =
  | "faint"
  | "subtle"
  | "medium"
  | "strong";

/** The object form of `rowStriping` — tune strength and/or color. */
export interface TugListViewRowStripingConfig {
  /**
   * Stripe strength — a named rung, or a NUMBER for the wash alpha as a
   * percent (`4` ⇒ 4%). The number is what a tuning session wants: the rungs
   * are four points on a continuum and the right value for a given list is
   * often between two of them. Default `"subtle"`.
   */
  strength?: TugListViewStripeStrength | number;
  /** Stripe color — any CSS color or token reference. Overrides the
   *  strength-derived foreground wash outright. */
  color?: string;
}

/**
 * `rowStriping` prop type. A strength name or config object turns striping on;
 * `"none"` — like omitting the prop — leaves every row on the host surface.
 */
export type TugListViewRowStriping =
  | TugListViewStripeStrength
  | TugListViewRowStripingConfig
  | "none";

/**
 * The alpha each named rung resolves to, as a percent. Exported because the
 * rung names are the vocabulary but the NUMBERS are what a consumer tuning a
 * list by eye actually reasons about — a tune point that names a rung without
 * showing its value is asking someone to go read another file.
 */
export const STRIPE_STRENGTH_PERCENT: Record<
  TugListViewStripeStrength,
  number
> = {
  faint: 2,
  subtle: 4,
  medium: 7,
  strong: 11,
};

/**
 * Resolved striping. `color` is the value written to
 * `--tugx-list-view-stripe-color`; `resolveRowStriping` returns `null` when
 * there is no striping at all.
 */
export interface ResolvedRowStriping {
  color: string;
}

/** The wash the strength rungs resolve against — the host surface's own text
 *  color, so the band moves away from the surface in every theme. */
const STRIPE_TINT = "var(--tugx-list-view-stripe-tint)";

/**
 * Resolve `rowStriping` to the value the container writes, or `null` for
 * `"none"` / omitted. Pure; exported for the test suite.
 */
export function resolveRowStriping(
  prop: TugListViewRowStriping | undefined,
): ResolvedRowStriping | null {
  if (prop === undefined || prop === "none") return null;
  if (typeof prop === "string") {
    return { color: stripeWash(prop) };
  }
  if (prop.color !== undefined) return { color: prop.color };
  return { color: stripeWash(prop.strength ?? "subtle") };
}

/** The foreground wash for one strength — a named rung or a raw percent. */
function stripeWash(strength: TugListViewStripeStrength | number): string {
  const percent =
    typeof strength === "number"
      ? strength
      : STRIPE_STRENGTH_PERCENT[strength];
  return `color-mix(in srgb, ${STRIPE_TINT} ${percent}%, transparent)`;
}
