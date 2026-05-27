/**
 * tug-atom-chip.tsx — React component that renders an atom chip as
 * inline `<svg>` with CSS-variable-driven `fill` / `stroke` and
 * font-family inherited from the surrounding text.
 *
 * Companion to `tug-atom-img.ts`'s {@link buildAtomSVGDataUri}, which
 * bakes resolved hex colors AND embeds the editor's custom font face
 * via `@font-face` into a `data:image/svg+xml,…` URI for the editor's
 * CM6 widget (the `<img>` document is isolated from the host CSS
 * cascade, so neither CSS variables nor document-loaded fonts reach
 * inside). This component is the React-side path — `TugAtomTextBody`
 * (transcript chips) and the four tool-block path renderers consume
 * it.
 *
 * Why inline `<svg>` instead of `<img src="data:…">`:
 *  - The chip becomes part of the host DOM, so theme tokens defined
 *    on `:root` / `body` cascade in. A theme switch repaints the
 *    chip for free — no React re-render, no SVG re-bake, no
 *    `getComputedStyle` calls per chip [L06].
 *  - The chip's font-family also flows from the surrounding CSS,
 *    so chips read as part of the transcript prose rather than as
 *    code-surface text borrowed from the editor.
 *  - Layout still uses the shared `.tug-atom-chip` CSS class —
 *    `display: inline-block; vertical-align: middle; margin: 0 2px`
 *    apply equally to `<img>` and `<svg>` inline-level elements.
 *
 * Font policy: chips track the *transcript* font, not the editor's.
 * Earlier drafts subscribed to {@link setAtomFont} so chips would
 * match the user's editor font preference, but with inline-SVG the
 * SVG inherits CSS naturally and the editor's custom face isn't
 * loaded on the body anyway — the subscription was pulling on a
 * thread that didn't end anywhere useful. We resolve the body's
 * font-family once via `getComputedStyle` for Canvas measurement;
 * the SVG `<text>` element inherits the same value through CSS
 * cascade for rendering, so measurement and render agree.
 *
 * Layout math comes from {@link computeAtomChipGeometry} so this
 * component and the editor's data-URI path produce pixel-identical
 * chips at the same font frame.
 *
 * Laws:
 *  - [L06] all chip *colors* flow from CSS variables; the chip
 *    *font* flows from CSS inheritance. React state never drives
 *    appearance. Geometry (width/height) is derived from a memoized
 *    pure computation, not from state.
 *  - [L19] file pair (this `.tsx` + sibling `.css`), exported props
 *    interface, `data-slot` on the root `<svg>`.
 *
 * @module lib/tug-atom-chip
 */

import "./tug-atom-chip.css";

import * as React from "react";

import {
  chipFontSizeForMagnification,
  computeAtomChipGeometry,
} from "./tug-atom-img";
import { TranscriptMagnificationContext } from "./transcript-magnification-context";

/**
 * Lazy-resolved transcript chip font family.
 *
 * Read from `document.body.fontFamily` the first time a chip needs
 * to measure label width. `globals.css` sets the body's font to
 * `var(--tug-font-family-sans)`; `getComputedStyle` resolves that
 * to the actual font-family stack (e.g.
 * `"Inter, system-ui, sans-serif"`). Canvas's `measureText` needs
 * the resolved stack as a string; the SVG `<text>` element inherits
 * the same value through CSS cascade for rendering, so measurement
 * matches what the browser actually paints.
 *
 * Cached at module scope because the body font doesn't change in
 * this app — theme tokens change colors, not the body font. Falls
 * back to a sane system stack if the read fails (test environments
 * without a DOM, etc.).
 */
let _chipFontFamily: string | null = null;
function getChipFontFamily(): string {
  if (_chipFontFamily !== null) return _chipFontFamily;
  try {
    _chipFontFamily =
      getComputedStyle(document.body).fontFamily ||
      "system-ui, sans-serif";
  } catch {
    _chipFontFamily = "system-ui, sans-serif";
  }
  return _chipFontFamily;
}

export interface TugAtomChipProps {
  /** Icon family — `"file"`, `"image"`, `"command"`, `"doc"`, `"link"`. */
  type: string;
  /** Display label rendered inside the chip. */
  label: string;
  /** Raw atom value — surfaced as the native hover tooltip via SVG `<title>`. */
  value: string;
  /** Optional max width in px — labels longer than this truncate with `…`. */
  maxLabelWidth?: number;
  /**
   * Override the chip's pixel font size. When omitted, the size scales
   * from the surrounding {@link TranscriptMagnificationContext}
   * (12px × magnification, floored at 9px). Callers outside the
   * transcript surface don't need to pass anything — the default
   * 1.0 magnification yields a 12px chip.
   */
  fontSize?: number;
  className?: string;
  "data-slot"?: string;
  "data-testid"?: string;
}

/**
 * Render an atom chip as inline `<svg>`. See module docstring for the
 * design rationale and laws.
 */
export const TugAtomChip = React.forwardRef<SVGSVGElement, TugAtomChipProps>(
  function TugAtomChip(props, ref) {
    const {
      type,
      label,
      value,
      maxLabelWidth,
      fontSize: fontSizeOverride,
      className,
      "data-slot": dataSlot,
      "data-testid": dataTestid,
    } = props;
    // Default 1.0 outside a provider — gallery surfaces and other
    // unmagnified renderers get a 12px chip.
    const magnification = React.useContext(TranscriptMagnificationContext);
    const fontSize =
      fontSizeOverride ?? chipFontSizeForMagnification(magnification);
    const chipFontFamily = getChipFontFamily();
    const geom = React.useMemo(
      () =>
        computeAtomChipGeometry(type, label, {
          fontFamily: chipFontFamily,
          fontSize,
          maxLabelWidth,
        }),
      [type, label, chipFontFamily, fontSize, maxLabelWidth],
    );
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={geom.width}
        height={geom.height}
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        className={className}
        data-slot={dataSlot}
        data-testid={dataTestid}
        aria-label={label}
        role="img"
      >
        <rect
          x={0.5}
          y={0.5}
          width={geom.width - 1}
          height={geom.height - 1}
          rx={3}
          fill="var(--tug7-surface-atom-primary-normal-default-rest)"
          stroke="var(--tug7-element-atom-border-normal-default-rest)"
          strokeWidth={1}
        />
        {/* Icon paths are static module-local SVG markup strings
            (see ATOM_ICON_PATHS in tug-atom-img.ts) — using
            dangerouslySetInnerHTML on this <g> is the simplest way
            to splice them in without duplicating each icon as JSX.
            The strings carry no user input; XSS is not a concern. */}
        <g
          transform={geom.iconTransform}
          fill="none"
          stroke="var(--tug7-element-atom-icon-normal-default-rest)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: geom.iconPath }}
        />
        {/* Pin the font-family to the same value the Canvas
            measurement used. Letting the SVG `<text>` inherit via
            CSS cascade caused a clipping bug inside tool-block
            containers whose ambient font is monospace — the SVG
            inherited mono, glyphs grew, but the chip width had
            already been measured with sans. Explicit `fontFamily`
            here guarantees measurement and render agree across
            every surface, regardless of the parent's CSS. */}
        <text
          x={geom.textX}
          y={geom.textY}
          fontSize={geom.fontSize}
          fontFamily={chipFontFamily}
          fill="var(--tug7-element-atom-text-normal-default-rest)"
        >
          {geom.displayLabel}
        </text>
        <title>{value}</title>
      </svg>
    );
  },
);
