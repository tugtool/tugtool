/**
 * TugChartGlyph — a chart as a single glyph, set in the Datatype face.
 *
 * Datatype's OpenType ligatures substitute a literal text expression with a
 * drawn mark: `{p:75}` is a pie filled to 75%, `{b:…}` a row of bars, `{l:…}`
 * a static sparkline. The component's whole job is to build that expression
 * safely and name the mark for assistive technology.
 *
 * What this is for: a fixed quantity that stands still — a work item's
 * completion, a checklist's progress, a ratio in a list row. What it is NOT
 * for: the session activity tape, which is a live series scrolling in real
 * time and stays {@link TugSparkline}. A glyph cannot animate.
 *
 * Laws: [L06] appearance is CSS and the font, never React state;
 *       [L16] the color rule declares its rendering surface;
 *       [L19] `.tsx`/`.css` pair, `data-slot="tug-chart-glyph"`.
 *
 * @module components/tugways/tug-chart-glyph
 */

import "./tug-chart-glyph.css";

import React from "react";

import { cn } from "@/lib/utils";

/** Which mark the expression asks the font for. */
export type TugChartGlyphKind = "pie" | "bar" | "line";

/** The font's expression prefix per mark. */
const KIND_CODE: Record<TugChartGlyphKind, string> = {
  pie: "p",
  bar: "b",
  line: "l",
};

/** The font draws at most this many values; a pie takes exactly one. */
const MAX_VALUES = 20;

export interface TugChartGlyphProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  /** Which mark to draw. */
  kind: TugChartGlyphKind;
  /**
   * The data, each value 0–100. A pie reads the first; a bar row and a
   * sparkline read up to twenty. Values are clamped and rounded — the font's
   * ligature table only matches whole numbers in range, and an unmatched
   * expression would fall through and render as its own source text.
   */
  values: readonly number[];
  /**
   * What the mark says, for assistive technology — "3 of 4 tasks done", not
   * "pie chart". `role="img"` makes the expression itself presentational, so
   * this is the only thing a reader hears.
   */
  label: string;
  /** Datatype's `wdth` axis, 50–150: the mark's density. @default 100 */
  axisWidth?: number;
  /** Datatype's `wght` axis, 100–900: the mark's stroke. @default 400 */
  axisWeight?: number;
}

export const TugChartGlyph = React.forwardRef<
  HTMLSpanElement,
  TugChartGlyphProps
>(function TugChartGlyph(
  { kind, values, label, axisWidth, axisWeight, className, style, ...rest },
  ref,
) {
  const expression = React.useMemo(
    () => buildExpression(kind, values),
    [kind, values],
  );
  return (
    <span
      ref={ref}
      role="img"
      aria-label={label}
      data-slot="tug-chart-glyph"
      data-kind={kind}
      className={cn("tug-chart-glyph", className)}
      style={{
        ...(axisWidth !== undefined
          ? { "--tugx-chart-glyph-width": axisWidth }
          : {}),
        ...(axisWeight !== undefined
          ? { "--tugx-chart-glyph-weight": axisWeight }
          : {}),
        ...style,
      } as React.CSSProperties}
      {...rest}
    >
      {expression}
    </span>
  );
});

/** `{p:75}`, `{b:10,40,90}`, `{l:2,5,3}` — clamped, rounded, and capped. */
function buildExpression(
  kind: TugChartGlyphKind,
  values: readonly number[],
): string {
  const clean = values
    .slice(0, kind === "pie" ? 1 : MAX_VALUES)
    .map((v) => Math.min(100, Math.max(0, Math.round(Number.isFinite(v) ? v : 0))));
  return `{${KIND_CODE[kind]}:${clean.join(",")}}`;
}
