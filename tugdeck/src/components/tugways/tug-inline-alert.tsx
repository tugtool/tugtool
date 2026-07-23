/**
 * TugInlineAlert — the alert *look* without the modality.
 *
 * TugAlert is app-modal: it portals over a scrim, traps focus, and blocks the
 * app until the user responds. Some surfaces want the same calm, human-centric
 * layout — a leading icon, a bold title, an explanatory message, and an
 * optional trailing action row — for a notice that lives *inline* in the normal
 * document flow, alongside other form content, with no overlay and nothing to
 * dismiss. The session picker's "couldn't resume the previous session" banner
 * is the first such case.
 *
 * This component owns only the presentation: the icon + title + message block
 * (drawn from the shared `tugx-header` scale, so it reads as the same family as
 * TugAlert / TugSheet headers) and a bottom-right `actions` row. It has no
 * responder-chain, focus-trap, or promise machinery — a caller who wants
 * buttons composes real `TugPushButton`s into `actions` and wires their own
 * focus / roles / handlers, exactly as they would in ordinary form markup.
 *
 * Laws: [L06] appearance via CSS,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes TugPushButton at the call site).
 *
 * @see ./tug-alert.tsx for the modal sibling.
 */

import "./tug-inline-alert.css";

import React from "react";
import { icons } from "lucide-react";

/** Icon tint domains — mirror the sheet/alert `data-icon-role` family. */
export type TugInlineAlertTone =
  | "muted"
  | "agent"
  | "accent"
  | "action"
  | "caution"
  | "danger";

/** TugInlineAlert props. */
export interface TugInlineAlertProps {
  /** Bold leading line (required). */
  title: string;
  /** Explanatory body under the title. Omit for a title-only alert. */
  message?: string | React.ReactNode;
  /**
   * Lucide icon name (PascalCase — matches `lucide-react` `icons` keys).
   * Pass an empty string to suppress the icon.
   * @default "TriangleAlert"
   */
  icon?: string;
  /**
   * Domain that warms the container border (caution / danger / accent). The
   * icon itself always reads muted — urgency rides the border and the action
   * buttons, not the icon, mirroring TugAlert's grey-icon / colored-button
   * convention.
   * @default "muted"
   */
  tone?: TugInlineAlertTone;
  /**
   * Trailing action row content — typically one or more `TugPushButton`s.
   * Rendered bottom-right under the text. Omit for a message-only alert.
   */
  actions?: React.ReactNode;
  /**
   * ARIA live-region politeness. `"status"` (polite) is the default; pass
   * `"alert"` (assertive) for errors that should interrupt a screen reader.
   * @default "status"
   */
  live?: "status" | "alert";
  /** Extra class on the root, for call-site layout tweaks. */
  className?: string;
}

/**
 * TugInlineAlert — a non-modal, inline alert-styled notice. Composes the shared
 * modal-header layout; the caller supplies action buttons via `actions`.
 */
export function TugInlineAlert({
  title,
  message,
  icon = "TriangleAlert",
  tone = "muted",
  actions,
  live = "status",
  className,
}: TugInlineAlertProps): React.ReactElement {
  const IconComponent = icon
    ? (icons[icon as keyof typeof icons] ?? null)
    : null;

  return (
    <div
      className={
        className ? `tug-inline-alert ${className}` : "tug-inline-alert"
      }
      role={live === "alert" ? "alert" : "status"}
      data-tone={tone}
    >
      <div
        className="tug-inline-alert-body"
        data-has-message={message ? "true" : undefined}
      >
        {IconComponent && (
          <div className="tug-inline-alert-icon" aria-hidden="true">
            {React.createElement(IconComponent, { size: "100%" })}
          </div>
        )}
        <div className="tug-inline-alert-text">
          <div className="tug-inline-alert-title">{title}</div>
          {message && (
            <div className="tug-inline-alert-message">{message}</div>
          )}
        </div>
      </div>
      {actions && <div className="tug-inline-alert-actions">{actions}</div>}
    </div>
  );
}
