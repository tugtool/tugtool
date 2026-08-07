/**
 * layout-miniature.tsx — a scale picture of the deck under one layout.
 *
 * The Layouts picker offers pictures rather than words: every option draws the
 * deck as it would actually stand — the sidebars holding the sides the deck
 * holds them on, and the cards packed between them under the chosen N-up rule.
 * Choosing an option is then recognizing the arrangement you want rather than
 * decoding a label for it, the idiom Windows 11's Snap Layouts established.
 *
 * Both edges can carry a rail and either can carry more than one card, because
 * the deck's own default stacks the Lens and Jots on the right. Those cards
 * stand front-to-back in one rail, so the picture draws them as a stack of
 * paper — the ones behind peeking out at the top — rather than as a divided
 * strip, which is a different arrangement and not the one the deck paints.
 *
 * The blocks divide the field evenly and never overlap: N cards share the band
 * the imposer packs them into, each one slot wide, with the gap between them.
 * This is the imposer's own anchor rule (see `lib/layout-imposer.ts`) at the
 * width that makes the slots meet edge to edge — the arrangement a deck settles
 * into when every card takes its share. Overlapping blocks were legible as
 * neither cards nor slots, so the picture states the count instead.
 *
 * Purely presentational: props in, CSS out, no store reads and no state ([L06]).
 * The live Lens side is passed down by the section so every miniature flips
 * together when the side changes.
 *
 * @module components/lens/layout-miniature
 */

import "./layout-miniature.css";

import React from "react";

import {
  CONTENT_WIDTH_PX,
  CONTENT_WIDTH_WIDE_PX,
  slotCount,
  type ContentWidth,
  type ImpositionKind,
  type SidebarSide,
} from "@/lib/layout-imposer";

/** One rail's share of the miniature's width, in percent. */
const RAIL_PCT = 18;

/** How many sidebar cards stand on each side. Absent or 0 draws no rail. */
export type MiniatureRails = Partial<Record<SidebarSide, number>>;

/** How far a card behind the front one peeks out of the rail, in percent of
 *  the miniature's height. Small: the picture has to say "there is another card
 *  back there" without implying the rail is divided. */
const RAIL_DEPTH_PCT = 3;

/** A lone free card's width, in percent of the field it stands in. */
const FREE_CARD_PCT = 46;

/** The imposition gap, in percent of the miniature. */
const GAP_PCT = 2;

/** The space between two cards, in percent of the miniature. Wider than the
 *  imposition gap: at this scale the seam has to survive a device pixel.
 *
 *  It is a ceiling rather than a constant — see {@link cardGapFor}. */
const CARD_GAP_PCT = 3.5;

/**
 * The seam between two blocks, given how many share the band.
 *
 * The seam is exaggerated because a real imposition gap drawn to scale is a
 * fraction of a pixel. The exaggeration is affordable while the cards are wide;
 * at six-up, five seams at the full width would spend nearly a quarter of the
 * band on air and leave blocks too thin to read as cards. So the seam is capped
 * at a share of each block: it may never grow past a fifth of the space one
 * card gets, which holds it visible in the sparse arrangements and lets it give
 * way in the dense ones.
 */
function cardGapFor(count: number, band: number): number {
  return Math.min(CARD_GAP_PCT, band / (count * 5));
}

export interface LayoutMiniatureProps {
  /** The N-up rule to draw, or `null` for no imposition (one free card). */
  kind: ImpositionKind | null;
  /** How many sidebar cards stand on each side. */
  rails?: MiniatureRails;
  /** Draw the cards. `false` draws the deck's frame and rails alone — the
   *  picture for a question that is only about which edge a sidebar holds. */
  cards?: boolean;
  /**
   * Draw the cards at a named content width rather than at their share of the
   * band. The widths are drawn relative to each other — `wide` fills the share
   * the arrangement gives a card, and the narrower presets take that share's
   * fraction of it — so the three options in one group read as three widths of
   * the same deck.
   */
  width?: ContentWidth;
  /** Draw the arrangement as the chosen one. */
  selected?: boolean;
}

/**
 * One side's rail, holding `count` cards front-to-back.
 *
 * The members are the same size and stand in one place — that IS the geometry —
 * so a stack is drawn the way a stack of paper is: the ones behind peek out by
 * a few percent at the top. Dividing the strip would draw a rail that splits,
 * which is precisely the arrangement this is not.
 */
function Rail({ count }: { count: number }): React.ReactElement {
  const depth = Math.min(count - 1, 2);
  return (
    <span className="layout-mini-rail">
      {Array.from({ length: depth + 1 }, (_, i) => {
        // Drawn back to front: the last one is the card you are looking at.
        const behind = depth - i;
        return (
          <span
            key={i}
            className="layout-mini-rail-member"
            style={{
              top: `${behind * RAIL_DEPTH_PCT}%`,
              bottom: `${(depth - behind) * RAIL_DEPTH_PCT}%`,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * LayoutMiniature — the deck, drawn small.
 *
 * Each occupied side is a strip of that side's cards and the content cards fill
 * what is left of the frame, numbered left to right as the real deck numbers
 * them.
 */
export function LayoutMiniature({
  kind,
  rails = {},
  cards = true,
  width,
  selected = false,
}: LayoutMiniatureProps): React.ReactElement {
  const left = rails.left ?? 0;
  const right = rails.right ?? 0;
  const count = !cards ? 0 : kind === null ? 1 : slotCount(kind);
  // What is left of the miniature once each side's rail has taken its strip.
  const field = 100 - (left > 0 ? RAIL_PCT + GAP_PCT : 0) - (right > 0 ? RAIL_PCT + GAP_PCT : 0);
  // The band the blocks share: the field less the gap outside each end.
  const band = Math.max(0, field - GAP_PCT * 2);
  // One card has no share to compute — it keeps its own width, which the
  // picture states as a lone block rather than a block filling the band.
  const cardGap = cardGapFor(count, band);
  const share =
    count < 2
      ? (band * FREE_CARD_PCT) / 100
      : (band - cardGap * (count - 1)) / count;
  // A named width narrows the block within its share rather than replacing it:
  // the arrangement still says how much room a card gets, and the width says
  // how much of it the card takes.
  const cardPct =
    width === undefined
      ? share
      : (share * CONTENT_WIDTH_PX[width]) / CONTENT_WIDTH_WIDE_PX;
  // The imposer's own anchor rule, `k / (N − 1) × (band − w)`. At the width
  // that makes the slots meet edge to edge it is exactly `k × (share + gap)`;
  // at a narrower width the blocks spread across the same band, which is what
  // the deck does. One card stands in the middle of the field — the imposer's
  // one-up special case (`travelFraction` gives its single slot half the
  // travel), and equally the picture for a deck with no imposition at all.
  const offsetFor = (k: number): number =>
    count < 2
      ? (band - cardPct) / 2
      : (k / (count - 1)) * (band - cardPct);
  return (
    <span
      className="layout-mini"
      data-selected={selected ? "true" : undefined}
      aria-hidden="true"
    >
      {left > 0 ? <Rail count={left} /> : null}
      <span className="layout-mini-field">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="layout-mini-block"
            style={{
              left: `${GAP_PCT + offsetFor(i)}%`,
              width: `${cardPct}%`,
            }}
          />
        ))}
      </span>
      {right > 0 ? <Rail count={right} /> : null}
    </span>
  );
}
