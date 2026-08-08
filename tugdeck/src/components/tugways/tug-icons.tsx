/**
 * Tug-authored glyphs — icons drawn for Tug that have no lucide equivalent,
 * expressed in lucide's own icon-node data format so they travel every path a
 * lucide icon travels.
 *
 * lucide covers the vocabulary until it doesn't: `operator` is the assistant
 * `Bot` wearing a headset, a mark lucide has no glyph for (its `Headset` is a
 * bare human headset, its `Bot` has no mic). Rather than hand-rolling an
 * `<svg>` at the call site, the geometry lands here as a `LucideIconNode` —
 * the same `[[tag, attrs], …]` shape `lucide` exports — so it can be handed to
 * {@link TugSpriteIcon} and rendered as `<svg><use/></svg>` against a symbol
 * defined once. That is the transcript-scale contract: a participant icon
 * repeated across thousands of rows costs 2 DOM nodes per row, not 9.
 *
 * Drawn on lucide's 24×24 grid with lucide's stroke conventions (2px, round
 * cap and join, `currentColor`), so it sits beside `Bot`/`User`/`Shell` in the
 * transcript gutter without reading as foreign. The head outline carries an
 * explicit 1.7 `stroke-width`: the glyph packs a headset around a head on the
 * same grid lucide gives the head alone, and the lighter outline keeps the
 * interior from filling in at 20px. Per-element attributes in the symbol
 * override the instance `<svg>`'s inherited stroke width.
 *
 * The other reason a glyph lands here is that it needs to *move*. A lucide
 * icon is a flat run of anonymous `<path>` elements; nothing in it can be
 * addressed, so an animation over part of the drawing has to count
 * nth-of-type and hope the upstream `d` order holds. A glyph authored here
 * names its animatable parts (`.tug-icon-spark`) and declares what they do
 * under a host's `data-tug-activity` in `tug-icons.css` — see
 * {@link PencilSparkles} and `TugButtonActivity`. Those glyphs render inline
 * rather than through the sprite: CSS cannot reach through `<use>`.
 *
 * @module components/tugways/tug-icons
 */

import "./tug-icons.css";

import React from "react";

import {
  TugSpriteIcon,
  type LucideIconNode,
} from "@/components/tugways/tug-sprite-icon";

/**
 * `operator` — bot head with headset and boom mic.
 *
 * Antenna, head, and two eye ticks are the `Bot` silhouette; the earcups and
 * the mic boom hanging under the chin are the headset. The boom's horizontal
 * run clears the jaw by a full grid unit so the two strokes stay separate at
 * icon sizes.
 */
export const operatorIconNode: LucideIconNode = [
  // Antenna: stem up out of the head, flag to the left.
  ["path", { d: "M12 6.4V3.4H8" }],
  // Head.
  [
    "rect",
    { width: 12, height: 11, x: 6, y: 6.9, rx: 2, "stroke-width": 1.7 },
  ],
  // Eyes.
  ["path", { d: "M9.5 11.4v2" }],
  ["path", { d: "M14.5 11.4v2" }],
  // Earcups.
  ["rect", { width: 3, height: 6, x: 2.5, y: 9.4, rx: 1.5 }],
  ["rect", { width: 3, height: 6, x: 18.5, y: 9.4, rx: 1.5 }],
  // Mic boom: down off the right earcup, around, and in under the chin.
  ["path", { d: "M20.2 15.6v2.5a2.5 2.5 0 0 1-2.5 2.5h-3" }],
];

/**
 * Tug glyph registry, keyed by icon name. A consumer that resolves icons from
 * a string (the `icons[name]` lucide lookup in `tug-pane`, `tug-tab-bar`,
 * `tug-sheet`, …) can consult this first and fall through to lucide.
 */
export const TUG_ICON_NODES: Record<string, LucideIconNode> = {
  operator: operatorIconNode,
};

export interface TugGlyphProps {
  /** Width/height in px — matches lucide's `size` prop. Default 24. */
  size?: number;
  className?: string;
  "aria-hidden"?: React.AriaAttributes["aria-hidden"];
}

/**
 * `operator` as a drop-in for a lucide component — same call shape as
 * `<Bot size={20} />`, sprite-backed underneath.
 */
export function Operator(props: TugGlyphProps): React.ReactElement {
  return <TugSpriteIcon name="operator" node={operatorIconNode} {...props} />;
}

/**
 * `pencil-sparkles`, drawn inline so its sparkles can move.
 *
 * The geometry is lucide's `PencilSparkles`, path for path. What lucide
 * cannot give is structure: it emits eight flat sibling `<path>` elements,
 * so the only way to reach "the sparkles, not the pencil" from CSS is to
 * count nth-of-type — a selector that silently starts animating the pencil
 * the day lucide reorders a `d`. Here the three crosses are grouped and
 * named, and the pencil is left as ordinary paths.
 *
 * The class is the contract: a host that carries `data-tug-activity="twinkle"`
 * animates every descendant `.tug-icon-spark`, and the rule that does it
 * lives in `tug-icons.css` next to the glyph rather than in the host. That
 * is what makes the motion belong to the drawing — a button asks for
 * twinkle, and each glyph answers with whatever parts it declared movable,
 * or stays still if it declared none. See `TugButtonActivity`.
 *
 * Inline rather than sprite-backed on purpose: `TugSpriteIcon` renders
 * `<svg><use/></svg>`, and CSS cannot reach through `<use>`'s shadow tree
 * to a part of the symbol. The sharing is worth it for a glyph repeated
 * down a transcript; an animatable one is a handful of instances in
 * toolbars, and it must be reachable.
 */
export function PencilSparkles({
  size = 24,
  strokeWidth = 2,
  className,
  "aria-hidden": ariaHidden = true,
}: TugGlyphProps & {
  /** Stroke weight — matches lucide's `strokeWidth` prop. Default 2. */
  strokeWidth?: number;
}): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-pencil-sparkles${className ? ` ${className}` : ""}`}
      aria-hidden={ariaHidden}
    >
      {/* Pencil: body and nib. Still under every activity — the tool does
          not shake while it writes. */}
      <path d="M21.174 6.813a2.82 2.82 0 0 0-3.986-3.987L3.842 16.175a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15.007 5.008 3.987 3.986" />
      {/* Three sparkles, each a cross of two strokes about its own center.
          The `<g>` is what gives the pair a shared box to scale about; two
          bare paths would each scale about their own midpoint and pull the
          cross apart. Stagger comes from sibling order — see tug-icons.css. */}
      <g className="tug-icon-spark">
        <path d="M10 3H8" />
        <path d="M9 2v2" />
      </g>
      <g className="tug-icon-spark">
        <path d="M4 5v4" />
        <path d="M6 7H2" />
      </g>
      <g className="tug-icon-spark">
        <path d="M20 15v4" />
        <path d="M22 17h-4" />
      </g>
    </svg>
  );
}
