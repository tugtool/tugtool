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
 *,
 */

import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResponderChainContext, ResponderChainManager } from "./responder-chain";
import { FocusManager, FocusManagerContext, TAB_CONSUME_ATTRIBUTE, BASE_FOCUS_MODE, registerFocusManager } from "./focus-manager";
import { resolveFocusAct } from "./focus-act";
import { keyboardAccessStore } from "../../keyboard-access-store";
import { focusRingModalityStore } from "../../focus-ring-modality-store";
import { matchKeybinding } from "./keybinding-map";
import { selectionGuard } from "./selection-guard";
import { registerResponderChainManager } from "../../action-dispatch";
import { getCardLifecycle } from "../../lib/card-lifecycle";
import { getAppLifecycle } from "../../lib/app-lifecycle";

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

// ---- Default-button press-visual duration ----

/**
 * How long the `data-pressing="true"` attribute stays on a button
 * after it's activated by Return through the default-button stack.
 * Long enough to read as a "click" without lingering. CSS treats
 * `[data-pressing="true"]` as a stand-in for `:active`.
 */
const DEFAULT_BUTTON_PRESS_MS = 120;

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

  // The focus engine rides this same provider ([P01]): one manager, created
  // once, exposed as a sibling context. In this inert cut it only seeds its
  // key view from the chain's first responder (via `attach` below) and stamps
  // `data-key-view` — no Tab interception yet.
  const focusManagerRef = useRef<FocusManager | null>(null);
  if (focusManagerRef.current === null) {
    focusManagerRef.current = new FocusManager();
  }
  const focusManager = focusManagerRef.current;

  // L03: install registrations that events depend on in
  // `useLayoutEffect`, not `useEffect`. This effect installs six
  // document-level listeners (keydown capture + bubble, pointerdown,
  // mousedown, focusin, contextmenu) plus three cross-module
  // registrations (action-dispatch, card-lifecycle manager,
  // selection-guard attach). `useEffect` runs after paint, leaving
  // a window between React commit and the first flush where user
  // input can arrive without handlers — a missed first click, a
  // missed first keydown, or the browser's initial focus restore
  // landing before responder promotion is live. `useLayoutEffect`
  // runs synchronously before paint, closing the race. Same
  // rationale as `pane-focus-controller.ts`.
  useLayoutEffect(() => {
    // ---- ResponderChainManager registration with action-dispatch ----
    // Register the manager so the add-card-to-active-pane Control-frame action handler can
    // dispatch "add-card-to-active-pane" through the chain without importing React context.
    // ([D06], [D09])
    registerResponderChainManager(manager);

    // Late-bind the responder chain manager to the CardLifecycle so
    // activations can promote the key responder. DeckManager
    // constructed the lifecycle in its own constructor and
    // registered it via `registerCardLifecycle`; we resolve it
    // here and hand over the manager instance. Safe when no
    // lifecycle is registered (test contexts that bootstrap only
    // the responder chain) — setManager is a no-op on null.
    const lifecycle = getCardLifecycle();
    lifecycle?.setManager(manager);

    // ---- SelectionGuard lifecycle ----
    // Install SelectionGuard event listeners alongside the key pipeline.
    // Both are document-level event systems that live for the duration of
    // the provider. CSS Highlight objects are created eagerly in the
    // SelectionGuard constructor (not here) so they exist before any React
    // effects fire. attach() installs pointer / selection / keyboard
    // listeners, subscribes to the app lifecycle for resign/become-active
    // dim transitions, and subscribes to the deck store (via the
    // `deck-store-registry` singleton) so paint tracks `activePaneId` /
    // `activeCardId` transitions. ([D02])
    const appLifecycle = getAppLifecycle();
    selectionGuard.attach(appLifecycle);

    // ---- FocusManager lifecycle ----
    // Bind the focus engine to the chain so the key view tracks the first
    // responder. Installed here (not useEffect) for the same reason as the
    // listeners below — registrations events depend on must be live before
    // paint ([L03]). Detached in cleanup.
    focusManager.attach(manager);

    // Expose the engine to the single-channel focus dispatcher (`applyBagFocus`)
    // so a focus-axis restore can re-light the keyboard ring. Cleared on unmount.
    registerFocusManager(focusManager);

    // Keep the focus walk's keyboard-access mode in sync with the store. The
    // store is the source of truth (structure zone, [L02]); the manager holds
    // a mirror its pure walk reads. Seed now, then track changes.
    focusManager.setKeyboardAccessMode(keyboardAccessStore.getMode());
    const unsubscribeKeyboardAccess = keyboardAccessStore.subscribe(() => {
      focusManager.setKeyboardAccessMode(keyboardAccessStore.getMode());
    });

    // Ring modality: the store owns the policy ([L02]); the manager mirrors it
    // and repaints the ring on change. Seed now, then track changes.
    focusManager.setRingFollowsPointer(focusRingModalityStore.ringFollowsPointer());
    const unsubscribeRingModality = focusRingModalityStore.subscribe(() => {
      focusManager.setRingFollowsPointer(focusRingModalityStore.ringFollowsPointer());
    });

    // ---- Focus walk: Tab / Shift-Tab ([P04]) ----
    // Tab owns app-authored focus movement and is handled here, ahead of the
    // static keybinding map, so one code path resolves the precedence:
    //   1. A focused text surface that is consuming Tab right now (an editor
    //      with an open completion advertises `data-tug-tab-consume`): leave
    //      the event untouched so the surface's own keymap accepts the
    //      completion ([Q02] flag resolution).
    //   2. The focus walk advances the key view and lands DOM focus on it.
    // While no component has registered as a focusable yet, an empty walk
    // yields to the browser's native Tab so focus is never dead mid-migration.
    //
    // Tab and Shift-Tab are symmetric here: forward and reverse focus
    // navigation, the universal GUI convention. Tug deliberately departs from
    // the Claude Code TUI, where Shift-Tab cycles the permission mode — in a
    // GUI, Shift-Tab must move focus to the previous control. Permission-mode
    // cycling lives on ⇧⌘P (key-card scope, in the keybinding map) plus the
    // dev card's Mode chip / sheet and the /permissions command.
    function focusWalkListener(event: KeyboardEvent): void {
      if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // (1) A text surface consuming Tab keeps it.
      const active = document.activeElement;
      const surfaceConsumes =
        (active instanceof Element &&
          active.closest(`[${TAB_CONSUME_ATTRIBUTE}="true"]`) !== null) ||
        focusManager.keyViewConsumesTab();
      if (surfaceConsumes) return;
      // (2) Advance the walk. Non-null = the key view moved; land focus and
      // swallow the key. Null = nothing to move to; yield to native Tab.
      const moved = event.shiftKey
        ? focusManager.focusPrevious()
        : focusManager.focusNext();
      if (moved !== null) {
        focusManager.focusKeyView();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    // ---- Stage 1: capture-phase listener (global shortcuts) ----
    function captureListener(event: KeyboardEvent): void {
      // Resolve dynamic, context-scoped bindings first ([P11],
      // #keybinding-registry): the active focus mode (innermost — a floating
      // surface's accelerators, reachable even when focus is elsewhere, e.g. an
      // inline dialog while the prompt holds focus) then the first-responder
      // walk, innermost-first. Fall back to the static global map. Both layers
      // share one match rule and one dispatch path below.
      const mode = focusManager.currentFocusMode();
      const binding =
        manager.resolveKeybinding(event, mode === BASE_FOCUS_MODE ? [] : [mode]) ??
        matchKeybinding(event);
      if (binding === null) return;
      // [D06] preventDefaultOnMatch: suppress browser default on match (e.g.
      // Cmd+A native select-all) before dispatching to the responder chain.
      if (binding.preventDefaultOnMatch) {
        event.preventDefault();
      }
      // Use sendToFirstResponderForContinuation so two-phase action handlers (those
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
      //
      // `binding.scope` picks the routing. `"first-responder"` (default)
      // walks up from the current first responder. `"key-card"`
      // dispatches to the active card's `card-content` responder,
      // independent of which element is currently focused — the
      // mechanism that lets ⌘K work when the user clicks the card's
      // title bar before pressing the chord.
      const actionEvent = {
        action: binding.action,
        phase: "discrete" as const,
        ...(binding.value !== undefined ? { value: binding.value } : {}),
      };
      const { handled, continuation } =
        binding.scope === "key-card"
          ? manager.sendToKeyCardForContinuation(actionEvent)
          : manager.sendToFirstResponderForContinuation(actionEvent);
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        continuation?.();
      }
    }

    // ---- Act dispatch: Space / Enter / Escape ([P01]) ----
    // The model's act tier, resolved against the focused component's declared
    // behavior. Capture phase, sited AFTER the keybinding listener (a matched
    // binding wins and stops propagation before this runs) and AFTER a key-capture
    // leaf (an editor keeps its keys), but ahead of the bubble default-button
    // stage. Every branch is GUARDED so it is non-interfering: Space/Enter act
    // only when the key view declares an item/component behavior (a leaf falls
    // through to native / the default-button stage), and Escape ascends only when
    // an engine scope is descended — otherwise it falls through to the cancel
    // ladder ([R04]).
    function actDispatchListener(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey) return;
      const key = event.key;
      if (key !== " " && key !== "Spacebar" && key !== "Enter" && key !== "Escape") {
        return;
      }
      const focusKey = {
        key,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      };
      // An editor leaf owns its keys ([P04]) — never act on a captured key.
      if (focusManager.keyViewCaptures(focusKey)) return;
      // An editor advertising it owns keys *right now* (an open completion sets
      // `data-tug-tab-consume`) keeps Escape too — [P04]'s "Tab/Escape are
      // captured only transiently by an open completion": Escape closes the
      // completion first rather than ascending a scope. (Tab is already deferred
      // by the focus-walk listener via the same marker.)
      if (key === "Escape") {
        const active = document.activeElement;
        if (
          active instanceof Element &&
          active.closest(`[${TAB_CONSUME_ATTRIBUTE}="true"]`) !== null
        ) {
          return;
        }
      }

      const behavior = focusManager.keyViewBehavior();
      const act = resolveFocusAct(focusKey, behavior ?? { container: "none" });
      switch (act) {
        case "select":
          behavior?.onSelect?.();
          event.preventDefault();
          event.stopImmediatePropagation();
          break;
        case "descend":
          behavior?.onDescend?.();
          event.preventDefault();
          event.stopImmediatePropagation();
          break;
        case "act":
          // Intercept only for a container that declares an act; a leaf's
          // Space/Enter stays with the existing pipeline (native button press,
          // bubble default-button), so leaf act-consistency is unchanged.
          if (behavior && behavior.container !== "none" && behavior.onAct) {
            behavior.onAct();
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          break;
        case "ascend":
        case "cancel":
          // Ascend only a NON-trapped descended scope. A trapped (modal) scope —
          // a sheet / alert still owned by Radix until its step lands — keeps its
          // own Escape (cancel); the engine must not pop it from under the surface
          // ([R04]). At the base mode there is nothing to ascend.
          if (
            focusManager.currentFocusMode() !== BASE_FOCUS_MODE &&
            !focusManager.currentFocusModeTrapped()
          ) {
            focusManager.ascend();
            behavior?.onAscend?.();
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          break;
        default:
          break; // move / passthrough / capture — leave to the component / browser
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
          // Pane-scope the activation. A `Return` belongs to the pane the
          // user is working in (the first responder's pane); a default
          // button registered by a sheet in ANOTHER pane (e.g. an unbound
          // card's picker Open button) must NOT be pressed by it ([D15]
          // pane modality). Resolve the first responder's `.tug-pane` and
          // only consider default buttons inside it; cross-pane activation
          // is then impossible by construction. With no pane context
          // (gallery / standalone) fall back to the global top.
          const frId = manager.getFirstResponder();
          const frEl =
            frId !== null && typeof document !== "undefined"
              ? document.querySelector(`[data-responder-id="${CSS.escape(frId)}"]`)
              : null;
          const activePane = frEl?.closest(".tug-pane") ?? null;
          const defaultButton =
            activePane !== null
              ? manager.peekDefaultButtonInScope(activePane)
              : manager.peekDefaultButton();
          if (defaultButton !== null) {
            // Press visual ([L06] — appearance via DOM). The button's
            // CSS variants treat `[data-pressing="true"]` the same as
            // `:active` (`:is(:active, [data-pressing="true"])`
            // selectors in `tug-button.css`), so a Return-activation
            // paints identically to a real mouse click. Native
            // `:active` doesn't fire for a synthetic `.click()`, so
            // we toggle the attribute by hand.
            defaultButton.setAttribute("data-pressing", "true");
            window.setTimeout(() => {
              defaultButton.removeAttribute("data-pressing");
            }, DEFAULT_BUTTON_PRESS_MS);
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
    // tug-pane or tug-prompt-input. Nested responders compose
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
    //
    // Narrowed semantics. Per `tugplan-dev-overlay-framework.md`
    // [D01] (#mental-model), `data-tug-focus="refuse"` controls
    // exactly two behaviors and nothing else: chain-promotion-skip
    // (here, in `promoteOnPointerDown`) and browser-focus-prevention
    // (here, in `preventFocusOnMouseDown`). It does NOT gate
    // pane-focus-controller activation/deselect — that subsystem
    // keys on `[data-slot="tug-canvas-overlay-root"]` directly.
    // One attribute, one semantic. See [D01] for the disambiguation
    // rationale and (#mental-model) for the five-subsystem model.
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
      // Focus-refusing controls skip first-responder promotion.
      // This is safe because controls use targeted dispatch
      // (sendToTarget parent) — the first responder is irrelevant
      // for their actions. Keyboard shortcuts use nil-targeted
      // dispatch and need the first responder to stay on the
      // editor, so skipping promotion here is correct for both.
      if (isFocusRefusing(event.target)) return;
      // Mark this promotion pointer-driven so the key-view seeding coarsens to
      // the promoted responder and clears the ring (click-to-focus). Programmatic
      // promotions (focusin from `.focus()`, boot restore) are not wrapped, so
      // they yield to an established finer focusable key view instead of dropping
      // its ring.
      focusManager.runPointerPromotion(() => promoteFromTarget(event.target as Node | null));
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
      if (isFocusRefusing(event.target)) return;
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

    // focusWalkListener is registered before captureListener so it owns Tab
    // in the capture phase ahead of the global-shortcut dispatch.
    document.addEventListener("keydown", focusWalkListener, { capture: true });
    document.addEventListener("keydown", captureListener, { capture: true });
    document.addEventListener("keydown", actDispatchListener, { capture: true });
    document.addEventListener("keydown", bubbleListener);
    document.addEventListener("pointerdown", promoteOnPointerDown, { capture: true });
    document.addEventListener("mousedown", preventFocusOnMouseDown, { capture: true });
    document.addEventListener("focusin", promoteOnFocusIn, { capture: true });
    document.addEventListener("contextmenu", fallbackContextMenu);

    return () => {
      document.removeEventListener("keydown", focusWalkListener, { capture: true });
      document.removeEventListener("keydown", captureListener, { capture: true });
      document.removeEventListener("keydown", actDispatchListener, { capture: true });
      document.removeEventListener("keydown", bubbleListener);
      document.removeEventListener("pointerdown", promoteOnPointerDown, { capture: true });
      document.removeEventListener("mousedown", preventFocusOnMouseDown, { capture: true });
      document.removeEventListener("focusin", promoteOnFocusIn, { capture: true });
      document.removeEventListener("contextmenu", fallbackContextMenu);
      selectionGuard.detach();
      unsubscribeKeyboardAccess();
      unsubscribeRingModality();
      registerFocusManager(null);
      focusManager.detach();
    };
  }, [manager, focusManager]);

  // Fallback "No Actions" context menu state. The document-level
  // contextmenu handler calls the ref'd setter to open it.
  const [fallbackMenu, setFallbackMenu] = useState<{ x: number; y: number } | null>(null);
  const fallbackMenuRef = useRef(setFallbackMenu);
  fallbackMenuRef.current = setFallbackMenu;
  const closeFallbackMenu = useCallback(() => setFallbackMenu(null), []);

  return (
    <ResponderChainContext.Provider value={manager}>
      <FocusManagerContext.Provider value={focusManager}>
        {children}
      </FocusManagerContext.Provider>
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
