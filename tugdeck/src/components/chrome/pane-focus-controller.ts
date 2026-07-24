/**
 * pane-focus-controller.ts — sole authority for the `data-focused` DOM
 * attribute on every `.tug-pane[data-pane-id]` element within the deck
 * root, and the sole input path that drives pane activation and
 * canvas-background deselect from user gestures.
 *
 * **Attribute authority** (Commit 0 of pane-activation-listener-plan):
 *   - Reads: the store's `activePaneId` (snapshot-reactive via
 *     `useSyncExternalStore`) and the deck root ref.
 *   - Writes: `data-focused="true"` on the active pane's frame,
 *     `data-focused="false"` on every other pane's frame. Writes
 *     happen in `useLayoutEffect` post-commit so newly-mounted panes
 *     (added via a store change) receive their attribute before
 *     paint — no flicker.
 *   - React no longer renders `data-focused` from a prop; React's
 *     reconciler therefore never considers or clobbers this
 *     attribute.
 *
 * **Gesture classification** (Commit 1 of pane-activation-listener-plan):
 *   - A single document-level capture-phase `pointerdown` listener
 *     walks up from `event.target`, applies the portal/overlay
 *     positive-gate (`deckRoot.contains(...)`), and dispatches to
 *     one of two branches:
 *       - **Branch A (activation):** click landed inside a pane.
 *         metaKey and `[data-no-activate]` are opt-outs. Otherwise
 *         `store.activateCard(pane.activeCardId)` fires; the
 *         `didActivate` observer below auto-clears any active
 *         deselect.
 *       - **Branch B (deselect):** click landed inside the deck
 *         but outside every pane — canvas background. Sets an
 *         internal ref, re-applies focus so every pane goes to
 *         `data-focused="false"`. metaKey does NOT skip this
 *         branch (matches prior `handleCanvasPointerDown` which
 *         had no metaKey check).
 *
 * **Three preservation behaviors**:
 *   1. **Cmd-click on a pane → no activation.** Mac modifier
 *      convention for interacting with a background window
 *      without bringing it forward.
 *   2. **Background close-box click → no activation.** The close
 *      `TugButton` carries `data-no-activate`; the listener walks
 *      up and short-circuits before calling `activateCard`.
 *   3. **Cmd-resize on a background pane → no activation.**
 *      Automatically covered by #1 (the metaKey gate fires before
 *      classification of which pane-descendant is targeted). The
 *      document-level listener runs in capture phase, before the
 *      resize handle's React `onPointerDown`; the resize gesture
 *      proceeds normally in React's bubble phase.
 *
 * **Deselect lives in the DOM, not React.** Deselect is expressed
 * as "write `data-focused="false"` on every pane." There is no
 * separate `data-deselected` attribute, no React state, no mask
 * CSS rules. The `deselectedRef` below is a transient ref inside
 * this module — not component state — so it does not participate
 * in React rendering (L06-clean).
 *
 * **Ordering with `ResponderChainProvider`'s document listener.**
 * Both install document-level `pointerdown` capture listeners.
 * Registration order determines firing order. Subsystems are
 * independent — the chain's first-responder bit vs. DeckManager's
 * composite first-responder bit. Correctness is order-agnostic.
 *
 * **Not defeated by `stopImmediatePropagation`.** No code in this
 * suite calls `stopImmediatePropagation` on document-level
 * `pointerdown`. A third-party or future listener that did so,
 * registered before this one, could suppress classification.
 * Known-but-absent adversary.
 *
 * **Pointer-button filtering.** Primary button (`event.button === 0`)
 * only. Right-click and middle-click skip classification entirely so
 * neither pane-activation focus transfer nor canvas-background
 * deselect fires from a non-primary button. Standard desktop
 * interaction: primary click activates / focuses; secondary click
 * shows a context menu without changing focus or selection.
 * Filtering here is what lets a right-click on selected text in a
 * transcript cell preserve the selection through to the moment the
 * context menu opens — without the filter, `transferFocusForActivation`
 * would `.focus()` an activation target on the right-button
 * pointerdown and collapse the document selection.
 *
 * **Pointer→click z-index ordering.** DeckCanvas comments note
 * that synchronous z-index update on pointerdown preserves the
 * browser's pointer→click event sequence for clicks on
 * interactive elements in background panes. The listener runs
 * synchronously in capture phase; `store.activateCard` mutates
 * state synchronously; `useSyncExternalStore` forces sync
 * re-render for external-store updates outside a React event
 * handler. Invariant preserved.
 *
 * Tuglaws:
 *   - **L03** — `useLayoutEffect` for event-dependent registration,
 *     so the listener is installed before paint.
 *   - **L06** — pane focus is appearance state; lives in the DOM.
 *   - **L07** — `applyFocusRef` holds the latest closure so the
 *     listener reads current state at event-time, not from a
 *     stale mount-time closure.
 *   - **L10** — controller owns exactly one responsibility (pane
 *     focus authority + the gesture layer that drives it).
 *   - **L11** — pane activation is DeckManager-owned state
 *     mutation; the listener is the emitter.
 *   - **L22** — store observer (`observeCardDidActivate`) drives
 *     direct DOM mutation (via `applyFocusRef.current()`), no
 *     round-trip through React state.
 *   - **L23** — pane activation and deselect visual are
 *     user-observable state, preserved across the refactor.
 *
 * @module components/chrome/pane-focus-controller
 */

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { useDeckManager } from "@/deck-manager-context";
import { transferFocusForActivation } from "@/focus-transfer";
import { getFocusManager } from "@/components/tugways/focus-manager";

export function usePaneFocusController(
  deckRootRef: React.RefObject<HTMLDivElement | null>,
): void {
  const store = useDeckManager();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const activePaneId = snapshot.activePaneId ?? null;

  // `applyFocusRef.current` is rewritten on every render so it
  // closes over the current `activePaneId`. Both the reactive
  // useLayoutEffect and the imperative listener call
  // `applyFocusRef.current()` — they always see the latest snapshot
  // without participating in the effect dep array.
  //
  // The active pane's title bar is its only selection signal: a deselect
  // (canvas-background click) clears `activePaneId` in the store, so every
  // pane drops to `data-focused="false"` here. No separate "deselected"
  // flag — selection is exactly "which pane is `activePaneId`".
  const applyFocusRef = useRef<() => void>(() => {});
  applyFocusRef.current = () => {
    const root = deckRootRef.current;
    if (!root) return;
    for (const pane of root.querySelectorAll<HTMLElement>(
      ".tug-pane[data-pane-id]",
    )) {
      pane.dataset.focused =
        pane.dataset.paneId === activePaneId ? "true" : "false";
    }
  };

  // Reactive apply: runs after each React commit when the snapshot
  // changes. Handles pane add / remove, activation, and deselect.
  useLayoutEffect(() => {
    applyFocusRef.current();
  }, [activePaneId, snapshot, deckRootRef]);

  // Document-level classification listener.
  useLayoutEffect(() => {
    // Set by `onPointerDown` when the gesture is a cross-card activation
    // (the clicked pane's active card was not the first responder), consumed
    // by `onMouseDown` in the same gesture. An activation click's focus
    // placement belongs to `transferFocusForActivation` — the browser's
    // mousedown focus default must not clobber it: on card content with no
    // focusable ancestor under the click, WebKit clears focus to body,
    // which strips the caret the transfer just placed (e.g. the session card's
    // prompt entry after a click on transcript prose). Matches the Mac
    // first-click-activates convention: the click that brings a background
    // card forward activates it and does not also place a caret or start a
    // selection; the next click interacts normally.
    let activationClick = false;

    // Deferred activation for a gesture that starts on draggable content in a
    // card that is not the first responder (focus-language.md § Drag and the
    // keyboard). At pointerdown the gesture is not yet known to be a click or
    // a drag, and the two want opposite outcomes: a click activates, a drag
    // leaves the source card inactive (macOS background-drag semantics) and
    // needs the paired mousedown NOT to be `preventDefault`ed, since a
    // prevented mousedown is the browser's signal not to begin a native drag.
    // So the classification is parked here and resolved by whichever ending
    // arrives: `dragstart` cancels, `pointerup` commits. The two are mutually
    // exclusive — once a native drag begins the browser ends the gesture with
    // `dragend`, never `pointerup`.
    let pendingActivation: {
      outgoingCardId: string | null;
      incomingCardId: string;
    } | null = null;

    function clearPendingActivation(): void {
      if (pendingActivation === null) return;
      pendingActivation = null;
      getFocusManager()?.endDeferredGesture();
    }

    function commitPendingActivation(): void {
      const pending = pendingActivation;
      pendingActivation = null;
      if (pending === null) return;
      // The same transfer the synchronous branch runs. `suppressPointer-
      // PlacementOnce` is deliberately NOT armed: the latch is consumed by
      // the chain provider's `promoteOnPointerDown` at the *next* pointerdown,
      // so arming it here would poison the following, unrelated gesture — and
      // this gesture has no engine placement left to suppress anyway (the
      // provider's placement pass self-gates on the key card, which was not
      // this card when the pointerdown ran).
      transferFocusForActivation({
        outgoingCardId: pending.outgoingCardId,
        incomingCardId: pending.incomingCardId,
        store,
        commitMutation: () => store.activateCard(pending.incomingCardId),
      });
      // Closed AFTER the transfer: the transfer's own focus writes are the
      // legal outcome, and the browser-default churn window ends with them.
      getFocusManager()?.endDeferredGesture();
    }

    function onPointerDown(event: PointerEvent): void {
      activationClick = false;
      clearPendingActivation();
      const root = deckRootRef.current;
      if (!root) return;

      // Primary-button-only classification. Right-click and middle-
      // click never trigger pane-activation focus transfer or canvas-
      // background deselect — those buttons are for context menus and
      // the user expects the document selection to survive a
      // right-click on selected text. The previous "no filter"
      // behavior matched the legacy `handleFramePointerDown` but
      // routed right-click through `transferFocusForActivation`,
      // whose `.focus()` call collapsed any active selection at the
      // moment a context menu would have used it. Standard desktop
      // interaction is: primary click activates, secondary click
      // shows a menu without changing focus.
      if (event.button !== 0) return;

      const target = event.target;
      const startEl =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (!startEl) return;

      // Positive deck-container gate. Clicks in portaled overlays
      // (tug-menu, tug-sheet, tug-tooltip, fallback context menu,
      // anything rendered via createPortal to document.body) land
      // outside the deck root and must not trigger classification.
      if (!root.contains(startEl)) return;

      // Canvas-overlay short-circuit. Lifted ABOVE the Branch A/B
      // split so a click inside `<CanvasOverlayRoot />` skips BOTH
      // the in-pane activation path AND the canvas-background
      // deselect path. The overlay tier hosts portaled popups,
      // completion menus, and sheets — all sitting OUTSIDE any
      // pane in the DOM tree. Without this short-circuit, a click
      // on a completion item would land in the deck but outside
      // every pane, and Branch B would treat it as a canvas-
      // background deselect that demotes the active editor's
      // first-responder status. The popup item's own `pointerdown`
      // + `preventDefault()` keeps `document.activeElement` on the
      // editor's contentDOM; this short-circuit keeps the
      // responder chain in sync with that focus.
      //
      // The selector keys on the canvas overlay's `data-slot` —
      // NOT on `data-tug-focus="refuse"`. Per `tugplan-dev-overlay-
      // framework.md` [D01] (#mental-model), the two concerns are
      // disambiguated: focus-refuse is button-class chain-promotion
      // / browser-focus-prevention; the canvas-overlay short-circuit
      // is structural ("am I inside the overlay tier?"). Selecting
      // on the slot directly says what we mean.
      if (startEl.closest('[data-slot="tug-canvas-overlay-root"]')) return;

      const paneEl = startEl.closest("[data-pane-id]");

      if (paneEl === null) {
        // Branch B: canvas background → a real deselect. Clear the active
        // card so no pane is the first responder; the store notify repaints
        // every title bar to deactivated via the reactive effect. (The
        // responder chain is independently promoted to the deck-canvas root
        // by the chain provider's pointerdown promotion.) metaKey does NOT
        // skip this branch.
        store.deselectActiveCard();
        return;
      }

      // Branch A: activation path.

      // Preserve #1 (Cmd-click on pane) and #3 (Cmd-resize).
      if (event.metaKey) return;

      // Preserve #2: data-no-activate opt-out (close button).
      if (startEl.closest("[data-no-activate]")) return;

      // Climb from the nearest [data-pane-id] ancestor to the first one
      // that resolves to a real pane in the store. Internal tab bars
      // (Settings, Component Gallery, help sheet) stamp a *synthetic*
      // data-pane-id on their own bar div; without the climb, closest()
      // resolves to that synthetic id, the store lookup misses, and the
      // enclosing card is never activated by a tab click.
      const panes = store.getSnapshot().panes;
      let candidateEl: Element | null = paneEl;
      let pane: (typeof panes)[number] | undefined;
      while (candidateEl) {
        const candidateId = candidateEl.getAttribute("data-pane-id");
        pane = candidateId ? panes.find((p) => p.id === candidateId) : undefined;
        if (pane) break;
        candidateEl = candidateEl.parentElement?.closest("[data-pane-id]") ?? null;
      }
      if (!pane) return;

      // Pane-modal scrim short-circuit. The pane's built-in scrim only
      // receives pointer events while a sheet has raised it, so a
      // pointerdown targeting the scrim is a stray click on a pane-modal
      // surround. On the already-active pane, re-running the activation
      // transfer would promote the card and coarsen the key view out of
      // the sheet — the chain provider's scrim redirect keeps promotion
      // on the open sheet instead. A background pane still runs the
      // transfer so its z-order comes forward; the sheet reclaims
      // promotion downstream of activation.
      if (
        startEl.classList.contains("tug-pane-scrim") &&
        store.getFirstResponderCardId() === pane.activeCardId
      ) {
        return;
      }

      // Route the activation through `transferFocusForActivation`
      // The helper
      // owns the save → commit → resolve → gate → focus sequence
      // for rows 1–3 of the activation trigger taxonomy; for this
      // call site (row 2, pane-chrome activation) the
      // `commitMutation` closure is `store.activateCard`. The
      // helper's internal save step replaces the explicit
      // `invokeSaveCallback` block this site previously carried;
      // it skips correctly when outgoing is null or matches
      // incoming, so semantics for same-pane clicks and first
      // activations are preserved.
      //
      // `activateCard` is safe on the already-active card id:
      // `_flipFirstResponder`'s same-bit branch short-circuits
      // will/didActivate events (deck-manager.ts:822-836). The
      // didActivate observer below clears `deselectedRef` for real
      // cross-pane flips; the explicit clear after this call covers
      // the same-bit case so a click back onto the only / already-
      // active pane still restores `data-focused="true"`.
      const outgoingCardId = store.getFirstResponderCardId();
      const isActivation = outgoingCardId !== pane.activeCardId;

      // Draggable content in a non-first-responder card: arm, don't commit.
      // The gesture ending decides (see `pendingActivation` above).
      if (isActivation && startEl.closest('[draggable="true"]') !== null) {
        pendingActivation = {
          outgoingCardId,
          incomingCardId: pane.activeCardId,
        };
        // The gesture keeps the browser's mousedown focus default (below), so
        // tell the engine to treat the resulting focus move as browser churn
        // rather than a raw write worth ledgering.
        getFocusManager()?.beginDeferredGesture();
        return;
      }

      // Flag the paired mousedown (below) when this click transfers the
      // first responder to a different card — including from a deselected
      // canvas (`null` outgoing).
      activationClick = isActivation;
      // The same classification stands the engine's pointer placement
      // down for this gesture: the activation transfer realizes the
      // card's recorded destination, and the provider's later placement
      // pass must not overwrite it (first-click-activates — the click
      // activates, it does not place).
      if (activationClick) {
        getFocusManager()?.suppressPointerPlacementOnce();
      }
      transferFocusForActivation({
        outgoingCardId,
        incomingCardId: pane.activeCardId,
        store,
        commitMutation: () => store.activateCard(pane.activeCardId),
      });
    }

    // Mousedown capture listener: suppress the browser's default focus-
    // clearing when the click lands on pane chrome (not card content).
    //
    // WebKit's mousedown default behavior walks up from the click
    // target looking for a focusable element; if none is found, it
    // clears the current focus to body. For a trusted click on a
    // non-focusable pane chrome element (title bar span, frame divs,
    // etc.) this blurs whatever the user had focused before — which,
    // for AT0003's cross-pane activation flow, is the very element our
    // A3 activation effect has just restored focus to. The result is
    // a race: A3 focuses the destination card's input; mousedown
    // default blurs it 1ms later; the user's caret vanishes.
    //
    // The fix is to preventDefault on mousedown when we know the click
    // is a pane activation gesture (the same classification the
    // pointerdown handler above uses). Card-content clicks still get
    // the browser's default — an input click should still focus the
    // input normally; we only suppress the clearing path.
    //
    // One carve-out: a gesture on draggable content in a background card
    // is deferred rather than classified (see `pendingActivation`), and a
    // deferred gesture keeps the browser default — a prevented mousedown
    // never begins a native drag.
    //
    // Why a separate listener instead of preventDefault on pointerdown:
    // preventDefault on pointerdown cancels ALL compatibility mouse
    // events (mousedown, mouseup, click), which breaks every downstream
    // click handler. mousedown preventDefault surgically suppresses
    // only the focus-clearing default.
    function onMouseDown(event: MouseEvent): void {
      const root = deckRootRef.current;
      if (!root) return;
      const target = event.target;
      const startEl =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (!startEl) return;
      if (!root.contains(startEl)) return;
      const paneEl = startEl.closest("[data-pane-id]");
      if (paneEl === null) return;
      if (event.metaKey) return;
      if (startEl.closest("[data-no-activate]")) return;
      // Deferred-activation gesture: the pointerdown classifier parked this
      // one instead of activating, so there is no placed focus to protect —
      // and `preventDefault` here would stop the browser from ever beginning
      // the native drag this gesture may turn out to be. Leave the default
      // alone; the mousedown default on a `draggable` element prepares a drag
      // rather than placing a caret, so nothing is lost if it turns out to be
      // a plain click.
      if (pendingActivation !== null) return;
      // Activation click (flagged by the pointerdown classifier above):
      // `transferFocusForActivation` has already placed focus on the
      // incoming card's destination. Suppress the browser's mousedown
      // focus default even on card content — a click on non-focusable
      // content (transcript prose) would otherwise clear focus to body
      // and strip the caret the transfer just placed.
      if (activationClick && event.button === 0) {
        activationClick = false;
        event.preventDefault();
        return;
      }
      // Card-content click: the browser's default focus behavior is
      // the correct outcome (input → focus input, etc.). Only pane-
      // chrome clicks need the focus-clearing suppression.
      if (startEl.closest("[data-card-host]") !== null) return;
      // Sheet-content click: a TugSheet is a pane-modal overlay portaled
      // into the pane *frame* ([D19]) — a sibling of the card host, so the
      // `[data-card-host]` exemption above misses it even though its inputs
      // and buttons are genuine focusable content, not pane chrome.
      // Suppressing mousedown here would kill click-to-focus for a TugInput
      // inside a sheet (the button-class click path still works, and
      // programmatic `.focus()` works, which is exactly the asymmetry that
      // makes the bug subtle). Treat it like a card-content click.
      if (startEl.closest('[data-slot="tug-sheet"]') !== null) return;
      event.preventDefault();
    }

    // Pointer-stream resync for the first click after a native drag.
    //
    // WebKit delivers NO `pointerdown` for the first click after a native
    // drag session: the drag consumed the pointer stream's release, so the
    // pointer-event state machine still holds the pointer "down" and the
    // next press emits only `mousedown` (its release delivers the catch-up
    // `pointerup` that re-syncs). Every pointer-gesture layer in the deck —
    // this controller's activation classification, the chain's pointerdown
    // promotion, list selection — rides capture-phase `pointerdown`, so
    // that first click would be entirely invisible: no activation, no
    // selection, nothing.
    //
    // Heal the stream in one place instead of teaching every layer a
    // mousedown fallback: when a trusted primary-button mousedown arrives
    // with no preceding pointerdown, dispatch the missing pointerdown on
    // the same target. `dispatchEvent` is synchronous, so the entire
    // pointerdown pass (document capture listeners and React's root
    // delegation alike) completes before the remaining mousedown listeners
    // — including this controller's own `onMouseDown` below — run.
    let sawTrustedPointerDown = false;
    function trackPointerDown(event: PointerEvent): void {
      if (event.isTrusted) sawTrustedPointerDown = true;
    }
    function resyncPointerStreamOnMouseDown(event: MouseEvent): void {
      const saw = sawTrustedPointerDown;
      sawTrustedPointerDown = false;
      if (saw || !event.isTrusted || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: event.button,
          buttons: event.buttons,
          detail: event.detail,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }),
      );
    }

    // Resolution listeners for the deferred-activation latch. `dragstart`
    // means the gesture was a drag — the source card stays inactive.
    // `pointerup` means it was a click — activate now. `pointercancel` and
    // `dragend` are belt-and-suspenders: neither should reach an armed latch
    // (a drag always passes through `dragstart` first), but a latch left armed
    // across gestures would activate on an unrelated pointerup.
    function onDragStart(): void {
      clearPendingActivation();
    }
    function onPointerUp(): void {
      commitPendingActivation();
    }
    function onGestureAbandoned(): void {
      clearPendingActivation();
    }

    // The resync pair registers FIRST so the healed pointerdown reaches
    // `onPointerDown` before `onMouseDown` reads the gesture classification.
    document.addEventListener("pointerdown", trackPointerDown, {
      capture: true,
    });
    document.addEventListener("mousedown", resyncPointerStreamOnMouseDown, {
      capture: true,
    });
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true });
    document.addEventListener("dragstart", onDragStart, { capture: true });
    document.addEventListener("pointerup", onPointerUp, { capture: true });
    document.addEventListener("pointercancel", onGestureAbandoned, {
      capture: true,
    });
    document.addEventListener("dragend", onGestureAbandoned, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", trackPointerDown, {
        capture: true,
      });
      document.removeEventListener(
        "mousedown",
        resyncPointerStreamOnMouseDown,
        { capture: true },
      );
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("mousedown", onMouseDown, {
        capture: true,
      });
      document.removeEventListener("dragstart", onDragStart, { capture: true });
      document.removeEventListener("pointerup", onPointerUp, { capture: true });
      document.removeEventListener("pointercancel", onGestureAbandoned, {
        capture: true,
      });
      document.removeEventListener("dragend", onGestureAbandoned, {
        capture: true,
      });
    };
  }, [store, deckRootRef]);
}
