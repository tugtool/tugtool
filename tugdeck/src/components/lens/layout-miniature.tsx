/**
 * layout-miniature.tsx — a scale picture of the deck under one layout.
 *
 * The Layouts picker offers pictures rather than words: every option draws the
 * deck as it would actually stand — the Lens holding the side the deck holds
 * it on, and the cards packed away from it under the chosen N-up rule. Choosing
 * an option is then recognizing the arrangement you want rather than decoding a
 * label for it, the idiom Windows 11's Snap Layouts established.
 *
 * The step between blocks is the imposer's own rule in miniature (see
 * `lib/layout-imposer.ts`): one gap when the cards fit, an even overlap when
 * they do not, sized so the strip ends exactly where the Lens begins. That is
 * what makes a four-up tile *look* crowded — the picture tells the truth about
 * what the deck will do.
 *
 * Purely presentational: props in, CSS out, no store reads and no state ([L06]).
 * The live Lens side is passed down by the section so every miniature flips
 * together when the side changes.
 *
 * @module components/lens/layout-miniature
 */

import "./layout-miniature.css";

import React from "react";

import { slotCount, type ImpositionKind, type LensSide } from "@/lib/layout-imposer";

/** The Lens's share of the miniature's width, in percent. */
const RAIL_PCT = 18;

/** One card's width in the chain, in percent of the miniature. */
const CARD_PCT = 26;

/** The imposition gap, in percent of the miniature. */
const GAP_PCT = 2;

/** The width of the single block drawn for "no imposition", in percent. */
const FREE_CARD_PCT = 60;

export interface LayoutMiniatureProps {
  /** The N-up rule to draw, or `null` for no imposition (one free card). */
  kind: ImpositionKind | null;
  /** The side the Lens holds, or `null` to draw the deck without it. */
  lens: LensSide | null;
  /** Draw the arrangement as the chosen one. */
  selected?: boolean;
}

/**
 * LayoutMiniature — the deck, drawn small.
 *
 * With `lens` set, the Lens is a strip on that side and the cards pack away
 * from it, exactly as {@link packFromForRail} decides for the real deck.
 */
export function LayoutMiniature({
  kind,
  lens,
  selected = false,
}: LayoutMiniatureProps): React.ReactElement {
  const count = kind === null ? 1 : slotCount(kind);
  // What is left of the miniature once the Lens has taken its strip.
  const field = lens === null ? 100 : 100 - RAIL_PCT - GAP_PCT;
  // A deck with no arrangement is just a card on a canvas, so Off draws one
  // wide block rather than a chain.
  const cardWidth = kind === null ? FREE_CARD_PCT : CARD_PCT;
  const step =
    count < 2
      ? 0
      : Math.min(GAP_PCT, (field - GAP_PCT * 2 - cardWidth * count) / (count - 1));
  // The chain runs away from the Lens, so a left-side Lens packs the blocks
  // from the right — measured from that edge, the offsets are the same.
  const packFromLeft = lens !== "left";

  return (
    <span
      className="layout-mini"
      data-selected={selected ? "true" : undefined}
      data-lens={lens ?? undefined}
      aria-hidden="true"
    >
      {lens === "left" ? <span className="layout-mini-rail" /> : null}
      <span className="layout-mini-field">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="layout-mini-block"
            style={{
              [packFromLeft ? "left" : "right"]: `${GAP_PCT + i * (cardWidth + step)}%`,
              width: `${cardWidth}%`,
            }}
          />
        ))}
      </span>
      {lens === "right" ? <span className="layout-mini-rail" /> : null}
    </span>
  );
}
