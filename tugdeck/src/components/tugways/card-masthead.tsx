/**
 * CardMasthead — the masthead tier for a document card.
 *
 * The three lines are `TugSessionRow`'s, exactly as the Session card's masthead
 * is. **Not a second authoring of them.** The row is presentational — every
 * level arrives as a node — so what makes it a session row at one mount and a
 * document row at another is only what is handed in: a phase dot and a callsign
 * there, a file glyph and a path here. The type, the leading, the truncation,
 * where the sub-lines hang, and what a mount may tune are all the component's,
 * and a document card gets them by composing it rather than by matching it.
 *
 * It was matched, and that is what this replaces. The first authoring of this
 * tier restated the ladder in `card-masthead.css` — its own sizes, its own
 * line-height pairs, its own gaps, an indent derived from the icon's advance
 * instead of from the row's published title inset. Every value was chosen to
 * agree with the session masthead and the result did not: a mount site that
 * re-types a component's type has already drifted, whatever numbers it wrote.
 *
 * The chrome tier's geometry and the row's seating in it are
 * `masthead-frame.css` — shared with the Session card's masthead for the same
 * reason. What is genuinely this card's own is here: the glyph, and a path line
 * that clips its head and can be acted on.
 *
 * @module components/tugways/card-masthead
 */

import React from "react";
import { icons } from "lucide-react";

import type { DocumentMastheadPayload } from "@/lib/card-title-store";
import { TugSessionRow } from "@/components/tugways/tug-session-row";

import "./masthead-frame.css";
import "./card-masthead.css";

export interface CardMastheadProps {
  /** The card's published request, minus its discriminant. */
  payload: DocumentMastheadPayload;
  /**
   * Act on the description line — reveal a path in the Finder, say. Present →
   * the line takes a pointer cursor and a hover underline; absent → it is
   * inert text, which is what a description that names no place should be.
   */
  onActivateDescription?: () => void;
}

/**
 * A path renders start-truncated so the filename survives, and carries a
 * leading Left-to-Right mark so `dir="rtl"` doesn't reorder its leading "/"
 * to the end and make an absolute path look relative. Same treatment the Text
 * card's path strip has always used; it moves here with the line.
 */
function descriptionText(payload: DocumentMastheadPayload): string {
  const text = payload.description ?? "";
  return payload.descriptionKind === "path" ? `‎${text}` : text;
}

export function CardMasthead({
  payload,
  onActivateDescription,
}: CardMastheadProps): React.ReactElement {
  const IconComponent =
    payload.icon && icons[payload.icon as keyof typeof icons]
      ? icons[payload.icon as keyof typeof icons]
      : null;

  const isPath = payload.descriptionKind === "path";
  const actionable = onActivateDescription !== undefined;

  return (
    <div
      className="card-masthead tug-masthead-frame"
      data-slot="card-masthead"
      data-testid="card-masthead"
    >
      <TugSessionRow
        className="card-masthead-row tug-masthead-frame-row"
        /* The two lines below the title start where the TITLE does — three
           lines on two verticals read as a stack that was assembled rather than
           set. A card-wide chrome tier can afford the indent a rail cannot, and
           this is the same setting the session masthead passes. */
        subAlign="title"
        /* No `indicatorSize`. That prop exists so the row can close the title up
           against a PHASE DOT's ink, which is a small disc breathing inside a
           much larger ring — the arithmetic reads the dot glyph's own geometry
           function. A document glyph is solid and fills its box, so handing the
           row a size here would pull it several pixels left of the vertical the
           title bar sets and leave the title sitting closer than the ring case
           ever intends. Omitted, the mark centers in the row's plain advance,
           which is what a solid glyph wants. */
        indicator={
          IconComponent === null ? undefined : (
            <span className="card-masthead-icon" data-testid="card-masthead-icon">
              {React.createElement(IconComponent)}
            </span>
          )
        }
        name={
          <span data-testid="card-masthead-title">{payload.title}</span>
        }
        /* ALWAYS rendered, even when the card names no place. The description
           is what tells the row it is wearing the three-level stack — the lead
           gap, the tight inner step, the sub-line indent, and the tape's
           centering all key off `:has(> .tug-session-row-description)` — so
           omitting it would not merely drop a line, it would hand the masthead
           a two-line row's whole geometry. `dir="rtl"` is what clips a path at
           its head; the row's own line does the eliding. */
        description={
          payload.description === null ? (
            ""
          ) : (
            <span
              className="card-masthead-description"
              data-testid="card-masthead-description"
              data-kind={isPath ? "path" : undefined}
              data-actionable={actionable ? "true" : undefined}
              dir={isPath ? "rtl" : undefined}
              onClick={onActivateDescription}
            >
              {descriptionText(payload)}
            </span>
          )
        }
        /* An EMPTY string, never `undefined`, when the card has no third line.
           The row always draws its last level, and `TugPulse` stands in for an
           absent activity with the word "None" — right for a session, which
           always has something it is or is not doing, and wrong for a document,
           which simply has nothing more to say. An empty run holds the band, so
           a tier whose third line arrives later does not move the two above
           it. */
        activity={
          payload.detail === null || payload.detail === undefined ? (
            ""
          ) : (
            <span data-testid="card-masthead-detail">{payload.detail}</span>
          )
        }
      />
    </div>
  );
}
