/**
 * TugEditorContextMenu — lightweight context menu for editor surfaces.
 *
 * Purpose-built for contentEditable and input contexts where Radix's
 * focus-scope and focus-trap management would hide the selection
 * highlight and break clipboard shortcuts. Uses the industry-standard
 * editor-menu pattern: a portaled positioned <div> with
 * mousedown-preventDefault items so focus never leaves the trigger.
 *
 * Invariants:
 *
 * - Focus never moves. Each item handles onMouseDown with preventDefault,
 *   which suppresses the browser's default focus shift. The editor
 *   retains focus for the entire menu lifecycle, so:
 *     (a) the contentEditable selection stays visually painted;
 *     (b) callers can run document.execCommand and navigator.clipboard.*
 *         inside the mousedown handler — a synchronous user gesture.
 *
 * - Actions flow through the responder chain [L11]. Each item's `id`
 *   is the action name dispatched via manager.sendToFirstResponderForContinuation.
 *   The first responder (typically the editor that opened the menu)
 *   provides the handler. Handlers may return a continuation callback
 *   for two-phase execution: the sync body runs inside the user
 *   gesture, the continuation runs after the activation blink for
 *   visible side effects — so the user sees flash feedback first,
 *   then the result (cut, paste, etc.).
 *
 * - Mouse dismissal: window-level capture-phase mousedown outside the
 *   menu closes it. Mousedowns inside the menu element are ignored.
 *
 * - Dispatch-observer dismissal: the menu subscribes to the responder
 *   chain's observeDispatch while open. Any action flowing through the
 *   chain (keyboard shortcut, button click, programmatic dispatch)
 *   while the menu is open — other than the menu's own item
 *   activation — dismisses the menu. Uses blinkingRef to skip
 *   self-triggered dispatches during activation. This generalizes
 *   "close on external shortcut" through a single signal.
 *
 * - Keyboard contract while the menu is open (handled at window
 *   capture before the responder chain sees the keydown):
 *     • Escape or ⌘. → close the menu.
 *     • Enter or Space → activate the keyboard-selected item.
 *     • ArrowDown / ArrowUp → cycle through actionable items,
 *       wrapping at the ends. If no item is highlighted yet,
 *       ArrowDown selects the first and ArrowUp selects the last.
 *     • Home / End → jump to the first or last actionable item.
 *     • Printable character → typeahead select: the character is
 *       appended to a 500ms-reset buffer and the first actionable
 *       item whose label begins with the buffer becomes
 *       keyboard-selected. The character does not reach the editor.
 *     • ⌘/Ctrl/Alt + anything else → close the menu and let the event
 *       continue. If the shortcut is in the keybinding map, the
 *       responder chain dispatches its action and the dispatch
 *       observer closes the menu redundantly. If not, this branch is
 *       the sole dismiss path.
 *     • Any other non-character key (Tab, function keys) → close the
 *       menu and let the event continue.
 *
 * - Visual identity: shared with TugContextMenu via tug-menu.css
 *   classes and tug-menu-item-blink.ts for the activation flash.
 *   Every menu in the suite looks and reacts identically [L20].
 *
 * When to use: over contentEditables, inputs, or any focus-sensitive
 * editing surface. For menus over buttons/rows/tree nodes, use the
 * Radix-backed TugContextMenu instead.
 *
 * Laws: [L03] register event listeners in useLayoutEffect,
 *       [L06] appearance via CSS/DOM, never React state,
 *       [L07] handlers access current state through refs,
 *       [L11] controls emit actions; responders handle actions,
 *       [L13] motion compliance — durations scale via --tug-timing,
 *       [L16] color-setting rules declare their rendering surface,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty — visual identity owned by tug-menu.css
 */

import "./tug-menu.css";
import "./tug-editor-context-menu.css";

import React, {
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { playMenuItemBlink } from "./tug-menu-item-blink";
import { useRequiredResponderChain } from "./responder-chain-provider";
import type { TugAction } from "./action-vocabulary";

// ---- Typed entry shapes ----
//
// TugEditorContextMenu has its own entry types, distinct from
// tug-context-menu's TugContextMenuEntry, so the `action` field can
// be typed as `TugAction`. Typos in an item's action are compile
// errors at the item definition site, not runtime `handled: false`
// dead-ends. This is the L11-correct shape: a control emitting a
// typed action name, with no string coercion anywhere on the path
// from item definition to chain dispatch.

/**
 * An action item in an editor context menu. Activating the item
 * dispatches `action` through the responder chain.
 */
export interface TugEditorContextMenuItem {
  /** Entry discriminator. Omit or set to "item" for action items. */
  type?: "item";
  /**
   * The responder-chain action to dispatch when the item is
   * activated. Typed against `TugAction` so misspellings are compile
   * errors and autocomplete surfaces the vocabulary.
   */
  action: TugAction;
  /** Display label for this item. Also used as the typeahead match target. */
  label: string;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  /** Optional keyboard shortcut hint rendered after the label (display only). */
  shortcut?: string;
  /** Whether this item is disabled. Disabled items are skipped by typeahead and not activatable. */
  disabled?: boolean;
}

/** A horizontal rule separating item groups. */
export interface TugEditorContextMenuSeparator {
  type: "separator";
}

/** A non-interactive section label. */
export interface TugEditorContextMenuLabel {
  type: "label";
  /** Label text. */
  label: string;
}

/** Discriminated union of all entry types in a TugEditorContextMenu items array. */
export type TugEditorContextMenuEntry =
  | TugEditorContextMenuItem
  | TugEditorContextMenuSeparator
  | TugEditorContextMenuLabel;

export interface TugEditorContextMenuProps {
  /** Whether the menu is open. */
  open: boolean;
  /** Viewport x coordinate of the anchor point (typically clientX of the contextmenu event). */
  x: number;
  /** Viewport y coordinate of the anchor point (typically clientY of the contextmenu event). */
  y: number;
  /**
   * Menu entries — items, separators, and section labels. Each action
   * item's `action` field is the responder-chain action name
   * dispatched when the item is activated. The responder that handles
   * the dispatch must be the first responder (or an ancestor) when
   * the item is activated — typically the editor that opened the
   * menu.
   */
  items: TugEditorContextMenuEntry[];
  /** Called when the menu should close (Escape, outside click, or after a selection). */
  onClose: () => void;
}

/** Gap in px between the menu and the viewport edge when flipping. */
const VIEWPORT_MARGIN = 8;

/** How long the typeahead buffer persists between keystrokes. */
const TYPEAHEAD_BUFFER_TIMEOUT_MS = 500;

/** True if the entry is a selectable, non-disabled action item. */
function isActionable(entry: TugEditorContextMenuEntry): entry is TugEditorContextMenuItem {
  if (entry.type === "separator" || entry.type === "label") return false;
  return !entry.disabled;
}

export function TugEditorContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: TugEditorContextMenuProps) {
  const manager = useRequiredResponderChain();
  const menuRef = useRef<HTMLDivElement>(null);

  // Two-pass positioning: the JSX renders the menu off-screen with
  // visibility:hidden. useLayoutEffect measures the actual size and
  // writes the final position + visibility directly to the DOM [L06].
  // Using React state for position would trigger an extra render
  // cycle; direct style writes on the ref avoid it. `positionedRef`
  // prevents re-positioning on subsequent renders (which could happen
  // if `items` changes while the menu is open).
  const positionedRef = useRef(false);

  // All transient UI state lives in refs with direct DOM mutation [L06].
  // The only React state is `open` (mount/unmount lifecycle) via the prop.
  const itemsRef = useRef(items);
  const onCloseRef = useRef(onClose);
  // Keyboard-selected item's action (the item painted via data-highlighted).
  // Updated by typeahead and pointer enter; writes bypass React state
  // and imperatively set the attribute on the matching DOM node.
  const selectedActionRef = useRef<TugAction | null>(null);
  const typeBufferRef = useRef("");
  const typeBufferTimerRef = useRef<number | null>(null);
  // Re-entrancy guard: while the activation blink is in flight, ignore
  // additional activation attempts. Reset when the menu closes.
  const blinkingRef = useRef(false);

  useLayoutEffect(() => { itemsRef.current = items; }, [items]);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Reset all transient state whenever the menu closes so the next
  // open starts fresh.
  useLayoutEffect(() => {
    if (open) return;
    positionedRef.current = false;
    selectedActionRef.current = null;
    typeBufferRef.current = "";
    if (typeBufferTimerRef.current !== null) {
      window.clearTimeout(typeBufferTimerRef.current);
      typeBufferTimerRef.current = null;
    }
    blinkingRef.current = false;
  }, [open]);

  /**
   * Imperatively set the highlighted menu item. Queries the DOM by
   * data-item-action and toggles the `data-highlighted` attribute.
   * Avoids React state for appearance per L06 — single item
   * highlighted at any instant, no render cycle, driven by both
   * keyboard typeahead and pointer enter so mouse and keyboard share
   * one selection.
   */
  const setHighlightedItem = useCallback((action: TugAction | null) => {
    const menu = menuRef.current;
    if (!menu) return;
    selectedActionRef.current = action;
    // Clear any previously-highlighted item.
    menu.querySelectorAll<HTMLElement>("[data-highlighted]").forEach((el) => {
      el.removeAttribute("data-highlighted");
    });
    // Mark the new one, if any.
    if (action) {
      const escAction = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(action) : action;
      const next = menu.querySelector<HTMLElement>(`[data-item-action="${escAction}"]`);
      next?.setAttribute("data-highlighted", "");
    }
  }, []);

  // Position the menu after it mounts by writing directly to style [L06].
  // No React state, no extra render.
  useLayoutEffect(() => {
    if (!open) return;
    if (positionedRef.current) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    }
    if (top + rect.height > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, vh - rect.height - VIEWPORT_MARGIN);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
    positionedRef.current = true;
  }, [open, x, y]);

  /**
   * Activate an item. Two-phase execution via the responder chain:
   *
   * 1. Dispatch `{action, phase: "discrete"}` through the chain
   *    synchronously — inside the current user gesture. The first
   *    responder's handler runs inside the mousedown/keydown stack,
   *    so clipboard APIs and execCommand work. If the handler returns
   *    a continuation callback (see ActionHandler), dispatchForContinuation
   *    exposes it here.
   *
   * 2. Play the activation blink. When it finishes, run the optional
   *    continuation returned by the handler — for visible side effects
   *    like deleting the cut text or inserting pasted text. This is
   *    where the user *sees* the result, after the flash feedback,
   *    matching the "button press then result" UX [L11].
   *
   * Then close the menu.
   *
   * `action` is typed as TugAction because menu items are declared
   * with typed actions at the consumer site (via TugEditorContextMenuItem).
   * No cast or coercion is needed on the dispatch path.
   */
  const activateItem = useCallback((target: HTMLElement, action: TugAction) => {
    if (blinkingRef.current) return;
    blinkingRef.current = true;
    // Phase 1: synchronous dispatch through the responder chain.
    const { continuation } = manager.sendToFirstResponderForContinuation({
      action,
      phase: "discrete",
    });
    // Phase 2: play the blink, then the continuation (if any), then close.
    playMenuItemBlink(target).finally(() => {
      blinkingRef.current = false;
      try {
        continuation?.();
      } finally {
        onCloseRef.current();
      }
    });
  }, [manager]);

  /**
   * Append a character to the typeahead buffer and move the keyboard
   * selection to the first actionable item whose label begins with the
   * buffer (case-insensitive). The buffer clears after
   * TYPEAHEAD_BUFFER_TIMEOUT_MS of inactivity.
   */
  const applyTypeahead = useCallback((char: string) => {
    typeBufferRef.current += char.toLowerCase();
    const buffer = typeBufferRef.current;
    const match = itemsRef.current.find(
      (entry) =>
        isActionable(entry) &&
        entry.label.toLowerCase().startsWith(buffer),
    );
    if (match && isActionable(match)) {
      setHighlightedItem(match.action);
    }
    if (typeBufferTimerRef.current !== null) {
      window.clearTimeout(typeBufferTimerRef.current);
    }
    typeBufferTimerRef.current = window.setTimeout(() => {
      typeBufferRef.current = "";
      typeBufferTimerRef.current = null;
    }, TYPEAHEAD_BUFFER_TIMEOUT_MS);
  }, [setHighlightedItem]);

  // Dismiss on unrelated responder-chain traffic.
  //
  // The menu registers a dispatch observer with the responder chain:
  // every action flowing through the chain (via dispatch,
  // sendToFirstResponderForContinuation, or sendToTarget) fires this callback. If
  // the menu is the one dispatching (an item activation in flight —
  // blinkingRef is true), we skip the close so the menu can finish
  // its own animation. Otherwise, the dispatch is external (⌘A,
  // ⌘Backtick, a button click somewhere else, etc.) and the menu
  // dismisses.
  //
  // This is the generalized version of "close on external shortcut"
  // and uses the responder chain as the single signal, per [L11].
  // Keyboard shortcuts, clicks, and programmatic dispatches all
  // funnel through the same observer.
  useLayoutEffect(() => {
    if (!open) return;
    const unsubscribe = manager.observeDispatch(() => {
      if (blinkingRef.current) return;
      const menu = menuRef.current;
      if (menu) menu.style.display = "none";
      onCloseRef.current();
    });
    return unsubscribe;
  }, [open, manager]);

  // Window-level event registration, capture phase, via useLayoutEffect
  // per L03. Two critical reasons to register on window rather than
  // document:
  //
  // 1. The responder-chain-provider installs a document-level capture
  //    keydown listener. When a keybinding matches (e.g. ⌘A → selectAll
  //    dispatched to tug-card's responder) and a responder handles it,
  //    the provider calls event.stopImmediatePropagation() — which
  //    silences every other listener registered on the same element
  //    and phase. A document-level listener installed after the
  //    provider never sees handled shortcuts.
  // 2. Window is higher in the native capture chain than document, so
  //    a window capture listener runs *before* any document-level
  //    listener regardless of registration order. This lets us dismiss
  //    the menu first and still let the native shortcut proceed.
  //
  // Using useLayoutEffect (not useEffect) guarantees the listeners are
  // attached before the browser paints the menu — so the first key
  // event after the menu appears is always handled.
  useLayoutEffect(() => {
    if (!open) return;

    const onWindowMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      // Imperatively hide immediately, then schedule React unmount.
      // Direct DOM mutation guarantees the menu is visually gone
      // before the event's default action proceeds, regardless of
      // React 19 concurrent batching.
      const menu = menuRef.current;
      if (menu) menu.style.display = "none";
      onCloseRef.current();
    };

    const dismiss = () => {
      const menu = menuRef.current;
      if (menu) menu.style.display = "none";
      onCloseRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Modifier-only keypress (Meta, Control, Alt, or Shift pressed
      // by itself, no other key) — ignore entirely. The modifier state
      // is set on the event, but the user hasn't actually invoked
      // anything yet. They're either in the middle of pressing a
      // combo or will release the key; neither case should dismiss
      // the menu.
      if (
        e.key === "Meta" ||
        e.key === "Control" ||
        e.key === "Alt" ||
        e.key === "Shift"
      ) {
        return;
      }

      // ⌘. — macOS "cancel" shortcut. Close without letting the event
      // propagate (it has no meaning in the editor).
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }

      // Escape — close.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }

      // Enter / Space — activate the keyboard-selected item, if any.
      if (e.key === "Enter" || e.key === " ") {
        const action = selectedActionRef.current;
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        // Locate the item's DOM element for the blink via its action
        // name. Escape the action for use in the attribute selector.
        const escAction = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(action) : action;
        const target = menuRef.current?.querySelector<HTMLElement>(
          `[data-item-action="${escAction}"]`,
        );
        if (target) activateItem(target, action);
        return;
      }

      // Arrow / Home / End — cycle the highlighted item through the
      // actionable entries (skipping separators, labels, and disabled
      // items). Wraps at both ends. If nothing is currently
      // highlighted, ArrowDown picks the first actionable and ArrowUp
      // picks the last — matching native menu behavior. Separators
      // and disabled items are never highlighted because `isActionable`
      // filters them out of the cycle list, so walking the cycle
      // never lands on one and the user can't get "stuck" on a
      // non-activatable entry.
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        e.preventDefault();
        e.stopPropagation();
        const actionables = itemsRef.current.filter(isActionable);
        if (actionables.length === 0) return;
        const currentAction = selectedActionRef.current;
        const currentIdx = currentAction
          ? actionables.findIndex((it) => it.action === currentAction)
          : -1;
        let nextIdx: number;
        if (e.key === "Home") {
          nextIdx = 0;
        } else if (e.key === "End") {
          nextIdx = actionables.length - 1;
        } else if (e.key === "ArrowDown") {
          // No current selection → first. Otherwise → next, wrap.
          nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % actionables.length;
        } else {
          // ArrowUp: no current selection → last. Otherwise → prev, wrap.
          nextIdx =
            currentIdx < 0
              ? actionables.length - 1
              : (currentIdx - 1 + actionables.length) % actionables.length;
        }
        setHighlightedItem(actionables[nextIdx].action);
        return;
      }

      // Any other modifier combo (⌘X, ⌘C, ⌘V, ⌘Z, …) — close the menu
      // and let the event continue to the editor so the shortcut runs
      // natively. No preventDefault, but flushSync so the menu is
      // visibly gone before the editor processes the shortcut.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        dismiss();
        return;
      }

      // Printable character — typeahead select. Consume the key so it
      // doesn't reach the editor.
      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        applyTypeahead(e.key);
        return;
      }

      // Any other non-character key (Tab, function keys) — close the
      // menu and let the event pass through.
      dismiss();
    };
    window.addEventListener("mousedown", onWindowMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onWindowMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, activateItem, applyTypeahead, setHighlightedItem]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-slot="tug-editor-context-menu"
      className="tug-menu-content tug-editor-context-menu"
      role="menu"
      // Suppress the browser's native context menu on right-click
      // within our own menu — otherwise right-clicking an item would
      // stack the system menu on top.
      onContextMenu={(e) => e.preventDefault()}
      // Initial style: off-screen and hidden. A useLayoutEffect
      // measures the menu size and writes left/top/visibility directly
      // to the DOM (L06) — no React state, no extra render cycle.
      style={{
        position: "fixed",
        left: -9999,
        top: -9999,
        visibility: "hidden",
      }}
    >
      {items.map((entry, index) => {
        if (entry.type === "separator") {
          return (
            <div
              key={`sep-${index}`}
              className="tug-menu-separator"
              role="separator"
            />
          );
        }

        if (entry.type === "label") {
          return (
            <div
              key={`label-${index}`}
              className="tug-menu-label"
              role="presentation"
            >
              {entry.label}
            </div>
          );
        }

        // Action item (type === "item" or undefined).
        const item = entry;
        const disabled = item.disabled ?? false;

        return (
          <div
            key={item.action}
            data-item-action={item.action}
            className="tug-menu-item"
            role="menuitem"
            aria-disabled={disabled || undefined}
            data-disabled={disabled ? "" : undefined}
            // onMouseDown (not onClick) with preventDefault is the core
            // trick: it suppresses the browser's default focus shift, so
            // the editor keeps focus and the DOM selection stays live.
            // Running onSelect synchronously in the same handler means
            // the caller's clipboard commands execute inside the user
            // gesture window.
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              if (disabled) return;
              activateItem(e.currentTarget as HTMLElement, item.action);
            }}
            // Mouse hover updates the highlighted item via a direct
            // DOM write (L06) — shares the same single-selection model
            // as keyboard typeahead.
            onPointerEnter={() => {
              if (!disabled) setHighlightedItem(item.action);
            }}
          >
            {item.icon !== undefined && (
              <span className="tug-menu-item-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="tug-menu-item-label">{item.label}</span>
            {item.shortcut !== undefined && (
              <span className="tug-menu-item-shortcut">{item.shortcut}</span>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
