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
 * **Pointer-button filtering.** The listener does not filter on
 * `event.button`; right- and middle-click classify the same as
 * primary. Matches prior behavior (the former
 * `handleFramePointerDown` did not check `button` either).
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

export function usePaneFocusController(
  deckRootRef: React.RefObject<HTMLDivElement | null>,
): void {
  const store = useDeckManager();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const activePaneId = snapshot.activePaneId ?? null;

  // Transient ref — not React state. Tracks whether the user's last
  // gesture was an empty-canvas click (deselect) that persists until
  // the next card activation.
  const deselectedRef = useRef(false);

  // `applyFocusRef.current` is rewritten on every render so it
  // closes over the current `activePaneId`. Both the reactive
  // useLayoutEffect and the imperative listener call
  // `applyFocusRef.current()` — they always see the latest snapshot
  // without participating in the effect dep array.
  const applyFocusRef = useRef<() => void>(() => {});
  applyFocusRef.current = () => {
    const root = deckRootRef.current;
    if (!root) return;
    const focusedPaneId = deselectedRef.current ? null : activePaneId;
    for (const pane of root.querySelectorAll<HTMLElement>(
      ".tug-pane[data-pane-id]",
    )) {
      pane.dataset.focused =
        pane.dataset.paneId === focusedPaneId ? "true" : "false";
    }
  };

  // Reactive apply: runs after each React commit when the snapshot
  // changes. Handles pane add / remove and activation propagation.
  useLayoutEffect(() => {
    applyFocusRef.current();
  }, [activePaneId, snapshot, deckRootRef]);

  // Auto-clear deselect on any card activation. The observer fires
  // after `_flipFirstResponder`'s notify (so the useLayoutEffect
  // above has already run with the stale ref value); we must
  // re-apply here.
  useLayoutEffect(() => {
    return store.observeCardDidActivate(null, () => {
      if (deselectedRef.current) {
        deselectedRef.current = false;
        applyFocusRef.current();
      }
    });
  }, [store]);

  // Document-level classification listener.
  useLayoutEffect(() => {
    function onPointerDown(event: PointerEvent): void {
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

      // Positive deck-container gate. Clicks in portaled overlays
      // (tug-menu, tug-sheet, tug-tooltip, fallback context menu,
      // anything rendered via createPortal to document.body) land
      // outside the deck root and must not trigger classification.
      if (!root.contains(startEl)) return;

      const paneEl = startEl.closest("[data-pane-id]");

      if (paneEl === null) {
        // Branch B: canvas background. Set deselect flag and
        // re-apply. metaKey does NOT skip this branch.
        if (!deselectedRef.current) {
          deselectedRef.current = true;
          applyFocusRef.current();
        }
        return;
      }

      // Branch A: activation path.

      // Preserve #1 (Cmd-click on pane) and #3 (Cmd-resize).
      if (event.metaKey) return;

      // Preserve #2: data-no-activate opt-out (close button).
      if (startEl.closest("[data-no-activate]")) return;

      // Preserve #4: focus-refusing controls (TugButton et al. set
      // `data-tug-focus="refuse"`). The responder-chain provider
      // already skips first-responder promotion for these targets;
      // we extend the same exemption here so a click on an
      // in-pane button doesn't trigger `activateCard(activeCardId)`,
      // which would call `makeFirstResponder(cardId)` and demote
      // any inner first responder (e.g. a TugTextEditor inside the
      // card). The control's own `onClick` still fires; only the
      // pane-activation side-effect is skipped — matching the
      // intent of `data-tug-focus="refuse"` ("this control does
      // not change the user's focus context"). Same selector the
      // chain provider uses, so the two surfaces stay aligned.
      if (startEl.closest('[data-tug-focus="refuse"]')) return;

      const paneId = paneEl.getAttribute("data-pane-id");
      if (paneId === null) return;

      const pane = store.getSnapshot().panes.find((p) => p.id === paneId);
      if (!pane) return;

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
      // will/didActivate events (deck-manager.ts:262–266). Our
      // didActivate observer's `if (deselectedRef.current)` check
      // also avoids redundant DOM writes on repeated same-pane
      // clicks.
      transferFocusForActivation({
        outgoingCardId: store.getFirstResponderCardId(),
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
      // Card-content click: the browser's default focus behavior is
      // the correct outcome (input → focus input, etc.). Only pane-
      // chrome clicks need the focus-clearing suppression.
      if (startEl.closest("[data-card-host]") !== null) return;
      event.preventDefault();
    }

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      document.removeEventListener("mousedown", onMouseDown, {
        capture: true,
      });
    };
  }, [store, deckRootRef]);
}
