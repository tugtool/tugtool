/**
 * TugContextMenu — Right-click context menu wrapping @radix-ui/react-context-menu.
 *
 * A compositional component: all visual identity is delegated to tug-menu.css [L20].
 * No component CSS file — uses the same `.tug-menu-*` classes and `--tugx-menu-*`
 * tokens as TugPopupMenu, sharing the menu token owner without duplication.
 *
 * The `children` prop is the right-click target area (a card, a row, a region),
 * wrapped by Radix ContextMenu.Trigger with asChild. Items carry a typed
 * `action: TugAction` (optionally with a `value` payload). Activation plays
 * the shared double-blink WAAPI animation and then dispatches the action
 * through the responder chain via targeted `dispatchToForContinuation`,
 * matching the TugPopupButton precedent [L11].
 *
 * ## Chain-reactive dismissal via observeDispatch
 *
 * While the menu is open, TugContextMenu subscribes to
 * `manager.observeDispatch`. Any action flowing through the chain — a
 * keyboard shortcut, a button click elsewhere, a programmatic dispatch —
 * dismisses the menu. The menu's own item activations are guarded by
 * `blinkingRef`: during the blink-animate-then-dispatch window, blinkingRef
 * is true and the observer skips its close so the menu can finish its own
 * animation. Matches the `tug-popup-menu` and `tug-editor-context-menu`
 * precedents.
 *
 * Because Radix ContextMenu is uncontrolled by design (no `open` /
 * `defaultOpen` props — it opens only on a native contextmenu event),
 * both the chain-reactive dismiss and the post-blink close synthesize a
 * document-level Escape keydown to trigger Radix's own dismiss path. We
 * still track local open state via `onOpenChange` so the effect can
 * install and tear down cleanly.
 *
 * When rendered outside a ResponderChainProvider (standalone previews,
 * unit tests without a provider), `useResponderChain()` returns null and
 * the dispatch + subscription are silently skipped. The menu still
 * renders, opens via right-click, and closes via the native Escape path.
 *
 * Laws: [L06] appearance via CSS/DOM, [L11] controls emit actions,
 *       [L16] foreground rules declare surfaces, [L19] component authoring guide,
 *       [L20] token sovereignty
 */

import "./tug-menu.css";

import React, { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { playMenuItemBlink } from "@/components/tugways/tug-menu-item-blink";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import type { TugAction } from "./action-vocabulary";
import { useControlDispatch } from "./use-control-dispatch";

// ---- Types ----

/**
 * Payload types supported by the `value` field of a `TugContextMenuItem`.
 *
 * Mirrors `TugPopupButtonPayload` — the same runtime-narrowable shapes
 * that `useResponderForm`'s binding slots expect. A single items array is
 * homogeneous: every item's `value` has the same type `V`, enforced at
 * compile time via the generic parameter on `TugContextMenuItem<V>`.
 */
export type TugContextMenuItemPayload = boolean | number | string | string[];

/**
 * A single action item in the context menu. Activating the item dispatches
 * `action` through the responder chain, carrying `value` as the payload.
 *
 * Mirrors `TugPopupButtonItem<V>`: for semantic-action menus, each item
 * carries a distinct `action` and `value` is usually undefined. For
 * value-picker use cases (rare for a context menu but supported), all
 * items share one `action` such as `TUG_ACTIONS.SET_VALUE` and differ by
 * the `value` field.
 *
 * The default type parameter is `never`, which forces consumers who pass
 * `value` to annotate the items array explicitly. Semantic-action items
 * with no payload work with the default and do not require annotation.
 */
export interface TugContextMenuItem<V extends TugContextMenuItemPayload = never> {
  /**
   * Entry type. Omit or set to "item" for action items.
   * @default "item"
   */
  type?: "item";
  /**
   * The responder-chain action to dispatch when the item is activated.
   * Typed against `TugAction` so misspellings are compile errors.
   */
  action: TugAction;
  /**
   * Optional payload shipped as the dispatched event's `value` field.
   * For pure semantic-action items, omit. For value pickers, all items
   * in a single array must share the same `V`.
   */
  value?: V;
  /** Display label for this item. */
  label: string;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Optional keyboard shortcut hint rendered after the label. */
  shortcut?: string;
  /** Whether this item is disabled. Disabled items are not interactive. */
  disabled?: boolean;
}

/** A horizontal rule separating item groups. */
export interface TugContextMenuSeparator {
  type: "separator";
}

/** A non-interactive section label. */
export interface TugContextMenuLabel {
  type: "label";
  /** Label text. */
  label: string;
}

/** Discriminated union of all entry types in a TugContextMenu items array. */
export type TugContextMenuEntry<V extends TugContextMenuItemPayload = never> =
  | TugContextMenuItem<V>
  | TugContextMenuSeparator
  | TugContextMenuLabel;

// ---- Props ----

export interface TugContextMenuProps<V extends TugContextMenuItemPayload = never> {
  /** Menu entries — action items, separators, and section labels. */
  items: TugContextMenuEntry<V>[];
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-menu
   * forms by matching this id in their action handler bindings. [L11]
   */
  senderId?: string;
  /** The right-click target area. Wrapped by Radix ContextMenu.Trigger with asChild. */
  children: React.ReactElement;
}

// ---- Internal helpers ----

/**
 * Synthesize a document-level Escape keydown to dismiss the open Radix
 * ContextMenu. Radix ContextMenu is uncontrolled, so this is the only
 * programmatic close path available.
 */
function synthesizeEscapeDismiss(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

// ---- TugContextMenu ----

/**
 * TugContextMenu — right-click context menu with chain-native activation
 * and chain-reactive dismissal.
 *
 * Items carry typed `action: TugAction` (+ optional payload); selection
 * dispatches via `manager.sendToFirstResponderForContinuation` after the shared
 * double-blink animation. While open, the menu subscribes to
 * `observeDispatch` so external chain activity dismisses it (menu's own
 * activations are guarded by `blinkingRef`).
 */
export function TugContextMenu<V extends TugContextMenuItemPayload = never>({
  items,
  senderId,
  children,
}: TugContextMenuProps<V>) {
  // Guards against re-entrant blink calls during animation. Also used by
  // the observeDispatch observer to skip dismissal while the menu is
  // dispatching its own action (so the blink can finish before close).
  const blinkingRef = useRef(false);

  // Local mirror of Radix's internal open state. Radix ContextMenu is
  // uncontrolled (no open/defaultOpen props), but onOpenChange still fires
  // so we can gate the observeDispatch effect on open.
  const [open, setOpen] = useState(false);

  // Chain manager for observeDispatch subscription. Null outside a provider.
  const manager = useResponderChain();
  // Targeted dispatch to parent responder.
  const { dispatchForContinuation } = useControlDispatch();

  const fallbackSenderId = useId();
  const effectiveSenderId = senderId ?? fallbackSenderId;

  // Subscribe to observeDispatch while the menu is open. Any action
  // flowing through the chain dismisses the menu, with one exception:
  // the menu's own item activation sets blinkingRef=true for the
  // duration of the blink-animate-then-dispatch window, and the
  // observer skips its close so the menu can finish its animation.
  // Matches the tug-popup-menu / tug-editor-context-menu precedent.
  // Uses useLayoutEffect per [L03] so the subscription is in place
  // before any paint that could deliver a pointer or key event through
  // the chain. [L11]
  useLayoutEffect(() => {
    if (!open || !manager) return;
    return manager.observeDispatch(() => {
      if (blinkingRef.current) return;
      synthesizeEscapeDismiss();
    });
  }, [open, manager]);

  const handleItemSelect = useCallback(
    (entry: TugContextMenuItem<V>, event: Event) => {
      // Prevent Radix from immediately closing the menu — we drive the
      // close ourselves after the blink animation completes.
      event.preventDefault();

      if (blinkingRef.current) return;
      blinkingRef.current = true;

      const target = event.currentTarget as HTMLElement;

      // Drive the shared double-blink feedback, then dispatch the item's
      // action through the chain. The dispatch happens while blinkingRef
      // is still true so our own observeDispatch subscription skips the
      // self-dismiss path. After the dispatch, reset the guard and
      // synthesize an Escape keydown to close the Radix menu. [L06]
      playMenuItemBlink(target).then(() => {
        // Targeted dispatch to parent responder with continuation.
        const { continuation } = dispatchForContinuation({
          action: entry.action,
          value: entry.value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
        continuation?.();
        blinkingRef.current = false;
        synthesizeEscapeDismiss();
      });
    },
    [dispatchForContinuation, effectiveSenderId],
  );

  return (
    <ContextMenuPrimitive.Root onOpenChange={setOpen}>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          data-slot="tug-context-menu"
          className="tug-menu-content"
        >
          {items.map((entry, index) => {
            if (entry.type === "separator") {
              return (
                <ContextMenuPrimitive.Separator
                  key={index}
                  className="tug-menu-separator"
                />
              );
            }

            if (entry.type === "label") {
              return (
                <ContextMenuPrimitive.Label
                  key={index}
                  className="tug-menu-label"
                >
                  {entry.label}
                </ContextMenuPrimitive.Label>
              );
            }

            // Default: action item (type === "item" or type is undefined)
            return (
              <ContextMenuPrimitive.Item
                key={`${entry.action}-${index}`}
                className="tug-menu-item"
                disabled={entry.disabled}
                onSelect={(event) => handleItemSelect(entry, event)}
              >
                {entry.icon !== undefined && (
                  <span className="tug-menu-item-icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                )}
                <span className="tug-menu-item-label">{entry.label}</span>
                {entry.shortcut !== undefined && (
                  <span className="tug-menu-item-shortcut">{entry.shortcut}</span>
                )}
              </ContextMenuPrimitive.Item>
            );
          })}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
