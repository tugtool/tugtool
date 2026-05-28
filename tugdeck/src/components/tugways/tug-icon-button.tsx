/**
 * TugIconButton — focus-refusing icon button for in-list trailing actions.
 *
 * Encapsulates the compose pattern that any trailing-action icon button on a
 * `TugListView` cell (or any in-cell control) needs:
 *
 *  - `data-tug-focus="refuse"` so clicking the button does NOT promote the
 *    chain or move browser focus off the active editor.
 *  - Targeted dispatch via `useControlDispatch()` — payload-carrying
 *    `ActionEvent` reaches the parent responder, not the first responder.
 *  - Standard hover / focus / active styling via the underlying
 *    `TugButton`'s emphasis-role tokens (see [tugplan-dev-picker-redesign
 *    §D16](../../roadmap/tugplan-dev-picker-redesign.md#d16-tug-icon-button)).
 *
 * Why this primitive exists. Per `tuglaws/responder-chain.md` §Focus
 * acceptance, a button that takes browser focus but not chain promotion (or
 * vice versa) is incoherent. Raw `<button>` elements in cells inevitably
 * end up that way — they accept browser focus on click in Chrome, promote
 * the chain via the document-level pointerdown walk, AND fire any wrapping
 * Radix Trigger handlers. TugIconButton bakes in the four-attribute compose
 * pattern (focus refusal + targeted dispatch + ghost styling + size variants)
 * so consumers cannot accidentally produce a non-conformant control.
 *
 * ## Two dispatch modes
 *
 * `TugIconButton` supports two mutually-exclusive ways of responding to a
 * click:
 *
 *  - **Chain-action mode** (`dispatch` prop): the button carries a full
 *    `ActionEvent` (with optional `value` payload). On click the event is
 *    sent to the parent responder via `useControlDispatch().dispatch`. This
 *    is the canonical mode for in-list row actions where the responder
 *    (typically the form above the list) handles the resulting state
 *    change. The action vocabulary lives in `action-vocabulary.ts`.
 *  - **Direct-action mode** (`onClick` prop): the button calls a callback
 *    directly. This exists for one-off cases where the side effect doesn't
 *    fit the chain vocabulary; new code should prefer chain-action mode.
 *
 * The two modes are mutually exclusive: passing both is a programming
 * error and produces a dev-mode console warning. The plumbed click runs
 * `dispatch` if set, falls back to `onClick` otherwise.
 *
 * ## Sender id convention
 *
 * If the caller's `dispatch` event does not include a `sender`, the
 * component substitutes a stable `useId()` value so handlers that
 * disambiguate by sender always have something to look at. A caller that
 * needs deterministic sender ids in tests can pass `senderId` explicitly
 * and the hook uses that value instead of the fallback.
 *
 * ## Visual model
 *
 * Wraps `TugButton` with `subtype="icon"` and `emphasis="ghost"`. The
 * `tone` prop maps to the underlying `role`:
 *
 *  - `tone="default"` → `role="action"` — neutral icon affordance.
 *  - `tone="danger"`  → `role="danger"` — destructive trash / remove
 *    icon, painted with the danger token family on hover/active.
 *
 * Sizing maps directly to `TugButton`'s `size`:
 *
 *  - `size="sm"` (default) → `tug-button-icon-sm` — list-row trailing
 *    actions (~14×14 icon, 24×24 hit target).
 *  - `size="md"`           → `tug-button-icon-md` — denser toolbars.
 *
 * Hover / focus / active treatment comes from the existing
 * `tug-button-ghost-{action,danger}` selectors in `tug-button.css` — no
 * new tokens, no new styles ([L20]).
 *
 * Laws:
 *  - [L06] visual state via DOM attributes + CSS; the click handler does
 *    not setState for visual purposes.
 *  - [L11] controls emit actions; the chain-action mode is the canonical
 *    L11 shape.
 *  - [L19] component authoring guide.
 *  - [L20] no new tokens; styling delegates to `tug-button.css`.
 *
 * Decisions: [tugplan-dev-picker-redesign D16].
 *
 * @module components/tugways/tug-icon-button
 */

import "./tug-icon-button.css";

import React from "react";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { ActionEvent } from "./responder-chain";
import { useControlDispatch } from "./use-control-dispatch";

/* ---------------------------------------------------------------------------
 * TugIconButtonProps
 * ---------------------------------------------------------------------------*/

/** TugIconButton props. */
export interface TugIconButtonProps {
  /** Icon node. Typically a `lucide-react` icon. Required. */
  icon: React.ReactNode;
  /** Accessible label. Required for icon-only buttons. */
  "aria-label": string;
  /** Optional native tooltip (mirrors `aria-label` in many cases). */
  title?: string;
  /**
   * Chain-action mode: a full `ActionEvent` to dispatch on click via
   * `useControlDispatch()`. Mutually exclusive with `onClick`.
   *
   * If the event omits `sender`, the component fills in a stable id
   * (caller-supplied `senderId` if provided, else `useId()`).
   */
  dispatch?: ActionEvent;
  /**
   * Direct-action mode: callback fired on click. Mutually exclusive
   * with `dispatch`. Prefer `dispatch` for chain-routable actions.
   */
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Disable interaction. The button stays in the tab order with
   * reduced opacity (`aria-disabled`-style); follows TugButton's
   * disabled semantics.
   */
  disabled?: boolean;
  /**
   * Size variant.
   *
   *  - `"sm"` (default) — list-row trailing icon (24×24 hit target).
   *  - `"md"`           — denser toolbar action.
   */
  size?: "sm" | "md";
  /**
   * Color tone — maps to TugButton's `role`:
   *
   *  - `"default"` (default) → `role="action"` — neutral icon affordance.
   *  - `"danger"`            → `role="danger"` — destructive trash icon.
   */
  tone?: "default" | "danger";
  /**
   * Stable sender id used when `dispatch` is provided without a
   * `sender`. Auto-derived via `useId()` if omitted. Override in tests
   * for deterministic chain logging.
   */
  senderId?: string;
  /** Additional CSS class names. */
  className?: string;
}

/* ---------------------------------------------------------------------------
 * TugIconButton
 * ---------------------------------------------------------------------------*/

/**
 * Focus-refusing icon button for in-list trailing actions.
 *
 * See module docstring for the dispatch-mode contract, sender-id
 * convention, and visual model.
 */
export const TugIconButton = React.forwardRef<HTMLButtonElement, TugIconButtonProps>(
  function TugIconButton(
    {
      icon,
      "aria-label": ariaLabel,
      title,
      dispatch: dispatchProp,
      onClick,
      disabled = false,
      size = "sm",
      tone = "default",
      senderId: senderIdProp,
      className,
    },
    ref,
  ) {
    const fallbackSenderId = React.useId();
    const senderId = senderIdProp ?? fallbackSenderId;

    const { dispatch: controlDispatch } = useControlDispatch();

    // Dev-mode warning when both modes are set. Mutually exclusive per the
    // module-level contract: the chain-action mode is canonical, the
    // direct-action mode is a fallback for non-chain side effects. Mixing
    // them silently picks `dispatch` and ignores `onClick`, which is
    // surprising; the warn surfaces the bug.
    React.useEffect(() => {
      if (
        dispatchProp !== undefined &&
        onClick !== undefined &&
        process.env.NODE_ENV !== "production"
      ) {
        console.warn(
          "TugIconButton: `dispatch` and `onClick` are mutually exclusive. " +
            "When `dispatch` is set, the chain dispatches on click; `onClick` is ignored.",
        );
      }
    }, [dispatchProp, onClick]);

    // Click handler: chain-action mode wins when `dispatch` is set.
    // Fills in the sender if the caller's event omitted it. Direct-action
    // mode falls through to `onClick`. A button with neither a `dispatch`
    // nor `onClick` is inert — useful for purely decorative-icon-but-must-
    // be-button cases (rare, but the alternative would be a crash).
    function handleClick(e?: React.MouseEvent<HTMLButtonElement>) {
      if (dispatchProp !== undefined) {
        const eventToSend: ActionEvent =
          dispatchProp.sender !== undefined
            ? dispatchProp
            : { ...dispatchProp, sender: senderId };
        controlDispatch(eventToSend);
        return;
      }
      onClick?.(e);
    }

    // Map `tone` to TugButton's role. Ghost emphasis is fixed — TugIconButton
    // is intentionally narrow; a future "filled" variant would be a separate
    // primitive (or a prop addition) earned by a real consumer.
    const role = tone === "danger" ? "danger" : "action";

    return (
      <TugButton
        ref={ref}
        subtype="icon"
        emphasis="ghost"
        role={role}
        size={size}
        icon={icon}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={handleClick}
        data-slot="tug-icon-button"
        className={cn("tug-icon-button", className)}
      />
    );
  },
);
