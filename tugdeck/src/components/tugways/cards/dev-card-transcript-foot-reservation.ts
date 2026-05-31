/**
 * dev-card-transcript-foot-reservation — height reservation for the
 * streaming assistant cell's body foot.
 *
 * A `PermissionDialog` / `QuestionDialog` renders at the foot of the
 * in-flight assistant cell (`AssistantTurnCell`). When the user
 * answers, the gating store field flips to `null`, the dialog unmounts
 * in a single frame, the cell shrinks by the dialog's full height, the
 * scrollport's `scrollHeight` dips, the browser clamps `scrollTop`, and
 * the transcript jumps backward. The replacement — the gated tool's
 * result — streams into the tool block a beat later, so the net effect
 * is a shrink-then-regrow flicker.
 *
 * The fix: on dismissal, freeze the cell entry at its current height
 * via a `min-height` floor. The floored element wraps the WHOLE entry —
 * body AND the inflight footer (the thinking indicator) — so the
 * reserved empty space sits below the footer and the footer's own
 * height changes are absorbed within the floor (otherwise it would add
 * height after dismissal and hop the view, and read as appearing below
 * the gap rather than after the content). A turn's transcript is
 * append-only, so the floor is invisible as the result streams in to
 * fill it — the entry renders at `max(natural, floor)`, and `natural`
 * climbs past the floor as content arrives ("coupled to result
 * growth"). The floor is released — cleared instantly — the moment
 * natural content overtakes it (the common case) or when the turn ends
 * (the tail case of a result smaller than the dialog, e.g. a deny).
 *
 * **Why this observes the store directly [L22].** The reservation is a
 * DOM mutation *driven by external store state* (`pendingApproval` /
 * `pendingQuestion`). L22 forbids routing such a write through React's
 * render cycle — `useSyncExternalStore` → prop → `useLayoutEffect` →
 * DOM injects React's scheduling between the data change and the DOM
 * write, which is precisely how an earlier draft mis-measured the entry
 * (it read the height after React had already unmounted the dialog).
 * Subscribing to the store directly fixes the layer *and* the bug: the
 * store notifies **synchronously on dispatch, before React re-renders**,
 * so when `pendingApproval` clears the dialog is still in the DOM in the
 * callback — we measure and floor the entry there, then React unmounts
 * the dialog into an already-held entry.
 *
 * Only the in-flight cell subscribes (`inFlight` gate): it is the only
 * cell that ever hosts a foot dialog, so committed cells do no
 * per-dispatch work and the subscriber needs no per-cell host check.
 *
 * Laws:
 *  - [L22] store-driven DOM updates observe the store directly in a
 *    `useLayoutEffect` subscription; the floor write lives in the
 *    observer callback, never behind a React prop round-trip.
 *  - [L06] the floor is appearance state — written to the DOM
 *    (`style.minHeight`), never React state.
 *  - [L23] the cell holding its own height means the scroll layer sees
 *    no shrink, so scroll position is preserved by minimal mutation —
 *    no scroll-position write at all.
 *  - [L24] the subscription is structure, scoped (via `inFlight`) to the
 *    one cell that needs it; the floor it writes is appearance.
 *  - [L07] the observer reads live state through `getSnapshot()` and
 *    refs, never a stale closure.
 *
 * @module components/tugways/cards/dev-card-transcript-foot-reservation
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

/**
 * Whether the entry should be floored on this store notification. True
 * exactly on the dismissal edge: a dialog was present on the previous
 * notification and is gone now, with no floor held yet. The subscriber
 * fires on every dispatch, so the edge (not merely "no dialog now") is
 * what distinguishes a dismissal from ordinary streaming.
 *
 * Pure; exported for the test suite.
 */
export function shouldReserveOnDismiss(p: {
  wasDialogPresent: boolean;
  isDialogPresent: boolean;
  alreadyReserved: boolean;
}): boolean {
  return p.wasDialogPresent && !p.isDialogPresent && !p.alreadyReserved;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** The ref-setter the hosting cell attaches to its floor element. */
export interface FootReservationRefs {
  /** Attach to the element floored on dismissal. This must wrap the
   *  WHOLE cell entry — body AND the inflight footer (the thinking
   *  indicator) — so the reserved empty space lands below the footer
   *  and the footer's own height changes are absorbed within the floor
   *  (otherwise it would add height after dismissal and hop the view). */
  floorRef: (el: HTMLDivElement | null) => void;
}

/**
 * Manage the foot height-reservation floor for one assistant cell by
 * observing `store` directly. Subscribes only while `inFlight` (the one
 * cell that can host a foot dialog). Returns a stable ref-setter for the
 * floor element.
 */
export function useFootHeightReservation(
  store: CodeSessionStore,
  inFlight: boolean,
): FootReservationRefs {
  const floorElRef = useRef<HTMLDivElement | null>(null);
  /** Held floor in px, or 0 when no floor is reserved. */
  const reservedFloorRef = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const clearFloor = useCallback((): void => {
    const el = floorElRef.current;
    if (el !== null && reservedFloorRef.current > 0) {
      el.style.minHeight = "";
    }
    reservedFloorRef.current = 0;
  }, []);

  // [L22] — subscribe to the store directly; the floor write happens in
  // the synchronous notify callback (dialog still mounted), never via a
  // React render round-trip. [L24] — gated to the in-flight cell, the
  // only one that can host a foot dialog.
  useLayoutEffect(() => {
    if (!inFlight) return;
    let wasDialogPresent = false;
    const onStoreChange = (): void => {
      const floorEl = floorElRef.current;
      const snap = store.getSnapshot();
      const isDialogPresent =
        snap.pendingApproval !== null || snap.pendingQuestion !== null;
      if (
        floorEl !== null &&
        shouldReserveOnDismiss({
          wasDialogPresent,
          isDialogPresent,
          alreadyReserved: reservedFloorRef.current > 0,
        })
      ) {
        // The dialog is still in the DOM here — measure before React
        // unmounts it. No transition: the floor lands on the same frame
        // the dialog leaves, so the shrink never paints.
        const height = floorEl.offsetHeight;
        floorEl.style.minHeight = `${height}px`;
        reservedFloorRef.current = height;
      }
      wasDialogPresent = isDialogPresent;
    };
    const unsubscribe = store.subscribe(onStoreChange);
    return () => {
      unsubscribe();
      // Release on teardown (the turn committed, so `inFlight` flipped,
      // or the cell unmounted). The fill-release below has usually
      // cleared the floor long before this; this handles the tail where
      // the result never overtook it.
      clearFloor();
    };
  }, [store, inFlight, clearFloor]);

  // Disconnect the observer on unmount.
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  const floorRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    floorElRef.current = el;
    if (el === null) return;
    // `ResizeObserver` is absent in headless test environments; guard so
    // the cell still mounts (the reservation is a no-op there).
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const node = floorElRef.current;
      if (node === null) return;
      // Fill-release: once natural content overtakes the floor, the
      // floor is moot — clear it (no visual change; content holds the
      // height). The `+ 1` absorbs sub-pixel rounding.
      if (
        reservedFloorRef.current > 0 &&
        node.offsetHeight > reservedFloorRef.current + 1
      ) {
        node.style.minHeight = "";
        reservedFloorRef.current = 0;
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { floorRef };
}
