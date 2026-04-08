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

import React, { useContext, useEffect, useRef } from "react";
import { ResponderChainContext, ResponderChainManager } from "./responder-chain";
import { matchKeybinding } from "./keybinding-map";
import { selectionGuard } from "./selection-guard";
import { registerResponderChainManager } from "../../action-dispatch";

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
    // dispatch "addTabToActiveCard" through the chain without importing React context.
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
      const { handled, continuation } = manager.dispatchForContinuation({
        action: binding.action,
        phase: "discrete",
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
    // One document-level capture-phase pointerdown listener resolves the
    // innermost registered responder under the event target (via
    // data-responder-id attributes written by useResponder) and promotes
    // it to first responder. This is the single mechanism for
    // click-to-focus in the chain — no per-component makeFirstResponder
    // calls, no focus listeners, no pointerdown handlers in tug-card or
    // tug-prompt-input or elsewhere. Nested responders compose
    // naturally: clicking inside an editor inside a card makes the
    // editor first responder without any per-component wiring.
    //
    // Capture phase on document ensures this runs before any React-
    // delegated onPointerDown handler in the tree, so even if a
    // component still has an old unconditional makeFirstResponder
    // pointerdown handler during migration, our promotion survives.
    function promoteOnPointerDown(event: PointerEvent): void {
      const id = manager.findResponderForTarget(event.target as Node | null);
      if (id !== null && id !== manager.getFirstResponder()) {
        manager.makeFirstResponder(id);
      }
    }

    document.addEventListener("keydown", captureListener, { capture: true });
    document.addEventListener("keydown", bubbleListener);
    document.addEventListener("pointerdown", promoteOnPointerDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", captureListener, { capture: true });
      document.removeEventListener("keydown", bubbleListener);
      document.removeEventListener("pointerdown", promoteOnPointerDown, { capture: true });
      selectionGuard.detach();
    };
  }, [manager]);

  return (
    <ResponderChainContext.Provider value={manager}>
      {children}
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
