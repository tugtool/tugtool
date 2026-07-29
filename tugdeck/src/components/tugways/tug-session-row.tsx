/**
 * TugSessionRow — one session, as a row.
 *
 * A session's row carries six things and has one line's width to spend on
 * them: the phase indicator, the session's name, the layout-imposer slots,
 * the reorder grip, and the PULSE's three parts (intent, activity, and the
 * activity sparkline). The name and the two PULSE runs are all text that
 * would rather not be cut, and the other four are fixed-width furniture that
 * takes its width off the top. How that width is divided is the row's whole
 * design problem, and this component is where it is decided — once, for every
 * surface that shows a session.
 *
 * The component is PRESENTATIONAL. Every part arrives as a node: the
 * indicator is the caller's `TugProgressIndicator`, the slots are the
 * caller's picker, the sparkline is the caller's tape. So the Lens mounts it
 * over live stores and the gallery mounts it over fixtures, and the two
 * cannot drift — there is no second authoring of the row.
 *
 * ── The fits ─────────────────────────────────────────────────────────────
 * A {@link TugSessionRowFit} is a complete proposal for how the row packs.
 * Each one is a single idea about where the furniture goes, and each one buys
 * width for a specific line:
 *
 *  - `gutter` — the indicator holds a leading column of its own, the slots
 *    ride the name line, the sparkline rides the activity line, the grip
 *    holds a trailing column. Every line starts past the indicator column.
 *    The shape this component was factored out of; kept as the thing the
 *    others are measured against.
 *  - `inset` — the indicator moves ONTO the name line, so the two PULSE
 *    lines start at the row's own inset and gain the whole leading column.
 *    THE DESIGN OF RECORD (see {@link TUG_SESSION_ROW_DEFAULT_FIT}).
 *  - `reveal` — `inset`, plus the slots and the grip move onto the name line
 *    and carry no width until the row is engaged (hovered, selected, holding
 *    focus, or under the keyboard cursor). At rest the name has the full row
 *    and the PULSE lines have the full row.
 *  - `wash` — `inset`, plus the sparkline leaves the flow: it paints behind
 *    the PULSE lines at the trailing edge, so the activity keeps the width
 *    the tape was spending.
 *  - `duplex` — `inset`, plus the two PULSE levels share ONE line, read as
 *    the Z2 strip reads them (`intent › activity`). The row is two lines
 *    instead of three.
 *
 * Only the shape changes. Every fit renders the same nodes, the PULSE's own
 * typography and leading come from `tug-pulse.css` in every one of them, and
 * no fit introduces a type rule — so a fit can be adopted by changing
 * {@link TUG_SESSION_ROW_DEFAULT_FIT} and nothing else moves.
 *
 * Laws: [L06] appearance is CSS on data attributes, never React state;
 *       [L19] `.tsx`/`.css` pair, `data-slot="tug-session-row"`;
 *       [L20] token sovereignty — owns `--tugx-session-row-*` and composes
 *       `TugListRow` / `TugPulse` without reaching into their tokens or
 *       their internals.
 *
 * @module components/tugways/tug-session-row
 */

import "./tug-session-row.css";

import React from "react";

import { cn } from "@/lib/utils";
import { TugLabel } from "./tug-label";
import { TugListRow } from "./tug-list-row";
import { TugPulse, type TugPulsePreset } from "./tug-pulse";

/** How a session row packs its furniture. See the module docstring. */
export type TugSessionRowFit =
  | "gutter"
  | "inset"
  | "reveal"
  | "wash"
  | "duplex";

/** Every fit, in the order the gallery auditions them. */
export const TUG_SESSION_ROW_FITS: readonly TugSessionRowFit[] = [
  "gutter",
  "inset",
  "reveal",
  "wash",
  "duplex",
];

/**
 * The fit every session row wears unless its mount site says otherwise, and
 * the design of record. Changing this line changes the Lens.
 *
 * `inset` is the chosen one: it moves the indicator onto the name line and
 * hands the whole leading column back to both PULSE lines — measured at the
 * Lens rail, a 34px wider activity run for the cost of a 20px advance on the
 * one line that had width to spare. It reads as one row rather than a glyph
 * beside a paragraph, and unlike the fits that also reclaim the furniture's
 * column it takes no affordance away from the pointer.
 */
export const TUG_SESSION_ROW_DEFAULT_FIT: TugSessionRowFit = "inset";

/**
 * Glyph box for the row's phase indicator — the knob for its SIZE, declared
 * here rather than at a mount site so every surface showing a session shows
 * the same dot at the same size.
 *
 * This is the BOX, not the dot: a `pulsing-dot` sheds a ring that travels out
 * to the box edge, and the dot itself paints at 60% of the box at the top of
 * its breath (35% at the bottom). So a running row reads as a `0.6 × size` dot
 * throwing a ring the full width of the box — at 28, a 17px dot inside a 28px
 * ring.
 *
 * A settled row is deliberately smaller, and by the variant's own doing: the
 * component's presence ladder draws stopped / completed in to half the box and
 * paused / aborted to 0.7 of it. Which is the whole reason this size is
 * legible from across the room without every idle session shouting along with
 * it.
 *
 * In the `gutter` fit the indicator holds a column of its own and the size is
 * what the row's leading column costs every line. In the inline-indicator fits
 * it costs only `--tugx-session-row-dot-advance` on the name line, and the
 * rest of the ring overhangs into the row's block padding.
 */
export const TUG_SESSION_ROW_INDICATOR_SIZE = 28;

/**
 * The activity tape's size on a session row. Declared here for the same reason
 * as the indicator's: the tape is a fixed-width accessory whose width comes
 * straight off the activity run's, so the number belongs to the row's packing
 * rather than to whichever surface mounts it.
 */
export const TUG_SESSION_ROW_SPARK_WIDTH = 64;
export const TUG_SESSION_ROW_SPARK_HEIGHT = 18;

/** Fits that carry the indicator inline on the name line rather than in a
 *  leading column of its own. */
const INLINE_INDICATOR_FITS: ReadonlySet<TugSessionRowFit> = new Set([
  "inset",
  "reveal",
  "wash",
  "duplex",
]);

export interface TugSessionRowProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "children" | "title"> {
  /**
   * How the row packs.
   * @selector [data-fit="<fit>"]
   * @default TUG_SESSION_ROW_DEFAULT_FIT
   */
  fit?: TugSessionRowFit;

  /** The PULSE's typographic preset, forwarded whole to {@link TugPulse}. */
  preset?: TugPulsePreset;

  /** Phase indicator — the caller's progress dot. */
  indicator?: React.ReactNode;

  /** The session's name. Takes the slack on its line and truncates. */
  name?: React.ReactNode;

  /** The layout-imposer slots — the arrangement affordance. */
  slots?: React.ReactNode;

  /** The reorder grip. */
  grip?: React.ReactNode;

  /** The PULSE's headline — the session's standing goal. */
  intent?: React.ReactNode;

  /** The PULSE's activity — the operation running now. */
  activity?: React.ReactNode;

  /** The activity sparkline. */
  sparkline?: React.ReactNode;

  /** Selected state, forwarded to the underlying `TugListRow`. */
  selected?: boolean;
}

export const TugSessionRow = React.forwardRef<
  HTMLDivElement,
  TugSessionRowProps
>(function TugSessionRow(
  {
    fit = TUG_SESSION_ROW_DEFAULT_FIT,
    preset,
    indicator,
    name,
    slots,
    grip,
    intent,
    activity,
    sparkline,
    selected,
    className,
    ...rest
  },
  ref,
) {
  const indicatorInline = INLINE_INDICATOR_FITS.has(fit);
  // `reveal` is the fit whose whole proposal is that the furniture costs
  // nothing at rest, so its slots and grip ride the name line where this
  // component can put them under an engagement rule. Every other fit leaves
  // the grip in the row's own trailing-most column.
  const furnitureOnNameLine = fit === "reveal";
  // `wash` takes the tape out of the flow, so it is not the PULSE's trailing
  // accessory there — it is painted behind the lines instead.
  const sparklineInFlow = fit !== "wash";

  return (
    <TugListRow
      ref={ref}
      className={cn("tug-session-row", className)}
      data-slot="tug-session-row"
      data-fit={fit}
      selected={selected}
      leading={indicatorInline ? undefined : indicator}
      grip={furnitureOnNameLine ? undefined : grip}
      {...rest}
    >
      <span className="tug-session-row-lines">
        <span className="tug-session-row-name-line">
          {indicatorInline && indicator !== undefined && indicator !== null ? (
            <span className="tug-session-row-dot">{indicator}</span>
          ) : null}
          <TugLabel className="tug-list-row-title" size="sm" maxLines={1}>
            {name}
          </TugLabel>
          {slots !== undefined && slots !== null ? (
            <span className="tug-session-row-slots">{slots}</span>
          ) : null}
          {furnitureOnNameLine && grip !== undefined && grip !== null ? (
            <span className="tug-session-row-grip">{grip}</span>
          ) : null}
        </span>
        {/* The PULSE. Nothing about how it reads is decided here: `TugPulse`
            owns both faces, the leading between its lines, where each
            baseline falls, and what a level with nothing to say says. */}
        <TugPulse
          layout={fit === "duplex" ? "inline" : "stacked"}
          // A rail-width bar is short enough that a pinned goal would eat the
          // line: on one line, both runs give way.
          giveWay={fit === "duplex" ? "both" : undefined}
          preset={preset}
          headline={intent}
          activity={activity}
          trailing={sparklineInFlow ? sparkline : undefined}
        />
        {sparklineInFlow ? null : (
          <span className="tug-session-row-wash" aria-hidden="true">
            {sparkline}
          </span>
        )}
      </span>
    </TugListRow>
  );
});
