/**
 * TugPopupButton — convenience popup button composing TugPopupMenu + TugButton.
 *
 * TugPopupButton is a macOS-style popup button with a fixed visual identity:
 *   emphasis="outlined", role="option", ChevronDown trailing icon.
 *
 * These defaults are intentionally not configurable. [D04] Callers who need a
 * different trigger appearance use TugPopupMenu directly with their own trigger.
 *
 * Per [L11], TugPopupButton is a control: activating a menu item dispatches
 * the item's `action` (with its optional `value` as the payload) through
 * the responder chain. Menu items are typed against `TugAction`, so
 * misspellings are compile errors — the same precedent established by
 * `TugEditorContextMenu` in A1. Value-picker use cases share a single
 * action across all items (typically `"setValue"`) and differ by the
 * item's `value` field; semantic-action use cases can carry a different
 * action per item.
 *
 * Styling delegated to TugButton (trigger appearance) and TugPopupMenu (dropdown).
 * No component CSS — this is a pure composition.
 *
 * Laws: [L11] controls emit actions, [L19] component authoring guide
 * Decisions: [D02] TugPopupMenu takes a single ReactNode trigger prop,
 *            [D04] TugPopupButton defaults are not configurable
 */

import React, { useCallback, useId } from "react";
import { ChevronDown } from "lucide-react";
import { TugButton } from "./internal/tug-button";
import type { TugButtonSize } from "./internal/tug-button";
import { TugPopupMenu } from "./internal/tug-popup-menu";
import type { TugPopupMenuItem } from "./internal/tug-popup-menu";
import { useResponderChain } from "./responder-chain-provider";
import type { TugAction } from "./action-vocabulary";

// ---- Types ----

/**
 * A single item in a TugPopupButton menu. Activating the item dispatches
 * `action` through the responder chain, carrying `value` as the payload.
 *
 * - For value pickers (font size, theme, emphasis, ...), all items share a
 *   single `action` such as `"setValue"` and differ by the `value` field.
 * - For semantic-action menus (file operations, tab add, ...), each item
 *   can carry a distinct `action`.
 *
 * This mirrors the `TugEditorContextMenuItem` precedent introduced in A1,
 * with the addition of an optional `value` payload field. The precedent's
 * type-safety guarantee is preserved: `action` is `TugAction`, so
 * misspellings are compile errors and autocomplete surfaces the vocabulary.
 */
export interface TugPopupButtonItem {
  /**
   * The responder-chain action to dispatch when the item is activated.
   * Typed against `TugAction` so misspellings are compile errors.
   */
  action: TugAction;
  /**
   * Optional payload shipped as the dispatched event's `value` field.
   * For value-picker menus this is the actual value (string, number,
   * string[], etc.); for pure semantic-action menus it can be omitted.
   */
  value?: unknown;
  /** Display label for this item. */
  label: string;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Whether this item is disabled. Disabled items are not interactive. */
  disabled?: boolean;
}

/**
 * Props for TugPopupButton.
 *
 * TugPopupButton always renders a TugButton with emphasis="outlined",
 * role="option", and a ChevronDown trailing icon.
 * These are fixed; pass label, items, optional senderId and size/className.
 */
export interface TugPopupButtonProps {
  /** Label content rendered inside the trigger button. */
  label: React.ReactNode;
  /** List of items to display in the popup menu. */
  items: TugPopupButtonItem[];
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-popup
   * forms by matching this id in their action handler bindings. [L11]
   */
  senderId?: string;
  /** Trigger button size. Default: "md". */
  size?: TugButtonSize;
  /** Additional CSS class names for the trigger button. */
  className?: string;
  /** aria-label for the trigger button. */
  "aria-label"?: string;
  /** data-testid forwarded to the menu content element. */
  "data-testid"?: string;
}

// ---- TugPopupButton ----

/**
 * TugPopupButton -- convenience composition of TugPopupMenu + TugButton.
 *
 * Renders a styled TugButton (outlined-option, ChevronDown)
 * as the trigger for a TugPopupMenu. The button trigger is passed via the
 * TugPopupMenu `trigger` ReactNode prop, implementing the architectural
 * inversion where the trigger owns the menu. [D02, D04]
 *
 * Use TugPopupButton for configuration controls that need a standard
 * macOS-style popup button appearance (muted border, neutral color, chevron).
 * Use TugPopupMenu directly when the trigger needs custom appearance
 * (e.g., tab bar buttons, icon-only triggers), in which case dispatch
 * wiring is the caller's responsibility.
 *
 * On item activation, TugPopupButton dispatches `{action, value, sender,
 * phase: "discrete"}` via `dispatchForContinuation`. If the handling
 * responder returns a continuation callback, it's invoked after the
 * dispatch returns (before the popup menu closes).
 */
export function TugPopupButton({
  label,
  items,
  senderId,
  size = "md",
  className,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: TugPopupButtonProps) {
  // Chain dispatch [L11]. manager is null in standalone previews / unit
  // tests that don't mount a ResponderChainProvider — in that case the
  // dispatch becomes a no-op and the popup still renders and closes
  // correctly, matching the other A2 control conventions.
  const manager = useResponderChain();
  const fallbackSenderId = useId();
  const effectiveSenderId = senderId ?? fallbackSenderId;

  // The internal TugPopupMenu takes items of shape `{id, label, icon,
  // disabled}` and reports `onSelect(id)` after the blink animation.
  // We adapt by using the item's array index (stringified) as the
  // TugPopupMenu id, then look up the original item on callback so we
  // can dispatch its action+value through the chain.
  const internalItems: TugPopupMenuItem[] = items.map((item, index) => ({
    id: String(index),
    label: item.label,
    icon: item.icon,
    disabled: item.disabled,
  }));

  const handleSelect = useCallback(
    (id: string) => {
      if (!manager) return;
      const index = Number.parseInt(id, 10);
      if (Number.isNaN(index)) return;
      const item = items[index];
      if (!item) return;
      // dispatchForContinuation returns { handled, continuation }. If the
      // handler returns a function, run it now (for side effects deferred
      // past the blink feedback — see the TugEditorContextMenu precedent).
      const { continuation } = manager.dispatchForContinuation({
        action: item.action,
        value: item.value,
        sender: effectiveSenderId,
        phase: "discrete",
      });
      continuation?.();
    },
    [manager, items, effectiveSenderId],
  );

  const trigger = (
    <TugButton
      emphasis="outlined"
      role="option"
      size={size}
      trailingIcon={<ChevronDown size={12} />}
      className={className}
      aria-label={ariaLabel}
    >
      {label}
    </TugButton>
  );

  return (
    <TugPopupMenu
      trigger={trigger}
      items={internalItems}
      onSelect={handleSelect}
      data-testid={dataTestId}
    />
  );
}
