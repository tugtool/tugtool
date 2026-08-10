/**
 * CardMasthead — the masthead tier for a document card.
 *
 * The Session card's masthead is a composed `TugSessionRow` because a session
 * has a row shape that three surfaces share ([D132]). A document card has no
 * such shape: its lines are a name, a place, and at most one summary. This is
 * that ladder, and the only thing it has in common with the session masthead
 * is the geometry of the tier they both sit in — the lead line seated where a
 * one-line title bar seats its title, the lines below hanging into the rest of
 * the tier and running under the control cluster's dead space.
 *
 * That geometry is stated once, in `card-masthead.css`, and the session
 * masthead's own file states it again for its own row. Sharing it is the next
 * step, not this one: the two disagree about what line one contains (a glyph
 * and a name here, a phase dot and a callsign there) and about whether lines
 * two and three carry instruments, and a base class that has to be overridden
 * on both counts is not yet a base class.
 *
 * @module components/tugways/card-masthead
 */

import React from "react";
import { icons } from "lucide-react";

import type { DocumentMastheadPayload } from "@/lib/card-title-store";

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
    <div className="card-masthead" data-testid="card-masthead">
      <div className="card-masthead-lead">
        {IconComponent && (
          <span className="card-masthead-icon" data-testid="card-masthead-icon">
            {React.createElement(IconComponent)}
          </span>
        )}
        <span className="card-masthead-title" data-testid="card-masthead-title">
          {payload.title}
        </span>
      </div>

      {payload.description !== null && (
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
      )}

      {payload.detail !== null && payload.detail !== undefined && (
        <span className="card-masthead-detail" data-testid="card-masthead-detail">
          {payload.detail}
        </span>
      )}
    </div>
  );
}
