/**
 * layout-miniature.tsx — a scale picture of the deck under one layout.
 *
 * The Layouts picker offers pictures rather than words: every option draws the
 * deck as it would actually stand — the Lens holding the side the deck holds
 * it on, and the cards packed away from it under the chosen N-up rule. Choosing
 * an option is then recognizing the arrangement you want rather than decoding a
 * label for it, the idiom Windows 11's Snap Layouts established.
 *
 * The blocks sit at the imposer's own anchors in miniature (see
 * `lib/layout-imposer.ts`): each one `k / (N − 1)` of the way across its
 * travel, so the first hugs the far edge, the last meets the Lens, and the
 * ones between space evenly. That is what makes a four-up tile *look* crowded
 * — the picture tells the truth about what the deck will do.
 *
 * Every card is drawn at ONE width, in every tile. Choosing four-up does not
 * make the deck's cards narrower — it packs four anchors into the same band,
 * and the cards overlap. A picture that shrank its blocks as the count rose
 * would be telling the opposite story about the rule it illustrates.
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

/** A card's width, in percent of the miniature. One number for every tile. */
const CARD_PCT = 40;

/** The imposition gap, in percent of the miniature. */
const GAP_PCT = 2;

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
 * from it, exactly as `packFromForRail` decides for the real deck.
 */
export function LayoutMiniature({
  kind,
  lens,
  selected = false,
}: LayoutMiniatureProps): React.ReactElement {
  const count = kind === null ? 1 : slotCount(kind);
  // What is left of the miniature once the Lens has taken its strip.
  const field = lens === null ? 100 : 100 - RAIL_PCT - GAP_PCT;
  // The imposer's rule, in percent: a block's travel is what the band has left
  // over once it has taken its own width, and slot k has crossed `k / (N − 1)`
  // of it.
  const travel = Math.max(0, field - GAP_PCT * 2 - CARD_PCT);
  // A deck with no arrangement is one free card, so Off draws a single block
  // standing in the middle of the field rather than pinned to an anchor.
  const offsetFor = (k: number): number =>
    count < 2 ? travel / 2 : (k / (count - 1)) * travel;
  // Slot 0 is the anchor farthest from the Lens, so a left-side Lens numbers
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
              [packFromLeft ? "left" : "right"]: `${GAP_PCT + offsetFor(i)}%`,
              width: `${CARD_PCT}%`,
            }}
          />
        ))}
      </span>
      {lens === "right" ? <span className="layout-mini-rail" /> : null}
    </span>
  );
}
