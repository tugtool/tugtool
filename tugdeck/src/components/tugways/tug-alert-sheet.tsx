/**
 * TugAlertSheet — a pane-modal alert with TugAlert's look.
 *
 * `TugAlert` (Radix `AlertDialog`) is app-modal: it portals to the canvas
 * overlay and installs a document-global focus trap. Inside a pane that trap
 * would leak across panes (the cross-pane modality hazard the sheet machinery
 * was hardened against). Rather than re-implement pane-modality on
 * `AlertDialog`, `TugAlertSheet` composes the *proven* pane-modal substrate —
 * `TugSheet` (pane-frame portal + pane scrim + `inert`, no global trap [D15])
 * — and renders `TugAlert`'s exact visual (the shared `.tug-alert-*` layout
 * classes, whose tokens are defined globally on `body`).
 *
 * Presented through any card's `showSheet` host with `hideHeader` so the
 * alert owns the whole panel (icon left, title + message right, actions
 * bottom-right — the classic HIG layout). The confirm button is the sheet's
 * default (Enter); Escape dismisses (resolves `false`).
 *
 * @module components/tugways/tug-alert-sheet
 */

import "./tug-alert.css";

import React from "react";
import { Info } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { TugButtonRole } from "@/components/tugways/tug-push-button";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { useSeedKeyView } from "@/components/tugways/use-focusable";

export interface AlertSheetOptions {
  /** Alert title (required). */
  title: string;
  /** Body content. */
  message?: React.ReactNode;
  /** Leading icon. Defaults to an info glyph. Pass `null` to omit. */
  icon?: React.ReactNode;
  /** Confirm button label. @default "OK" */
  confirmLabel?: string;
  /** Semantic role for the confirm button. @default "action" */
  confirmRole?: TugButtonRole;
  /** Cancel button label, or `null` for a single-button alert. @default null */
  cancelLabel?: string | null;
}

interface TugAlertSheetViewProps extends AlertSheetOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The alert's body, rendered inside a `TugSheet` panel. Reuses the
 * `.tug-alert-*` layout classes so it is visually identical to `TugAlert`.
 */
export function TugAlertSheetView({
  title,
  message,
  icon,
  confirmLabel = "OK",
  confirmRole = "action",
  cancelLabel = null,
  onConfirm,
  onCancel,
}: TugAlertSheetViewProps): React.ReactElement {
  const iconNode =
    icon === undefined ? <Info size={48} aria-hidden="true" /> : icon;
  // Author the actions into the sheet's trapped focus mode: Tab walks Cancel →
  // confirm, with the confirm button seeded as the live default so it opens
  // filled+ring (an action confirm promotes its `primary` tint to the role fill;
  // a danger confirm keeps its fill). Single-button alerts seed the lone confirm.
  const focusGroup = React.useId();
  const CANCEL_ORDER = 0;
  const CONFIRM_ORDER = 1;
  useSeedKeyView(`${focusGroup}:${CONFIRM_ORDER}`);
  return (
    <div className="tug-alert-sheet">
      <div className="tug-alert-body">
        {iconNode !== null ? (
          <div className="tug-alert-icon" aria-hidden="true">
            {iconNode}
          </div>
        ) : null}
        <div className="tug-alert-text">
          <h2 className="tug-alert-title">{title}</h2>
          {message !== undefined && message !== null ? (
            <p className="tug-alert-message">{message}</p>
          ) : null}
        </div>
      </div>
      <div className="tug-alert-actions">
        {cancelLabel !== null ? (
          <TugPushButton
            emphasis="outlined"
            role="action"
            onClick={onCancel}
            data-testid="alert-cancel"
            focusGroup={focusGroup}
            focusOrder={CANCEL_ORDER}
          >
            {cancelLabel}
          </TugPushButton>
        ) : null}
        <TugPushButton
          emphasis={confirmRole === "action" ? "primary" : "filled"}
          role={confirmRole}
          onClick={onConfirm}
          data-testid="alert-confirm"
          focusGroup={focusGroup}
          focusOrder={CONFIRM_ORDER}
        >
          {confirmLabel}
        </TugPushButton>
      </div>
    </div>
  );
}

/**
 * Present a pane-modal alert through a card's `showSheet` host. Resolves
 * `true` if confirmed, `false` if cancelled or dismissed (Escape / Cmd+.).
 *
 * The sheet opens at `sm` width with `hideHeader` so the alert layout owns
 * the panel. The confirm path closes with `"ok"`; everything else resolves
 * `false`.
 */
export function presentAlertSheet(
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>,
  options: AlertSheetOptions,
): Promise<boolean> {
  return showSheet({
    title: options.title,
    displayWidth: "sm",
    hideHeader: true,
    content: (close) => (
      <TugAlertSheetView
        {...options}
        onConfirm={() => close("ok")}
        onCancel={() => close()}
      />
    ),
  }).then((result) => result === "ok");
}
