/**
 * layout-miniature.tsx — a scale picture of the deck under one layout.
 *
 * The Layouts picker offers pictures rather than words: every option draws the
 * deck as it would actually stand — the Lens holding the side the deck holds
 * it on, and the cards packed away from it under the chosen N-up rule. Choosing
 * an option is then recognizing the arrangement you want rather than decoding a
 * label for it, the idiom Windows 11's Snap Layouts established.
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

import { slotCount, type ImpositionKind, type LensSide } from "@/lib/layout-imposer";

/** The Lens's share of the miniature's width, in percent. */
const RAIL_PCT = 18;

/** A lone free card's width, in percent of the field it stands in. */
const FREE_CARD_PCT = 46;

/** The imposition gap, in percent of the miniature. */
const GAP_PCT = 2;

/** The space between two cards, in percent of the miniature. Wider than the
 *  imposition gap: at this scale the seam has to survive a device pixel. */
const CARD_GAP_PCT = 3.5;

export interface LayoutMiniatureProps {
  /** The N-up rule to draw, or `null` for no imposition (one free card). */
  kind: ImpositionKind | null;
  /** The side the Lens holds, or `null` to draw the deck without it. */
  lens: LensSide | null;
  /** Draw the cards. `false` draws the deck's frame and Lens alone — the
   *  picture for a question that is only about which edge the Lens holds. */
  cards?: boolean;
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
  cards = true,
  selected = false,
}: LayoutMiniatureProps): React.ReactElement {
  const count = !cards ? 0 : kind === null ? 1 : slotCount(kind);
  // What is left of the miniature once the Lens has taken its strip.
  const field = lens === null ? 100 : 100 - RAIL_PCT - GAP_PCT;
  // The band the blocks share: the field less the gap outside each end.
  const band = Math.max(0, field - GAP_PCT * 2);
  // A deck with no arrangement is one free card, so Off draws a single block
  // standing in the middle of the field rather than filling it.
  const cardPct =
    count < 2
      ? (band * FREE_CARD_PCT) / 100
      : (band - CARD_GAP_PCT * (count - 1)) / count;
  const offsetFor = (k: number): number =>
    count < 2 ? (band - cardPct) / 2 : k * (cardPct + CARD_GAP_PCT);
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
              width: `${cardPct}%`,
            }}
          />
        ))}
      </span>
      {lens === "right" ? <span className="layout-mini-rail" /> : null}
    </span>
  );
}
