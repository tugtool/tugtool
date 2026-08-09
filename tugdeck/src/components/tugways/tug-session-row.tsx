/**
 * TugSessionRow — one session, as a row.
 *
 * **One shape, three mounts.** The masthead, the Lens rows, and the
 * new-session picker rows all show the same thing, so the shape is authored
 * once, here, and each of them composes it. Nothing is hand-rolled at a mount
 * site: the component library is the consistency mechanism rather than a
 * convention three surfaces are asked to remember.
 *
 * Three levels, and the order is the reading:
 *
 *   [dot] <name> : <callsign>        ← what it IS, and whether it is working
 *   <description>                    ← what it is FOR
 *   <activity>                  ~~~  ← what it is doing, with its tape
 *
 * There used to be a fourth level between the title and the activity — a
 * standing goal — and a fifth metadata line under it. The description already
 * says what the session is for, so a standing goal beside it read as an echo;
 * and the metadata line's facts (turns, size, stamp) are the activity line's
 * rest form now (`sessionActivityRestLine`). Both are retired rather than
 * merely unused.
 *
 * There is no reorder handle among the furniture. A Lens row is carried by its
 * own surface (`block-reorder`), so every part of the row sits at the row's own
 * edge.
 *
 * The component is PRESENTATIONAL. Every part arrives as a node: the indicator
 * is the caller's phase dot, the slots are the caller's picker, the sparkline is
 * the caller's tape, and the three text levels are `React.ReactNode` so a mount
 * site can hand in filter-highlighted runs. So the Lens mounts it over live
 * stores and the gallery mounts it over fixtures, and the two cannot drift.
 *
 * ── The fit ──────────────────────────────────────────────────────────────
 * A {@link TugSessionRowFit} is a complete proposal for how the row packs, and
 * `inset` is the one that ships: the indicator rides the title line, so both
 * lines beneath it start at the row's own inset and gain the whole leading
 * column. Four other fits were auditioned in the gallery (`gutter`, `reveal`,
 * `wash`, `duplex`) and retired with the audition — the attribute stays because
 * it is what the packing rules select on, not because there is a choice to make.
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
import { sizeGeometry } from "./internal/tug-progress-pulsing-dot";
import { sparklineCurves } from "./tug-sparkline";
import { TugLabel } from "./tug-label";
import { TugListRow, type TugListRowProps } from "./tug-list-row";
import { TugPulse, type TugPulsePreset } from "./tug-pulse";

/**
 * How a session row packs its furniture — the one fit that ships.
 *
 * `inset` moves the indicator onto the title line and hands the whole leading
 * column back to the two lines below it: measured at the Lens rail, a 34px wider
 * activity run for the cost of a 20px advance on the one line that had width to
 * spare. It reads as one row rather than a glyph beside a paragraph, and unlike
 * the fits that also reclaimed the furniture's column it takes no affordance
 * away from the pointer.
 */
export type TugSessionRowFit = "inset";

/** The fit every session row wears. */
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
 * Glyph box for the phase indicator on the denser mounts — the masthead and the
 * picker row.
 *
 * Smaller than {@link TUG_SESSION_ROW_INDICATOR_SIZE} because those are denser
 * than the Lens's monitor row: the dot leads a title that has two lines under it
 * on a tighter measure, and at 28 it would out-shout the name it is marking. The
 * 28 stays where it is — the Lens keeps its indicator, and the size is a caller
 * choice rather than a component change.
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
 * The masthead's own tape (`SPARKLINE_WIDTH` in `session-masthead.tsx`) is a
 * deliberately larger cut of the same instrument — wider, on a shorter bar.
 * Both draw the same `VISIBLE_SECONDS` span, so the two tapes always show the
 * same window of work, each at its own resolution.
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
 * The tape's SHAPE — full-scale in characters, and the perceptual curve.
 * Declared once, here, for every surface that draws a session's activity
 * (the Lens row and the card's masthead): two tapes showing the same session
 * must agree on what "full" means and how loud a burst reads, or the same
 * work would draw two different graphs.
 */
export const TUG_SESSION_SPARK_FULL_SCALE_CHARS = 1200;
export const TUG_SESSION_SPARK_CURVE = sparklineCurves.gamma(0.6);

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

/**
 * The empty room between the dot's INK and the trailing edge of the advance
 * it is centered in — what the title is charged for and the dot does not use.
 *
 * The stylesheet's 20px advance was measured against the Lens's 28px dot,
 * whose ink very nearly fills it. The denser mounts pass 16 — and the glyph's
 * own geometry drops the dot's share of its box from 0.6 to 0.5 down there —
 * so 16px of box is 8px of ink centered in a 20px column with six pixels of
 * nothing on each side. On top of the row's 8px of deliberate air the title
 * then stood 14px off a mark that is meant to be leading it, and it did so on
 * two of the three mounts.
 *
 * The DOT does not move: its box, its center, and its ring are all where they
 * were, and the row's leading edge is unchanged. Only what follows it closes
 * up, by the trailing half of that slack ({@link TugSessionRowProps.indicatorSize}).
 * The ratio is read from {@link sizeGeometry} — the glyph's own function, not
 * a second copy of its numbers — so a change to the dot's proportions moves
 * this with it.
 */
function dotInkSlack(size: number, advance: number): number {
  const trailing = Math.max(0, (advance - size * sizeGeometry(size).ratio) / 2);
  return trailing * DOT_SLACK_RECLAIMED;
}

/**
 * How much of that slack the title actually takes back.
 *
 * Not all of it, by eye. Closing the whole gap seats the name flush against a
 * mark that is still breathing — the ring reaches well past the ink it is
 * measured from, so a title pulled to the ink's edge is periodically pressed
 * by the ring rather than led by it. Half puts the title where the reader
 * reads it as belonging to the dot, with room left for the breath.
 */
const DOT_SLACK_RECLAIMED = 0.5;

/**
 * The advance the slack is measured against — the stylesheet's own default,
 * mirrored here because only script can do the arithmetic. A mount that
 * overrides `--tugx-session-row-dot-advance` also owns the gap that follows
 * it, so it should not pass `indicatorSize`.
 */
const DOT_ADVANCE = 20;

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

  /**
   * The glyph box `indicator` was built at — the same number the mount site
   * hands `SessionPhaseDot`.
   *
   * Given, the row closes the title up against the ink that box actually
   * paints ({@link dotInkSlack}) instead of against the stylesheet's one-size
   * advance, which is how the title comes to sit the same distance off its
   * mark on every mount rather than only on the one the advance was measured
   * against. The dot itself does not move. Omitted, the line packs exactly as
   * it did.
   */
  indicatorSize?: number;

  /**
   * The session's title — the two runs of {@link sessionTitleParts}, usually
   * wrapped in a filter highlight by the mount site. Takes the slack on its
   * line and truncates.
   */
  name?: React.ReactNode;

  /** The layout-imposer slots — the arrangement affordance. */
  slots?: React.ReactNode;

  /**
   * The session's description — the AGENT's rolling synopsis, or the stand-in
   * that fills its place when there is none yet (the session's own first prompt,
   * else its creation stamp). **Not** the user's `/rename` name: that leads the
   * title line above.
   *
   * Rendered whenever the prop is present, EVEN WHEN EMPTY, so a description
   * arriving does not move the line below. A row that does not want the line at
   * all omits the prop entirely.
   */
  description?: React.ReactNode;

  /**
   * Whether {@link description} is a fact STANDING IN for a description nobody
   * has written yet — the session's own first prompt, or its creation stamp.
   * Painted a step quieter, so the reader can tell a described session from one
   * that is merely being placed. Only the mount site knows which rung it
   * resolved, so only the mount site can say.
   * @selector [data-stamp="true"]
   * @default false
   */
  descriptionStandIn?: boolean;

  /**
   * The activity line — the live beat during a turn, and
   * `sessionActivityRestLine`'s sentence otherwise.
   */
  activity?: React.ReactNode;

  /** The activity sparkline. */
  sparkline?: React.ReactNode;

  /**
   * Props for the element wrapping the activity run, forwarded whole to
   * {@link TugPulse}. The gesture surface for anything acting on the activity
   * as a whole — the masthead hangs its right-click copy and its
   * recent-pulses toggle here, so the target is the reading and not the tape
   * beside it.
   */
  stageProps?: React.ComponentProps<"span">;

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
    indicatorSize,
    name,
    slots,
    description,
    descriptionStandIn = false,
    activity,
    sparkline,
    stageProps,
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
  return (
    <TugListRow
      ref={ref}
      className={cn("tug-session-row", className)}
      style={{
        ...SPARK_ADVANCE_STYLE,
        ...(indicatorSize !== undefined
          ? {
              ["--tugx-session-row-dot-slack" as string]: `${dotInkSlack(
                indicatorSize,
                DOT_ADVANCE,
              ).toFixed(2)}px`,
            }
          : null),
        ...style,
      }}
      data-slot="tug-session-row"
      data-fit={fit}
      selected={selected}
      trailing={trailing}
      trailingReveal={trailingReveal}
      disabled={disabled}
      {...rest}
    >
      <span className="tug-session-row-lines">
        <span className="tug-session-row-name-line">
          {indicator !== undefined && indicator !== null ? (
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
            its line rather than collapsing it, so a description arriving does
            not move the line beneath. A row that wants two lines omits it. */}
        {description !== undefined ? (
          <span
            className="tug-session-row-description"
            data-empty={
              description === null || description === "" ? "true" : undefined
            }
            data-stamp={descriptionStandIn ? "true" : undefined}
          >
            {description}
          </span>
        ) : null}
        {/* The activity, and the tape that rides it. Nothing about how the line
            reads is decided here: `TugPulse` owns the face, the leading, where
            the baseline falls, and what a line with nothing to say says. Its
            `headline` level is deliberately not passed — the description above
            already says what the session is for ([D132]). */}
        <TugPulse
          layout="stacked"
          preset={preset}
          activity={activity}
          trailing={sparkline}
          stageProps={stageProps}
        />
      </span>
    </TugListRow>
  );
});
