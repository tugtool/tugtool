/**
 * TugSessionRow — one session, as a row.
 *
 * A session's row carries five things and has one line's width to spend on
 * them: the phase indicator, the session's name, the layout-imposer slots, and
 * the PULSE's three parts (intent, activity, and the activity sparkline). The
 * name and the two PULSE runs are all text that would rather not be cut, and
 * the other two are fixed-width furniture that takes its width off the top.
 * How that width is divided is the row's whole design problem, and this
 * component is where it is decided — once, for every surface that shows a
 * session.
 *
 * There is no reorder handle among them. A Lens row is carried by its own
 * surface (`block-reorder`), so the furniture that used to hold the trailing
 * column is gone and every part of the row sits at the row's own edge.
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
 *    ride the name line, the sparkline rides the activity line. Every line
 *    starts past the indicator column. The shape this component was factored
 *    out of; kept as the thing the others are measured against.
 *  - `inset` — the indicator moves ONTO the name line, so the two PULSE
 *    lines start at the row's own inset and gain the whole leading column.
 *    THE DESIGN OF RECORD (see {@link TUG_SESSION_ROW_DEFAULT_FIT}).
 *  - `reveal` — `inset`, plus the slots carry no width until the row is
 *    engaged (hovered, selected, holding focus, or under the keyboard
 *    cursor). At rest the name has the full row and the PULSE lines have the
 *    full row.
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
import { TugListRow, type TugListRowProps } from "./tug-list-row";
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
 * Glyph box for the phase indicator on the FOUR-LINE identity stack.
 *
 * Smaller than {@link TUG_SESSION_ROW_INDICATOR_SIZE} because the stack is a
 * denser thing than the Lens's monitor row: the dot leads a callsign that has
 * three lines under it rather than one, and at 28 it would out-shout the name
 * it is marking. The 28 stays where it is — the Lens keeps its indicator, and
 * the size is a caller choice rather than a component change.
 *
 * Still the BOX, not the dot: the ring travels to the box edge and the dot
 * paints at 60% of it, so this reads as a ~10px dot in a 16px ring, overhanging
 * into the row's block padding rather than setting its line height.
 */
export const TUG_SESSION_ROW_STACK_DOT_SIZE = 16;

/**
 * The activity tape's size on a session row, before scale. Declared here for
 * the same reason as the indicator's: the tape is a fixed-width accessory
 * whose width comes straight off the activity run's, so the number belongs to
 * the row's packing rather than to whichever surface mounts it.
 *
 * The width is `SPARKLINE_WIDTH` in `session-masthead.tsx`, which is where the
 * Session card's own tape lives now. The pair has to match, not just the scale
 * constants: width sets the scroll speed and height sets the amplitude, so a
 * tape one pixel shorter draws the same series at a different vertical
 * proportion under a stroke that stays 1px. Same session, two surfaces, one
 * reading. (The masthead's tape is shorter — 18 against this 22 — because it
 * rides a `--tugx-pulse-bar-height: 18px` bar; the width, which is the scroll
 * clock, is the number that must not drift.)
 */
const SPARK_BASE_WIDTH = 64;
const SPARK_BASE_HEIGHT = 22;

/**
 * Symmetric scale on the tape. **TUNE HERE** — this is the one knob for how
 * big the row's sparkline is, and both axes move together so the graph never
 * distorts.
 *
 * It is a number rather than a CSS custom property because the tape is a
 * canvas drawn at device resolution for the size it is given: a CSS transform
 * would scale the pixels it already painted (a soft, resampled line) instead
 * of painting fewer, and it would leave the flex item occupying the width it
 * gave up. Scaling the size itself does both.
 *
 * At 1 — the size of record. The tape is a graph read at a glance from a
 * rail, and it is already small; scaling it down to buy the text width
 * costs more legibility than the text gains, and the width the runs need
 * comes from {@link TUG_SESSION_ROW_SPARK_RESERVE} keeping them off the tape
 * rather than from shrinking it.
 *
 * The scroll speed is derived from the width (`VISIBLE_SECONDS` in
 * `tug-sparkline`), so a narrower tape shows the same span more tightly; it
 * does not change what is on screen.
 */
export const TUG_SESSION_ROW_SPARK_SCALE = 1;

export const TUG_SESSION_ROW_SPARK_WIDTH = Math.round(
  SPARK_BASE_WIDTH * TUG_SESSION_ROW_SPARK_SCALE,
);
export const TUG_SESSION_ROW_SPARK_HEIGHT = Math.round(
  SPARK_BASE_HEIGHT * TUG_SESSION_ROW_SPARK_SCALE,
);

/**
 * The tape's width, published to this component's own stylesheet.
 *
 * The tape rides the SECOND stacked line, so that line reserves its width by
 * flex layout and stops short of it on its own. The FIRST does not — the
 * headline runs the whole row and truncates at the row's edge, which puts a
 * long goal straight under a tape that is taller than its own line box and
 * lifted above it besides. So the first line has to be told what to stop
 * short of, and the number it must stop short of is the one right above:
 * declared in TS because the tape's size is, read from CSS because that is
 * where the stopping is done. One source, two readers.
 */
const SPARK_ADVANCE_STYLE = {
  "--tugx-session-row-spark-advance": `${TUG_SESSION_ROW_SPARK_WIDTH}px`,
} as React.CSSProperties;

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

  /**
   * The session's description — its `/rename` name, else its synopsis. Omit
   * for a row that carries only the name line and the PULSE; supply it (with
   * {@link metadata}) for the four-line identity stack.
   *
   * Rendered whenever the prop is present, EVEN WHEN EMPTY, so a rename can
   * fill it without moving the two lines below. A row that does not want the
   * line at all omits the prop entirely.
   */
  description?: React.ReactNode;

  /** The metadata line — `time · turns`. Closes the four-line stack. */
  metadata?: React.ReactNode;

  /** The PULSE's headline — the session's standing goal. */
  intent?: React.ReactNode;

  /** The PULSE's activity — the operation running now. */
  activity?: React.ReactNode;

  /** The activity sparkline. */
  sparkline?: React.ReactNode;

  /** Selected state, forwarded to the underlying `TugListRow`. */
  selected?: boolean;

  /** Trailing accessory — a status badge, a trash action. Forwarded whole. */
  trailing?: React.ReactNode;

  /** When the trailing accessory shows. Forwarded whole. */
  trailingReveal?: TugListRowProps["trailingReveal"];

  /** Disabled appearance and interaction. Forwarded whole. */
  disabled?: boolean;
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
    description,
    metadata,
    intent,
    activity,
    sparkline,
    selected,
    trailing,
    trailingReveal,
    disabled,
    className,
    style,
    ...rest
  },
  ref,
) {
  const indicatorInline = INLINE_INDICATOR_FITS.has(fit);
  // `wash` takes the tape out of the flow, so it is not the PULSE's trailing
  // accessory there — it is painted behind the lines instead.
  const sparklineInFlow = fit !== "wash";

  return (
    <TugListRow
      ref={ref}
      className={cn("tug-session-row", className)}
      style={{ ...SPARK_ADVANCE_STYLE, ...style }}
      data-slot="tug-session-row"
      data-fit={fit}
      selected={selected}
      trailing={trailing}
      trailingReveal={trailingReveal}
      disabled={disabled}
      leading={indicatorInline ? undefined : indicator}
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
        </span>
        {/* The description. Present whenever the prop is — an empty one keeps
            its line rather than collapsing it, so a rename does not move the
            lines beneath. A row that wants three lines omits the prop. */}
        {description !== undefined ? (
          <span
            className="tug-session-row-description"
            data-empty={
              description === null || description === "" ? "true" : undefined
            }
          >
            {description}
          </span>
        ) : null}
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
        {metadata !== undefined && metadata !== null ? (
          <span className="tug-session-row-metadata">{metadata}</span>
        ) : null}
        {sparklineInFlow ? null : (
          <span className="tug-session-row-wash" aria-hidden="true">
            {sparkline}
          </span>
        )}
      </span>
    </TugListRow>
  );
});
