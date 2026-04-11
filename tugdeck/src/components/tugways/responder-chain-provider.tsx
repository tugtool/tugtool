/**
 * ResponderChainProvider -- React context provider for the responder chain.
 *
 * Creates a singleton ResponderChainManager, provides it via
 * ResponderChainContext, and installs the four-stage keyboard pipeline:
 *
 *   Stage 1 (capture): global shortcuts via keybinding map
 *   Stage 2 (bubble):  keyboard navigation -- deferred to browser in Phase 3
 *   Stage 3 (bubble):  chain action dispatch for non-input targets (stub Phase 3)
 *   Stage 4 (bubble):  text input passthrough (implicit)
 *
 * Also exports convenience hooks:
 *   useResponderChain()         -- returns manager | null (safe outside provider)
 *   useRequiredResponderChain() -- returns manager, throws outside provider
 *
 * [D02] SelectionGuard event listeners attached here; CSS Highlights created
 *       eagerly in SelectionGuard constructor (before React mounts)
 * [D03] Four-stage key pipeline with global keydown listener
 * [D07] ResponderChainProvider wraps DeckCanvas only
 * Spec S03, Spec S08
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResponderChainContext, ResponderChainManager } from "./responder-chain";
import { matchKeybinding } from "./keybinding-map";
import { selectionGuard } from "./selection-guard";
import { registerResponderChainManager } from "../../action-dispatch";

// ---- Fallback context menu ----

import "./tug-menu.css";

/**
 * Minimal "No Actions" context menu shown when a right-click lands on an
 * area with no component-specific context menu. Prevents the browser's
 * native context menu from appearing anywhere in the app.
 *
 * Uses tug-menu CSS classes for visual consistency with TugContextMenu and
 * TugEditorContextMenu. Dismisses on click-away, Escape, or any keypress.
 */
function FallbackContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Position and dismiss listeners.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    // Position: same two-pass approach as TugEditorContextMenu.
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
    if (top + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";

    // Dismiss on click-away or keypress.
    const dismiss = () => onClose();
    const onMouseDown = (e: MouseEvent) => {
      if (menu.contains(e.target as Node)) return;
      dismiss();
    };
    const onKeyDown = () => dismiss();

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [x, y, onClose]);

  return (
    <div
      ref={menuRef}
      className="tug-menu-content"
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: -9999, top: -9999, visibility: "hidden" }}
    >
      <div className="tug-menu-label" role="presentation">
        No Actions
      </div>
    </div>
  );
}

// ---- ResponderChainProvider ----

/**
 * Provides a ResponderChainManager to its subtree and installs the key pipeline.
 *
 * Placement: inside ErrorBoundary, wrapping DeckCanvas (D07).
 * Tree: TugThemeProvider > ErrorBoundary > ResponderChainProvider > DeckCanvas
 */
export function ResponderChainProvider({ children }: { children: React.ReactNode }) {
  // Create the manager once and hold it in a ref so it is never replaced.
  const managerRef = useRef<ResponderChainManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = new ResponderChainManager();
  }
  const manager = managerRef.current;

  useEffect(() => {
    // ---- ResponderChainManager registration with action-dispatch ----
    // Register the manager so the add-tab-to-active-card Control-frame action handler can
    // dispatch "add-tab-to-active-card" through the chain without importing React context.
    // ([D06], [D09])
    registerResponderChainManager(manager);

    // ---- SelectionGuard lifecycle ----
    // Install SelectionGuard event listeners alongside the key pipeline.
    // Both are document-level event systems that live for the duration of
    // the provider. CSS Highlight objects are created eagerly in the
    // SelectionGuard constructor (not here) so they exist before any React
    // effects fire. attach() only installs event listeners. ([D02])
    selectionGuard.attach();

    // ---- Stage 1: capture-phase listener (global shortcuts) ----
    function captureListener(event: KeyboardEvent): void {
      const binding = matchKeybinding(event);
      if (binding === null) return;
      // [D06] preventDefaultOnMatch: suppress browser default on match (e.g.
      // Cmd+A native select-all) before dispatching to the responder chain.
      if (binding.preventDefaultOnMatch) {
        event.preventDefault();
      }
      // Use dispatchForContinuation so two-phase action handlers (those
      // that return a continuation callback from their sync body — e.g.
      // cut: synchronously write clipboard, continuation deletes selection)
      // run to completion under keyboard shortcuts. The context menu
      // defers continuations until after its activation blink; the
      // keyboard path has no blink, so the continuation fires immediately
      // after the sync phase.
      //
      // `binding.value` is copied onto the dispatched event only when
      // present. ⌘1..⌘9 use this to carry the 1-based tab index for
      // `jumpToTab`; every other binding leaves `value` undefined and
      // the handler sees the same shape it always did. [A3 / R4]
      const { handled, continuation } = manager.dispatchForContinuation({
        action: binding.action,
        phase: "discrete",
        ...(binding.value !== undefined ? { value: binding.value } : {}),
      });
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        continuation?.();
      }
    }

    // ---- Stages 2-4: bubble-phase listener ----
    function bubbleListener(event: KeyboardEvent): void {
      // Stage 2: keyboard navigation -- Enter-key default-button activation.
      // [D02] Enter-key check lives in stage-2 of the bubble pipeline.
      // [D04] Activation via synthetic click (element.click()).
      if (event.key === "Enter") {
        const active = document.activeElement as HTMLElement | null;
        const skipActivation =
          active !== null &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.isContentEditable ||
            active.tagName === "BUTTON");
        if (!skipActivation) {
          const defaultButton = manager.getDefaultButton();
          if (defaultButton !== null) {
            defaultButton.click();
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        // No default button registered or guard triggered -- fall through to stage 3/4.
      }

      // Stage 3: chain action dispatch.
      // Skip if the event target is a native text input or contenteditable.
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          // Stage 4: passthrough -- let browser handle text input.
          return;
        }
      }
      // Stage 3 stub: Phase 3 does not map additional keys through the chain
      // here; that is handled entirely by the keybinding map in stage 1.
      // Future phases extend this branch.

      // Stage 4: implicit passthrough.
    }

    // ---- Target-based first-responder promotion ----
    //
    // Two document-level capture-phase listeners (pointerdown and
    // focusin) resolve the innermost registered responder under the
    // event target — via `data-responder-id` attributes written by
    // `useResponder` — and promote it to first responder. This is the
    // single mechanism for "click-to-focus" and "Tab-to-focus" in the
    // chain. No per-component `makeFirstResponder` calls, no focus
    // listeners on individual editors, no pointerdown handlers in
    // tug-card or tug-prompt-input. Nested responders compose
    // naturally: clicking or tabbing into an editor inside a card
    // makes the editor first responder without any per-component
    // wiring.
    //
    // Why capture phase on document (vs. bubble, vs. a deeper element):
    //
    // 1. Running in capture phase at the document level means these
    //    listeners fire *before* the event reaches the target, and
    //    therefore before any React-delegated onPointerDown/onFocus
    //    handler in the tree. During a mixed-state migration, if an
    //    old component still has an unconditional `makeFirstResponder`
    //    call in its own pointerdown handler, our promotion runs first
    //    and the old handler becomes redundant but not harmful.
    //
    // 2. Descendant elements cannot suppress us with
    //    `event.stopPropagation()`. Capture-phase listeners on an
    //    ancestor run *before* the event reaches the stopping element
    //    — stopPropagation at a descendant only affects the remaining
    //    propagation path (remaining capture to target, then bubble
    //    back), not listeners that already ran. So even a component
    //    that calls `e.stopPropagation()` in its own pointerdown
    //    handler cannot prevent first-responder promotion here.
    //    `stopImmediatePropagation` likewise only affects listeners
    //    on the *same* element, so a descendant's version can't touch
    //    a document-level listener. The only way to break this
    //    invariant would be another capture-phase listener at
    //    document or window that called `stopImmediatePropagation`
    //    *and* was registered before ours — which no other code in
    //    the suite does.
    //
    // Focus-based promotion is needed alongside pointer-based because
    // keyboard-only users reach responders via Tab, programmatic
    // `.focus()`, or the browser's initial focus restoration on
    // page load — none of which fire a pointerdown. `focusin` bubbles
    // (unlike `focus`), so a single document-level listener catches
    // it for every descendant.
    function promoteFromTarget(target: Node | null): void {
      const id = manager.findResponderForTarget(target);
      if (id !== null && id !== manager.getFirstResponder()) {
        manager.makeFirstResponder(id);
      }
    }

    // ---- Focus refusal for chrome controls ----
    //
    // Controls marked with data-tug-focus="refuse" (buttons, checkboxes,
    // switches, sliders, etc.) should not steal keyboard focus or
    // first-responder status from the active editor. This is the
    // web equivalent of Cocoa's acceptsFirstResponder = false.
    //
    // Two document-level listeners implement this centrally:
    //   - pointerdown (capture): skips first-responder promotion
    //   - mousedown (capture): calls preventDefault to stop browser focus
    //
    // Controls only need to add the attribute. Both behaviors are
    // handled here — no per-component onMouseDown handlers needed.
    const FOCUS_REFUSE_SELECTOR = '[data-tug-focus="refuse"]';

    function isFocusRefusing(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) {
        if (target instanceof Node && target.parentElement) {
          return target.parentElement.closest(FOCUS_REFUSE_SELECTOR) !== null;
        }
        return false;
      }
      return target.closest(FOCUS_REFUSE_SELECTOR) !== null;
    }

    function promoteOnPointerDown(event: PointerEvent): void {
      // Focus-refusing controls (data-tug-focus="refuse") do NOT skip
      // responder promotion. The control itself isn't a responder — it
      // has no data-responder-id — so findResponderForTarget naturally
      // walks past it and finds the correct ancestor responder. This is
      // essential: controls dispatch actions through the chain, and the
      // chain walks from the first responder. If we skipped promotion,
      // the first responder would be stale and dispatches would fail.
      //
      // Focus refusal only prevents BROWSER focus transfer (via
      // mousedown preventDefault below). The responder chain always
      // promotes on click.
      promoteFromTarget(event.target as Node | null);
    }

    function preventFocusOnMouseDown(event: MouseEvent): void {
      // Focus-refusing controls prevent the browser from moving keyboard
      // focus on mousedown. This keeps focus in the active editor so the
      // caret and selection are preserved. The click event still fires
      // normally.
      if (isFocusRefusing(event.target)) {
        event.preventDefault();
      }
    }

    function promoteOnFocusIn(event: FocusEvent): void {
      promoteFromTarget(event.target as Node | null);
    }

    // ---- Fallback context menu ----
    //
    // Suppress the browser's native context menu everywhere in the app.
    // Components that have their own menus (text inputs, markdown view,
    // copyable labels) call preventDefault in their own handlers — those
    // fire before this document-level handler. This catches everything
    // else and shows a "No Actions" fallback menu.
    function fallbackContextMenu(event: MouseEvent): void {
      if (event.defaultPrevented) return;
      event.preventDefault();
      fallbackMenuRef.current?.({ x: event.clientX, y: event.clientY });
    }

    document.addEventListener("keydown", captureListener, { capture: true });
    document.addEventListener("keydown", bubbleListener);
    document.addEventListener("pointerdown", promoteOnPointerDown, { capture: true });
    document.addEventListener("mousedown", preventFocusOnMouseDown, { capture: true });
    document.addEventListener("focusin", promoteOnFocusIn, { capture: true });
    document.addEventListener("contextmenu", fallbackContextMenu);

    return () => {
      document.removeEventListener("keydown", captureListener, { capture: true });
      document.removeEventListener("keydown", bubbleListener);
      document.removeEventListener("pointerdown", promoteOnPointerDown, { capture: true });
      document.removeEventListener("mousedown", preventFocusOnMouseDown, { capture: true });
      document.removeEventListener("focusin", promoteOnFocusIn, { capture: true });
      document.removeEventListener("contextmenu", fallbackContextMenu);
      selectionGuard.detach();
    };
  }, [manager]);

  // Fallback "No Actions" context menu state. The document-level
  // contextmenu handler calls the ref'd setter to open it.
  const [fallbackMenu, setFallbackMenu] = useState<{ x: number; y: number } | null>(null);
  const fallbackMenuRef = useRef(setFallbackMenu);
  fallbackMenuRef.current = setFallbackMenu;
  const closeFallbackMenu = useCallback(() => setFallbackMenu(null), []);

  return (
    <ResponderChainContext.Provider value={manager}>
      {children}
      {fallbackMenu && createPortal(
        <FallbackContextMenu
          x={fallbackMenu.x}
          y={fallbackMenu.y}
          onClose={closeFallbackMenu}
        />,
        document.body,
      )}
    </ResponderChainContext.Provider>
  );
}

// ---- Convenience hooks ----

/**
 * Returns the nearest ResponderChainManager, or null if called outside a
 * ResponderChainProvider.
 *
 * Safe for components (like TugButton) that may render both inside and outside
 * the chain scope. When null, the component should fall through to its default
 * (direct-action) behavior.
 */
export function useResponderChain(): ResponderChainManager | null {
  return useContext(ResponderChainContext);
}

/**
 * Returns the nearest ResponderChainManager.
 *
 * Throws if called outside a ResponderChainProvider. Use this hook for
 * components that must always be inside the chain scope (programming error
 * if they are not).
 */
export function useRequiredResponderChain(): ResponderChainManager {
  const manager = useContext(ResponderChainContext);
  if (manager === null) {
    throw new Error(
      "useRequiredResponderChain must be used inside a <ResponderChainProvider>"
    );
  }
  return manager;
}
