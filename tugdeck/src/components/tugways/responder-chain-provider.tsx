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
import { FocusManager, FocusManagerContext, TAB_CONSUME_ATTRIBUTE, KEY_SINK_ATTRIBUTE, BASE_FOCUS_MODE, registerFocusManager, advanceKeyViewFocus } from "./focus-manager";
import { resolveFocusAct } from "./focus-act";
import { arrowDirection } from "./spatial-order";
import { arrowReleaseSubject, resolveArrowRelease } from "./arrow-release";
import { keyboardAccessStore } from "../../keyboard-access-store";
import { focusRingModalityStore } from "../../focus-ring-modality-store";
import { keymapRegistry, type ScopedBinding } from "./keymap-registry";
import { chordCaptureState } from "./chord-capture-state";
import { COMMANDS_BY_ID } from "./command-registry";
import { dispatchCommand } from "../../command-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";
import { selectionGuard } from "./selection-guard";
import { registerResponderChainManager } from "../../action-dispatch";
import { getCardLifecycle } from "../../lib/card-lifecycle";
import { getAppLifecycle } from "../../lib/app-lifecycle";
import { getDeckStore } from "../../lib/deck-store-registry";
import {
  computeEditCapabilities,
  editUndoLabelsWithin,
  publishEditMenuState,
  registerMenuCapsRefresher,
  registerMenuValidationChain,
} from "../../lib/host-menu-state";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import { currentGesture, targetRefusesFocus } from "@/gesture-interpreter";
import { isSyntheticEscape } from "./internal/synthetic-escape";

// ---- Fallback context menu ----

import "./tug-menu.css";
import "./tug-key-sink.css";

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

/**
 * Whether DOM focus currently sits on an interactive control — a button, link,
 * form field, or ARIA widget. The Space-dismiss path for `spaceDismisses` info
 * popovers consults this so a Space on a control INSIDE the popover (a JOBS
 * stop button) still presses it; only a Space on the popover's own
 * non-interactive chrome closes it.
 */
function activeElementIsInteractive(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.matches(
    [
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      "summary",
      '[role="button"]',
      '[role="menuitem"]',
      '[role="menuitemcheckbox"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="link"]',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(","),
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

    // ---- The keymap registry's view of the scoped layers ----
    // The registry holds the global layer itself, but the mode and responder
    // layers are the chain's to know, and they change with every focus move —
    // so it reads them through this rather than caching a copy. The native
    // layer is the menu mirror's and arrives with the chord sweep; until then
    // `resolveChord` answers over the three JS layers, which is the whole
    // answer in browser dev and the JS half of it in the app.
    keymapRegistry.setEnvironment({
      scopedBindings: (): readonly ScopedBinding[] => {
        const mode = focusManager.currentFocusMode();
        return manager
          .liveKeybindings(mode === BASE_FOCUS_MODE ? [] : [mode])
          .map((live) => ({
            // A scoped binding may name a command, or a substrate verb that
            // is outside the table by declaration ([#non-goals]) — the
            // shadowing view wants both, because either one takes the chord.
            // When it names a command, that name is the attribution; the
            // action is the fallback spelling for the substrate verbs.
            commandId: live.binding.commandId ?? live.binding.action,
            chord: live.binding,
            scope:
              live.kind === "mode"
                ? { kind: "mode" as const, modeId: live.scopeId }
                : { kind: "responder" as const, responderId: live.scopeId },
            depth: live.depth,
          }));
      },
    });

    // ---- Edit-menu capability mirror ----
    // Mirror the focused responder's edit-action capabilities outward to
    // the native menu bar so the host validates Cut/Copy/Paste/Delete/
    // Select All/Undo/Redo and the Find items against real focus, not
    // WebKit's "the page is selectable" guess. `validateAction` is the
    // single source of truth (D05). Outward mirror only — no React
    // consumer reads it, so no `useSyncExternalStore` (same shape as
    // host-menu-state's deck/dev publishers). Seed now, then republish on
    // every validation change (focus / register / unregister).
    // Focused-native-control tracker for the host's NSUndoManager undo
    // path. The token changes whenever the focused native text control
    // changes (and reads 0 when none is focused); the Swift side clears
    // the web view's undo stack on every token change, so the
    // per-web-view native stack never outlives focus in one control.
    // Closure state, not React state — nothing renders from it.
    let nativeUndoCounter = 0;
    let lastNativeUndoEl: Element | null = null;

    // The registry's per-item gates are computed by the publisher itself,
    // which is the one place that holds both halves of what a predicate
    // asks — the chain and the merged menu blocks. Handing it the chain is
    // the whole wiring; every republish path below reaches the gates
    // through the same flush.
    registerMenuValidationChain(manager);

    const publishMenuCaps = (): void => {
      const caps = computeEditCapabilities(manager);
      // The chain first responder owns the edit menu. A deactivated card now
      // resigns first responder (a canvas-background click clears the active
      // card, and the chain promotes the deck-canvas root), so a deactivated
      // card's caps drop out on their own — no `document.activeElement`
      // liveness gate is needed. Undo/Redo labels read from the FR element.
      const frId = manager.getFirstResponder();
      const frEl =
        frId !== null
          ? document.querySelector(`[data-responder-id="${CSS.escape(frId)}"]`)
          : null;
      const active = document.activeElement;

      // Native text control focused? Then the host validates Undo/Redo
      // from the web view's NSUndoManager instead of the chain caps.
      const isNativeText =
        active instanceof HTMLTextAreaElement
          ? !active.readOnly && !active.disabled
          : active instanceof HTMLInputElement
            ? !active.readOnly && !active.disabled
            : false;
      if (isNativeText) {
        if (active !== lastNativeUndoEl) {
          nativeUndoCounter += 1;
          lastNativeUndoEl = active;
        }
      } else {
        lastNativeUndoEl = null;
      }

      const labels =
        frEl !== null ? editUndoLabelsWithin(frEl) : { undo: "", redo: "" };

      publishEditMenuState({
        ...caps,
        undoLabel: labels.undo,
        redoLabel: labels.redo,
        nativeUndoToken: isNativeText ? nativeUndoCounter : 0,
      });
    };
    publishMenuCaps();
    const unsubscribeEditCaps = manager.subscribe(publishMenuCaps);
    // Substrates request a recompute when a capability flips *within* the
    // focused responder (e.g. an editor's undo depth changing as the user
    // types) — those flips don't bump the validation version by design.
    registerMenuCapsRefresher(publishMenuCaps);
    // The native-undo token reads `document.activeElement`, which doesn't
    // always bump the validation version — so focus moves trigger their own
    // republish. Microtask defer lets the focus transition settle first; the
    // publisher's diff suppresses no-op posts.
    const onFocusChange = (): void => {
      queueMicrotask(publishMenuCaps);
      // Every settled focus change is a chance for the keyboard ring to have
      // drifted from the real keyboard sink; the tripwire verifies agreement
      // (microtask-coalesced inside the manager).
      focusManager.scheduleFocusInvariantCheck("focus-change");
    };
    document.addEventListener("focusin", onFocusChange, { capture: true });
    document.addEventListener("focusout", onFocusChange, { capture: true });

    // ---- Keyboard-route enforcement (the watchdog, Spec S03) ----
    // Every settled focus change triggers an enforcement pass: the engine
    // computes the one legal `activeElement` from its own state (sink /
    // granted surface / key-view element) and reasserts it when reality
    // differs — it never derives state FROM the register. Microtask-
    // coalesced inside the manager, so a focusout's transient `<body>`
    // active element is only ever observed settled.
    const enforceOnFocusIn = (): void => {
      focusManager.enforceKeyboardRoute("focusin");
    };
    const enforceOnFocusOut = (): void => {
      focusManager.enforceKeyboardRoute("focusout");
    };
    document.addEventListener("focusin", enforceOnFocusIn, { capture: true });
    document.addEventListener("focusout", enforceOnFocusOut, { capture: true });

    // Late-bind the responder chain manager to the CardLifecycle so
    // activations can promote the key responder. DeckManager
    // constructed the lifecycle in its own constructor and
    // registered it via `registerCardLifecycle`; we resolve it
    // here and hand over the manager instance. Safe when no
    // lifecycle is registered (test contexts that bootstrap only
    // the responder chain) — setManager is a no-op on null.
    const lifecycle = getCardLifecycle();
    lifecycle?.setManager(manager);

    // ---- FocusManager key card ([P21]) ----
    // The key card is **activation-driven**, and the deck store's focused card is
    // its single structural authority: it is set for EVERY way a card becomes
    // active — a click / tab switch / pane activation / cross-pane move (the
    // `_flipFirstResponder` path) AND the initial seed / cold boot (where the
    // store already holds the active card, so the lifecycle's same-bit guard
    // skips a `cardDidActivate` notify). Tracking the store directly avoids that
    // gap. The focus coordinator's active context follows it; projection is
    // downstream, so `getKeyCard`'s focus-derivation stays a consequence, never a
    // competing truth. Only fire on an actual change of the focused card — the
    // focus *claim* (landing DOM focus on the card's destination, incl. a pending
    // card-modal dialog [P20], and the re-projection on window blur→focus) stays
    // with `applyBagFocus`'s `adoptKeyCard`; this seam only names the key card.
    const deckStore = getDeckStore();
    let lastKeyCard: string | null | undefined;
    const syncKeyCard = (): void => {
      const next = deckStore?.getFirstResponderCardId() ?? null;
      if (next === lastKeyCard) return;
      lastKeyCard = next;
      focusManager.setKeyCard(next);
    };
    syncKeyCard();
    const unsubscribeKeyCard = deckStore?.subscribe(syncKeyCard) ?? (() => {});

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
    // cycling lives on ⌃⌥⌘P (key-card scope, in the keybinding map) plus the
    // session card's Mode chip / sheet and the /permissions command.
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
      // (2) Advance the walk — the shared performer the View menu's Next /
      // Previous Keyboard Focus commands also run. True = the key view moved
      // and was placed; swallow the key. False = nothing to move to; yield to
      // native Tab.
      if (advanceKeyViewFocus(focusManager, event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    // ---- Spatial arrow navigation ([P22]/[P23]) ----
    // The parallel plane: bare arrows move the ring "in the direction you see",
    // bounded to the card / dialog, in author-declared order. A sibling of the focus
    // walk, registered ahead of the keybinding map so a bare arrow is resolved as
    // ring movement before a global binding can claim it (mirroring how the walk
    // owns Tab). Modified arrows (⌘/⌃/⌥/⇧) are left alone — they belong to editors,
    // sliders, and shortcuts. A component that captures arrows (an editor caret, a
    // slider value axis — [P25]) keeps them: the navigator yields when the key view
    // captures the key. When the ring rests on a selection group, an in-group arrow
    // delegates to its cursor; only an edge arrow crosses a seam ([P24] / [Q12]).
    // ---- Engine-synthesized acts on a leaf key view ----
    //
    // A leaf control (button, checkbox, switch, slider) operates natively: the
    // browser turns Space into a press, and Radix reads arrows off its own
    // keydown handler. Native handling needs the control to hold DOM focus —
    // but an engine-routed key view parks `document.activeElement` on the key
    // sink, so the control never sees the key and the stop is dead to the
    // keyboard.
    //
    // The engine closes that gap by synthesizing the act rather than by
    // surrendering the keyboard: the key view stays the router ([P01]) and the
    // sink stays parked, and the engine hands the named element the key it
    // would have received. DOM focus never becomes the truth for a leaf. This
    // is the standard-mode sibling of what accessibility mode does through
    // `mirrorKeyViewFocus`, minus the focus move.
    //
    // The re-entrancy latch is load-bearing: the forwarded event must bubble
    // (React attaches its handlers at the root container, so a non-bubbling
    // dispatch would never reach the component), which means it re-enters
    // these same document-level listeners.
    let deliveringToLeaf = false;
    function deliverToEngineLeaf(event: KeyboardEvent): boolean {
      if (deliveringToLeaf) return false;
      if (focusManager.keyboardRoute() !== "engine-routed") return false;
      const leaf = document.querySelector<HTMLElement>("[data-key-view]");
      if (leaf === null) return false;
      // Already holding real focus: the native pipeline is live, leave it be.
      const active = document.activeElement;
      if (active !== null && leaf.contains(active)) return false;
      // Same rule, for a surface that is PORTALLED rather than nested. A
      // trapped surface on top of the stack owns the keyboard; when the key
      // view is not a member of that mode it belongs to a mode below — a
      // popup button whose own menu is now open. Its menu holds real DOM
      // focus somewhere else in the tree, so the containment check above
      // cannot see it, and synthesizing the act here would deliver Return to
      // the trigger (re-toggling it) instead of to the highlighted item. The
      // surface on top gets the key; the leaf underneath does not.
      if (
        focusManager.currentFocusModeTrapped() &&
        !focusManager.currentModeMember(focusManager.keyView())
      ) {
        return false;
      }
      const forwarded = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        bubbles: true,
        cancelable: true,
        composed: true,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      deliveringToLeaf = true;
      try {
        leaf.dispatchEvent(forwarded);
      } finally {
        deliveringToLeaf = false;
      }
      // A synthetic keydown carries no default action, so Space/Enter on a
      // button-class control has to be completed as a press. Skipped when the
      // component consumed the key itself (a slider stepping its value).
      const isPress =
        event.key === " " || event.key === "Spacebar" || event.key === "Enter";
      if (isPress && !forwarded.defaultPrevented) leaf.click();
      return true;
    }

    function arrowNavListener(event: KeyboardEvent): void {
      const direction = arrowDirection(event.key);
      if (direction === null) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // A focused text-editing host always owns its arrows for the caret ([P25]
      // single-line / multi-line editor) — yield regardless of declared captures,
      // so no editor has its caret stolen by the spatial plane. In cycling mode DOM
      // focus follows the ring onto the zone (not the editor), so this never blocks
      // zone navigation.
      //
      // Narrow opt-out ([P03], `arrow-release.ts`): a text surface releases an arrow
      // back to the spatial plane either explicitly, via `data-tug-arrow-release`
      // (the substrate channel — the editor projects its emptiness and its boundary
      // latch into it), or automatically, when it is an empty single-line field
      // inside the key view and so has no caret motion to protect. A field with text
      // still owns every arrow.
      //
      // A release never fires on auto-repeat: leaving a text surface is always a
      // discrete press, so slamming an arrow parks the caret at the edge instead of
      // shooting the ring out of the field.
      const release = resolveArrowRelease(
        arrowReleaseSubject(document.activeElement),
        direction,
      );
      if (release === "held" || (release === "released" && event.repeat)) return;
      const focusKey = {
        key: event.key,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      };
      // A component that captures this arrow (a slider's value axis — [P25]) keeps
      // it; the spatial plane yields. Yielding is not enough on its own when the
      // route is engine-routed: nothing downstream holds DOM focus, so the
      // engine delivers the arrow to the capturing leaf itself.
      if (focusManager.keyViewCaptures(focusKey)) {
        if (deliverToEngineLeaf(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (focusManager.moveKeyViewSpatial(direction)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    // ---- Stage 1: capture-phase listener (global shortcuts) ----
    function captureListener(event: KeyboardEvent): void {
      // [P03] An engine-synthesized Escape (the context-menu close lever) is the
      // engine's own close mechanism, not a user Escape — never re-arbitrate it;
      // let it pass through to the target surface's Radix layer.
      if (isSyntheticEscape(event)) return;
      // An armed chord capture owns every key: the press is an answer to
      // "what should this command be bound to", and matching it here would
      // fire the chord's *old* meaning on its way to being recorded. The
      // capture surface's own listener reads it instead.
      if (chordCaptureState.isArmed()) return;
      // Resolve dynamic, context-scoped bindings first ([P11],
      // #keybinding-registry): the active focus mode (innermost — a floating
      // surface's accelerators, reachable even when focus is elsewhere, e.g. an
      // inline dialog while the prompt holds focus) then the first-responder
      // walk, innermost-first. Fall back to the static global map. Both layers
      // share one match rule and one dispatch path below.
      const mode = focusManager.currentFocusMode();
      const binding = manager.resolveKeybinding(
        event,
        mode === BASE_FOCUS_MODE ? [] : [mode],
      );

      // No scoped claim: the global layer answers, and it answers with a
      // COMMAND. Everything past this point — routing, payload, the
      // continuation — is read from the registry entry rather than from the
      // binding, which is what makes a chord and a menu item two doors on one
      // row instead of two implementations that have to be kept in step.
      if (binding === null) {
        const match = keymapRegistry.matchChord(event);
        if (match === null) return;
        // ⌘Q, ⌘H, ⌘M, ⌃⌘F: named in the table so the keymap UI can show
        // them, performed by AppKit, never routed through JS. The chord
        // passes through untouched.
        if (COMMANDS_BY_ID.get(match.commandId)?.routing === "native") return;
        if (
          match.commandId === TUG_ACTIONS.CANCEL_DIALOG &&
          event.key === "Escape" &&
          mode !== BASE_FOCUS_MODE
        ) {
          return;
        }
        if (match.binding.preventDefault === true) event.preventDefault();
        if (dispatchCommand(match.commandId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      // A scoped binding on a real command names the command, and everything
      // past the match — routing, payload, validity — is read from its
      // registry entry, exactly as the global layer's is. Only the verbs
      // deliberately outside the table (the PDF card's scroll keys, the
      // gallery's demo chord) dispatch an action of their own below.
      if (binding.commandId !== undefined) {
        if (binding.preventDefaultOnMatch) event.preventDefault();
        if (dispatchCommand(binding.commandId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      // Escape on any non-base focus mode yields to the engine's Escape ladder
      // (the act-dispatch listener below), which is the single arbiter ([P02]
      // final form). Every dismissable surface now pushes a mode with an
      // `onEscapeDismiss` callback (branch (2)), every descend scope is
      // non-trapped (branch (4)), and a focus-cycle is `escapeExits` (branch (5)) —
      // so the ladder always knows what to do, and the old per-surface special
      // cases (the trapped-no-callback CANCEL_DIALOG dispatch and the DOM probe)
      // are gone. ⌘. (key `.`) never enters this guard (the `event.key` condition),
      // so it stays chain-routed for every surface (#non-goals).
      if (
        binding.action === TUG_ACTIONS.CANCEL_DIALOG &&
        event.key === "Escape" &&
        mode !== BASE_FOCUS_MODE
      ) {
        return;
      }
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
      // [P03] never re-arbitrate an engine-synthesized Escape (see captureListener).
      if (isSyntheticEscape(event)) return;
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
      // A text surface really holding DOM focus owns Space/Enter for typing
      // — a granted editor, a state-keyed field, or a bare native control
      // the target union cannot name. (The settled-focus derivation used to
      // coarsen the key view away from behaviors here; with the keyboard
      // engine-routed, the guard is structural instead.) Escape stays with
      // the ladder below.
      if (key !== "Escape") {
        const typing = document.activeElement;
        if (
          typing instanceof HTMLElement &&
          (typing.isContentEditable ||
            typing.tagName === "INPUT" ||
            typing.tagName === "TEXTAREA" ||
            typing.tagName === "SELECT")
        ) {
          return;
        }
      }
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
          // [P15] a keyboard value-commit may relinquish a toggleable cycle
          // (the mode's own disposition decides; no-op otherwise).
          focusManager.applyCommitDisposition("select");
          event.preventDefault();
          event.stopImmediatePropagation();
          break;
        case "descend":
          behavior?.onDescend?.();
          focusManager.applyCommitDisposition("descend");
          event.preventDefault();
          event.stopImmediatePropagation();
          break;
        case "act":
          // Intercept only for a container that declares an act; a leaf's
          // Space/Enter stays with the existing pipeline (native button press,
          // bubble default-button), so leaf act-consistency is unchanged.
          if (behavior && behavior.container !== "none" && behavior.onAct) {
            behavior.onAct();
            // [P15] an item-group value commit may relinquish a toggleable cycle.
            focusManager.applyCommitDisposition("act");
            event.preventDefault();
            event.stopImmediatePropagation();
            break;
          }
          // A leaf key view under the engine route: no native press can reach
          // it, so the engine synthesizes the act on the named element.
          // Ordered ahead of the space-dismiss branch below, which is for a
          // Space that lands on a popover's own non-interactive chrome — that
          // branch requires an empty / non-interactive key view, which is
          // exactly the case this one declines to handle.
          if (deliverToEngineLeaf(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            break;
          }
          // [P02] generalized: a second Space closes an info popover that opted
          // into space-dismiss — the symmetric partner to the Space that opened
          // it from its trigger leaf. Gated to a Space landing on the popover's
          // own non-interactive chrome (the key view is empty / a tabindex=-1
          // content wrapper); a Space on a control inside keeps its native press.
          if (
            (key === " " || key === "Spacebar") &&
            focusManager.currentFocusModeSpaceDismisses() &&
            !activeElementIsInteractive()
          ) {
            const dismiss = focusManager.currentFocusModeOnEscapeDismiss();
            if (dismiss !== null) {
              dismiss();
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          }
          break;
        case "ascend":
        case "cancel":
          // The single Escape ladder ([P02], Spec #escape-ladder). `keyViewCaptures`
          // and the synthetic-marker / tab-consume early-returns above are the
          // ladder's first rungs; the rest resolves against the top focus mode:
          //  (2) top mode registered `onEscapeDismiss` → the surface owns its close;
          //      call it and consume — the engine decides WHEN, the surface HOW;
          //  (4) a NON-trapped descended scope (accordion section, list row): ascend
          //      one level;
          //  (5) a trapped focus-cycle that opted into Escape-exit (`escapeExits`):
          //      pop the cycle back to its resting key view. No DOM probe: an open
          //      surface over the cycle is its OWN top mode with a callback (branch
          //      (2)), which consumes the Escape, so the cycle's mode is only ever
          //      top — and this branch only ever reached — with no surface open;
          //  (3) a trapped surface with no callback and no `escapeExits`: dev-warn
          //      tripwire and yield (today's Stage-1 `CANCEL_DIALOG` + Radix
          //      fallthrough still closes it during migration);
          //  base mode: nothing — falls through to the cancel ladder ([R04]).
          if (focusManager.currentFocusMode() !== BASE_FOCUS_MODE) {
            const onEscapeDismiss = focusManager.currentFocusModeOnEscapeDismiss();
            if (onEscapeDismiss !== null) {
              onEscapeDismiss();
              event.preventDefault();
              event.stopImmediatePropagation();
            } else if (!focusManager.currentFocusModeTrapped()) {
              focusManager.ascend();
              behavior?.onAscend?.();
              event.preventDefault();
              event.stopImmediatePropagation();
            } else if (focusManager.currentFocusModeEscapeExits()) {
              focusManager.escapeCurrentMode();
              event.preventDefault();
              event.stopImmediatePropagation();
            } else {
              // A trapped surface that did not register a dismiss callback. During
              // migration its Escape still rides Stage-1's CANCEL_DIALOG dispatch;
              // this is a tripwire for a future surface that forgets to register.
              tugDevLogStore.warn(
                "responder-chain-provider",
                "Escape reached a trapped focus mode with no onEscapeDismiss; yielding to the surface's own close path",
                { mode: focusManager.currentFocusMode() },
              );
            }
          }
          break;
        default:
          break; // move / passthrough / capture — leave to the component / browser
      }
    }

    // ---- Key-view delegation ([P05] / Spec S04) ----
    // The engine's key-delivery channel to components: after the walk /
    // spatial / bindings / act stages decline a key, the current key view's
    // behavior `onKey` gets it — the replacement for element-attached keydown
    // listeners, which die structurally once keys route from the engine's
    // target (keydown lands on the sink, never in a component subtree).
    // Registered after `actDispatchListener`, occupying the same precedence
    // slot element-capture handlers had (document capture runs before element
    // capture on the way down). The manager gates dom-granted mode and ⌘/⌃
    // chords structurally; the editable-active guard here is the migration
    // belt while DOM focus still lands on granted surfaces via the settled
    // derivation (it becomes redundant once the route is enforced).
    function keyViewDelegateListener(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (focusManager.dispatchKeyToKeyView(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    // ---- The arrow liveliness net ([P01], Spec S01) ----
    // The floor under the spatial plane: a bare arrow that nothing has claimed
    // moves the ring one step along the mode's linear walk order, wrapping. This
    // is what carries the key view across surfaces that declare no spatial order
    // — the Lens's sections, any list whose edge the navigator declined.
    //
    // It runs AFTER the key-view delegate on purpose: a descended row scope's
    // in-row arrow walks and any `KeyViewBehavior.onKey` consumer own their keys,
    // and the net catches only what is genuinely unclaimed. Text surfaces are
    // gated rather than raced — the active-element check admits a focused text
    // surface only when the release policy has already handed this arrow back.
    function arrowFallbackListener(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;
      const direction = arrowDirection(event.key);
      if (direction === null) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const active = document.activeElement;
      const release = resolveArrowRelease(arrowReleaseSubject(active), direction);
      if (release === "held") return;
      if (release === "released") {
        // Crossing out of a text surface is a discrete press ([P03]); a held key
        // parks the caret at the edge. Non-text engine stops keep their repeat, so
        // a held arrow still roves a list cursor via the earlier stage.
        if (event.repeat) return;
      } else if (
        active !== null &&
        active !== document.body &&
        !(active instanceof HTMLElement && active.closest(`[${KEY_SINK_ATTRIBUTE}]`) !== null)
      ) {
        // Some other element holds real DOM focus — a Radix menu item, a native
        // control. It owns its arrows; the net never walks focus out from under it.
        return;
      }
      const focusKey = {
        key: event.key,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      };
      // Defensive parity with the earlier stage: a capturing key view (a slider's
      // value axis) keeps its arrow even here.
      if (focusManager.keyViewCaptures(focusKey)) return;
      const moved = focusManager.moveKeyViewLinear(direction);
      // Nothing registered to move to — decline rather than swallow the key. A
      // released text surface can never reach this state (its host owns the exit),
      // so this branch is defensive, not a beep path.
      if (moved === null) return;
      focusManager.place(null, { kind: "focusable", id: moved }, { modality: "keyboard" });
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    // ---- Engine scroll-key route ([Q02]) ----
    // Bare PageUp / PageDown / Home / End in engine-routed mode, after every
    // earlier stage (including the key-view delegate — a ringed list owns its
    // own Page keys) declined them. Element-attached scroll handling and the
    // browser's native focus-driven key scrolling both require DOM focus
    // inside the scroll container, which engine-routed mode never grants — so
    // the engine routes the intent itself: first through the responder chain's
    // established transcript paging actions (the same handlers the ⌥⌘↑/↓ and
    // ⌥⇧⌘↑/↓ chords drive, [D07]-coherent), then a generic region scroll via
    // the `tug-region-scroll-set` channel every scroll region listens on.
    function engineScrollKeyListener(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const k = event.key;
      if (k !== "PageUp" && k !== "PageDown" && k !== "Home" && k !== "End") return;
      if (focusManager.keyboardRoute() === "dom-granted") return;
      // Migration belt (like the delegate listener above): an editable active
      // element owns its Page/Home/End keys for the caret.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA")
      ) {
        return;
      }
      // (1) The key card's own paging actions — the transcript's entry-aligned
      // steps, follow-bottom coherent.
      const action =
        k === "PageUp"
          ? TUG_ACTIONS.PREVIOUS_TURN
          : k === "PageDown"
            ? TUG_ACTIONS.NEXT_TURN
            : k === "Home"
              ? TUG_ACTIONS.FIRST_TURN
              : TUG_ACTIONS.LAST_TURN;
      const { handled, continuation } = manager.sendToKeyCardForContinuation({
        action,
        phase: "discrete",
      });
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        continuation?.();
        return;
      }
      // (2) Generic fallback: page the key card's first live scroll region
      // through the `tug-region-scroll-set` channel (SmartScroll-coherent —
      // the same event CardHost's cold-boot restore uses).
      const cardId = focusManager.keyCard();
      if (cardId === null) return;
      const scope = document.querySelector(
        `[data-card-id="${CSS.escape(cardId)}"]`,
      );
      if (scope === null) return;
      const region = Array.from(
        scope.querySelectorAll<HTMLElement>("[data-tug-scroll-key]"),
      ).find(
        (el) => el.offsetParent !== null && el.scrollHeight > el.clientHeight,
      );
      if (region === undefined) return;
      const page = Math.max(40, region.clientHeight - 48);
      const max = region.scrollHeight - region.clientHeight;
      const top =
        k === "Home"
          ? 0
          : k === "End"
            ? max
            : k === "PageUp"
              ? Math.max(0, region.scrollTop - page)
              : Math.min(max, region.scrollTop + page);
      region.dispatchEvent(
        new CustomEvent("tug-region-scroll-set", {
          detail: { top, left: region.scrollLeft },
          bubbles: false,
          cancelable: true,
        }),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    // ---- Stages 2-4: bubble-phase listener ----
    function bubbleListener(event: KeyboardEvent): void {
      // Stage 2: keyboard navigation -- Enter-key default-button activation.
      // [D02] Enter-key check lives in stage-2 of the bubble pipeline.
      // [D04] Activation via synthetic click (element.click()).
      if (event.key === "Enter") {
        const active = document.activeElement as HTMLElement | null;
        // A focus-refusing button (`data-tug-focus="refuse"`) that holds DOM
        // focus is the engine's *ringed* control — e.g. a card-modal dialog's
        // Allow / Deny ([P17]): they ride the engine key-view ring and refuse to
        // own DOM focus, so the browser's native focused-button Enter never fires
        // for them. Such a button must be activated through this engine path, not
        // skipped as "native handles it" — otherwise Enter on the ringed Allow
        // (after a Tab tour lands DOM focus on it) does nothing. A NON-refusing
        // focused button still keeps native Enter (it activates itself).
        const activeIsRefusingButton =
          active !== null &&
          active.tagName === "BUTTON" &&
          active.getAttribute("data-tug-focus") === "refuse";
        const skipActivation =
          active !== null &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.tagName === "SELECT" ||
            active.isContentEditable ||
            (active.tagName === "BUTTON" && !activeIsRefusingButton));
        if (!skipActivation) {
          // The Enter target is the ringed control. In engine-routed mode no
          // control holds native focus (the keyboard is parked on the sink),
          // so the ringed KEY VIEW is the control Enter presses — activated
          // through the engine ([P08]: the old focus-refusing-button special
          // case is now the universal case; a refusing button that still
          // holds DOM focus keeps the direct path). When the ring is on a
          // non-control stop (a list / field / item-group), Enter falls to
          // the pane's default button ([P14] "Return's home").
          //
          // Pane-scope the default-button fallback. A `Return` belongs to the
          // pane the user is working in (the first responder's pane); a default
          // button registered by a sheet in ANOTHER pane (e.g. an unbound card's
          // picker Open button) must NOT be pressed by it ([D15] pane modality).
          // With no pane context (gallery / standalone) fall back to the global top.
          let defaultButton: HTMLElement | null = null;
          if (activeIsRefusingButton) {
            defaultButton = active;
          } else if (focusManager.keyboardRoute() === "engine-routed") {
            const ringed = document.querySelector<HTMLElement>(
              "[data-key-view-kbd]",
            );
            if (
              ringed !== null &&
              (ringed.tagName === "BUTTON" ||
                ringed.getAttribute("role") === "button")
            ) {
              defaultButton = ringed;
            }
          }
          if (defaultButton === null) {
            const frId = manager.getFirstResponder();
            const frEl =
              frId !== null && typeof document !== "undefined"
                ? document.querySelector(`[data-responder-id="${CSS.escape(frId)}"]`)
                : null;
            const activePane = frEl?.closest(".tug-pane") ?? null;
            defaultButton =
              activePane !== null
                ? manager.peekDefaultButtonInScope(activePane)
                : manager.peekDefaultButton();
          }
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
    // first-responder status from the active editor. This is the web
    // equivalent of Cocoa's acceptsFirstResponder = false.
    //
    // The refusal is one of the facts the gesture interpreter classifies, so
    // for pointer gestures it arrives here as `promotion: "skip"` /
    // `placement: "skip"` on the record, and the interpreter's own mousedown
    // handler is what prevents the browser focus default. Controls only need
    // the attribute; nothing here re-derives it from the event.
    //
    // Bounded semantics. Per `tugplan-dev-overlay-framework.md` [D01]
    // (#mental-model), `data-tug-focus="refuse"` controls exactly three
    // keyboard-ownership behaviors and nothing else: chain-promotion-skip,
    // key-view-placement-skip, and browser-focus-prevention. The three are one
    // idea — the control is outside the key loop, so no pointer gesture on it
    // moves any keyboard register. It does NOT gate pane activation or
    // deselect. See [D01] for the disambiguation rationale and
    // (#mental-model) for the five-subsystem model.

    // ---- Pointer-driven placement (Risk R01's mitigation) ----
    // Click transitions are ENGINE-FIRST: a pointerdown that resolves to an
    // engine-addressable target places it (pointer modality) at capture
    // phase, BEFORE the browser's mousedown focus default — so the settled
    // state after any click is already legal, or one watchdog pass from it.
    // Resolution is structural: a `data-tug-state-key` control places as
    // state-key; a registered focusable places by id; a responder places
    // only when it declared a focus contract (a real text surface). A click
    // that resolves to nothing engine-addressable while a text surface holds
    // the grant places `none` — the keyboard leaves the surface (matching
    // the pre-inversion blur) and parks at the engine.
    //
    // Whether the gesture may place at all is the interpreter's call
    // (`placement: "place"`): it is what knows that a focus-refusing control is
    // outside the key loop, that a cross-card activation click realizes the
    // card's RECORDED destination rather than whatever sat under the pointer,
    // and that a surface may have declared its chrome placement-suppressing.
    // This body is only the resolution — which engine target the click names.
    function placeFromPointer(target: EventTarget | null, cardId: string): void {
      const el =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (el === null) return;
      const marker = el.closest<HTMLElement>(
        "[data-tug-state-key], [data-tug-focusable], [data-responder-id]",
      );
      if (marker !== null) {
        const stateKey = marker.getAttribute("data-tug-state-key");
        if (stateKey !== null) {
          focusManager.place(cardId, { kind: "state-key", key: stateKey }, {
            modality: "pointer",
            preventScroll: true,
          });
          return;
        }
        const focusableId = marker.getAttribute("data-tug-focusable");
        if (focusableId !== null) {
          focusManager.place(cardId, { kind: "focusable", id: focusableId }, {
            modality: "pointer",
          });
          return;
        }
        const responderId = marker.getAttribute("data-responder-id");
        if (
          responderId !== null &&
          focusManager.responderHasFocusContract(responderId)
        ) {
          focusManager.place(cardId, { kind: "responder", responderId }, {
            modality: "pointer",
          });
          return;
        }
      }
      // Nothing engine-addressable under the click (transcript prose, a
      // contract-less container). If a text surface currently holds the
      // grant, the keyboard leaves it — place `none` so the route flips to
      // engine-routed and the sink parks (a park provably preserves the
      // text selection a drag is creating). Otherwise leave everything: the
      // key view survives (Tab resumes from it) and the watchdog re-parks
      // the browser's transient mousedown focus.
      if (focusManager.keyboardRoute() === "dom-granted") {
        focusManager.place(cardId, { kind: "none" }, { modality: "pointer" });
      }
    }

    // The chain's half of a classified pointer gesture. Every decision here is
    // read from the interpreter's record:
    //
    //   - `skip` — a focus-refusing control (targeted dispatch makes the first
    //     responder irrelevant to its action, and accelerators need the
    //     responder left on the editor), first-responder-preserving chrome (an
    //     activation/drag surface, not a responder target), or draggable
    //     content in a background card, whose promotion defers with its
    //     activation so the chain and deck registers cannot split.
    //   - `redirect` — a stray click on a modal scrim promotes the dialog
    //     island instead of the click target, so first responder lands on (and
    //     activates) the dialog's card rather than the scrimmed surround.
    //   - `target` — promote from the click target, then place, so the click's
    //     focus transition is driven by the engine at pointerdown, ahead of the
    //     browser's mousedown focus default, never derived after the fact.
    function promoteOnPointerDown(event: PointerEvent): void {
      const gesture = currentGesture();
      if (gesture === null) {
        // No interpreter installed (a bare provider outside the deck): promote
        // from the target and leave the engine placement alone.
        promoteFromTarget(event.target as Node | null);
        return;
      }
      if (gesture.promotion.kind === "skip") return;
      if (gesture.promotion.kind === "redirect") {
        promoteFromTarget(gesture.promotion.to);
        return;
      }
      promoteFromTarget(event.target as Node | null);
      if (gesture.placement === "place" && gesture.cardId !== null) {
        placeFromPointer(event.target, gesture.cardId);
      }
    }

    function promoteOnFocusIn(event: FocusEvent): void {
      if (targetRefusesFocus(event.target)) return;
      promoteFromTarget(event.target as Node | null);
      // Granted-surface legalization: a text surface that claims DOM focus
      // through its own channel becomes the engine's dom-granted target —
      // structurally scoped so the grant can never launder a cross-card
      // steal:
      //  - a `data-tug-state-key` native control anywhere (form controls
      //    are the state-key class of [P02]; sheet autofocus and label
      //    clicks are their normal claim channels);
      //  - a contract responder ONLY when its card is the key card (a
      //    card's own content claiming focus while its card is active is
      //    the activation-consistent grant — `cardDidActivate` /
      //    `sheetDidHide` reclaims; a NON-key-card editor claiming focus
      //    is exactly the steal class the watchdog corrects).
      const el =
        event.target instanceof HTMLElement ? event.target : null;
      if (el === null) return;
      const stateKeyEl = el.closest<HTMLElement>("[data-tug-state-key]");
      if (stateKeyEl !== null) {
        const key = stateKeyEl.getAttribute("data-tug-state-key");
        const cardId = stateKeyEl
          .closest<HTMLElement>("[data-card-id]")
          ?.getAttribute("data-card-id");
        if (key !== null && cardId !== undefined && cardId !== null) {
          focusManager.place(cardId, { kind: "state-key", key }, {
            modality: focusManager.inputSource(),
            preventScroll: true,
          });
        }
        return;
      }
      const responderEl = el.closest<HTMLElement>("[data-responder-id]");
      if (responderEl === null) return;
      const responderId = responderEl.getAttribute("data-responder-id");
      if (
        responderId === null ||
        !focusManager.responderHasFocusContract(responderId)
      ) {
        return;
      }
      const cardId = responderEl
        .closest<HTMLElement>("[data-card-id]")
        ?.getAttribute("data-card-id");
      if (cardId == null || focusManager.keyCard() !== cardId) return;
      focusManager.place(cardId, { kind: "responder", responderId }, {
        modality: focusManager.inputSource(),
        preventScroll: true,
      });
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
    // in the capture phase ahead of the global-shortcut dispatch. arrowNavListener
    // sits between them: it owns bare arrows for the spatial plane ahead of the
    // keybinding map, the same precedence the walk has for Tab ([P22]).
    // arrowFallbackListener is the far end of that same arrow story — the
    // liveliness net ([P01]) — and so registers AFTER keyViewDelegateListener:
    // descended row scopes and `onKey` consumers get their arrows first, and the
    // net picks up only what nothing claimed.
    // ---- Input-source latch ----
    // The engine's modality latch: the last REAL user input source. The ring
    // projection reads it for native focus changes; a placement overrides it
    // per call. Pure-modifier keydowns don't count as keyboard navigation.
    const noteKeyboardInput = (event: KeyboardEvent): void => {
      const k = event.key;
      if (k === "Shift" || k === "Meta" || k === "Alt" || k === "Control") return;
      focusManager.noteInputSource("keyboard");
    };
    const notePointerInput = (): void => {
      focusManager.noteInputSource("pointer");
    };
    document.addEventListener("keydown", noteKeyboardInput, { capture: true });
    document.addEventListener("pointerdown", notePointerInput, { capture: true });

    document.addEventListener("keydown", focusWalkListener, { capture: true });
    document.addEventListener("keydown", arrowNavListener, { capture: true });
    document.addEventListener("keydown", captureListener, { capture: true });
    document.addEventListener("keydown", actDispatchListener, { capture: true });
    document.addEventListener("keydown", keyViewDelegateListener, { capture: true });
    document.addEventListener("keydown", arrowFallbackListener, { capture: true });
    document.addEventListener("keydown", engineScrollKeyListener, { capture: true });
    document.addEventListener("keydown", bubbleListener);
    document.addEventListener("pointerdown", promoteOnPointerDown, { capture: true });
    document.addEventListener("focusin", promoteOnFocusIn, { capture: true });
    document.addEventListener("contextmenu", fallbackContextMenu);

    return () => {
      document.removeEventListener("keydown", noteKeyboardInput, { capture: true });
      document.removeEventListener("pointerdown", notePointerInput, { capture: true });
      document.removeEventListener("keydown", focusWalkListener, { capture: true });
      document.removeEventListener("keydown", arrowNavListener, { capture: true });
      document.removeEventListener("keydown", captureListener, { capture: true });
      document.removeEventListener("keydown", actDispatchListener, { capture: true });
      document.removeEventListener("keydown", keyViewDelegateListener, { capture: true });
      document.removeEventListener("keydown", arrowFallbackListener, { capture: true });
      document.removeEventListener("keydown", engineScrollKeyListener, { capture: true });
      document.removeEventListener("keydown", bubbleListener);
      document.removeEventListener("pointerdown", promoteOnPointerDown, { capture: true });
      document.removeEventListener("focusin", promoteOnFocusIn, { capture: true });
      document.removeEventListener("contextmenu", fallbackContextMenu);
      selectionGuard.detach();
      document.removeEventListener("focusin", onFocusChange, { capture: true });
      document.removeEventListener("focusout", onFocusChange, { capture: true });
      document.removeEventListener("focusin", enforceOnFocusIn, { capture: true });
      document.removeEventListener("focusout", enforceOnFocusOut, { capture: true });
      registerMenuCapsRefresher(null);
      registerMenuValidationChain(null);
      // The scoped-binding view installed above captures this manager; an
      // unmounted provider's chain must not keep answering resolveChord.
      keymapRegistry.setEnvironment({ scopedBindings: () => [] });
      unsubscribeEditCaps();
      unsubscribeKeyboardAccess();
      unsubscribeRingModality();
      unsubscribeKeyCard();
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
        {/* The engine-owned key sink (Spec S01): the one legal
            `document.activeElement` while the keyboard route is
            engine-routed. Rendered by the provider so it exists exactly
            as long as the engine does. A parking register, not an ARIA
            composite — no `aria-activedescendant` (invalid from a
            sibling); the screen-reader story is the accessibility-mode
            focus-follows mirror, under which the sink is never focused.
            Quiet `aria-label` rather than `aria-hidden` (a focusable
            element must not be aria-hidden). Excluded from the walk and
            the focusable registry by construction (it registers
            nothing). */}
        <div
          data-tug-key-sink=""
          tabIndex={-1}
          className="tug-key-sink"
          aria-label="Keyboard"
        />
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
