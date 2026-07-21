/**
 * session-card-transcript-foot-reservation — height reservation for the
 * streaming assistant cell's body foot.
 *
 * Two surfaces grow then shrink the in-flight assistant cell
 * (`AssistantTurnCell`): a `PermissionDialog` at the foot, and the
 * `AskUserQuestion` tool block in place (which the user can toggle between
 * its wizard and a chat-about reply, and which morphs a tall live wizard
 * into a short answered record). Any of those shrinks — a dialog unmount, a
 * chat-about ↔ wizard toggle, the answer morph — drops the cell's height in
 * a single frame, the scrollport's `scrollHeight` dips, the browser clamps
 * `scrollTop`, and the transcript jumps backward; the replacement content
 * streams in a beat later, so the net effect is a shrink-then-regrow hop.
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
 * DOM mutation *driven by external store state* (`pendingApproval`).
 * L22 forbids routing such a write through React's
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
 * @module components/tugways/cards/session-card-transcript-foot-reservation
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Presence source — what the hook observes
// ---------------------------------------------------------------------------

/**
 * The store the reservation observes, generalized ([P03]): a subscribe seam
 * plus a synchronous presence predicate. The permission/question foot dialog
 * reads `CodeSessionStore` (see {@link codeSessionDialogPresence}). The
 * predicate must be readable synchronously inside the store's notify callback
 * so the floor is written while the dismissing surface is still in the DOM
 * ([L22]).
 */
export interface DialogPresenceSource {
  subscribe: (listener: () => void) => () => void;
  isDialogPresent: () => boolean;
}

/**
 * The `CodeSessionStore` presence source: a permission dialog foots the cell
 * and a question lives in place at its tool block — either grows-then-shrinks
 * the in-flight cell, so both count as "present".
 */
export function codeSessionDialogPresence(
  store: CodeSessionStore,
): DialogPresenceSource {
  return {
    subscribe: store.subscribe,
    isDialogPresent: () => {
      const snap = store.getSnapshot();
      return snap.pendingApproval !== null || snap.pendingQuestion !== null;
    },
  };
}

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
 * Manage the foot height-reservation floor for one floored element by
 * observing `source` directly ([P03] — parameterized over the store +
 * presence predicate). Subscribes only while `inFlight` (the assistant cell
 * gates on being the in-flight last cell; the commit dialog's tail slot is
 * always live). Returns a stable ref-setter for the floor element.
 */
export function useFootHeightReservation(
  source: DialogPresenceSource,
  inFlight: boolean,
): FootReservationRefs {
  const floorElRef = useRef<HTMLDivElement | null>(null);
  /** Held floor in px, or 0 when no floor is reserved. */
  const reservedFloorRef = useRef(0);
  /** Whether a dialog / pending question is currently live (read by the
   *  ResizeObserver, which can't see the store directly). */
  const dialogPresentRef = useRef(false);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * Hold the cell at its tallest height by ratcheting a `min-height` floor UP
   * only. `offsetHeight` reads `max(natural, floor)`, so when the live surface
   * GROWS (a settling sizer, a typed reply) the floor follows; when it would
   * SHRINK (a chat-about ↔ wizard toggle, or the tall wizard morphing to the
   * short answered record) the floor holds and the shrink never paints — so
   * the scroll never hops. Released by the fill-release once the turn's
   * continuing content overtakes it. [L06] DOM write, not React state.
   */
  const ratchet = useCallback((): void => {
    const el = floorElRef.current;
    if (el === null) return;
    const h = el.offsetHeight;
    if (h > reservedFloorRef.current) {
      reservedFloorRef.current = h;
      el.style.minHeight = `${h}px`;
    }
  }, []);

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
    // Seed from the live source: a dialog may already be present when this
    // element mounts (a cold restore mid-question), so reserve at once.
    dialogPresentRef.current = source.isDialogPresent();
    if (dialogPresentRef.current) ratchet();
    let wasDialogPresent = dialogPresentRef.current;
      const onStoreChange = (): void => {
      const floorEl = floorElRef.current;
      // The observed surface grows then shrinks the floored element; hold it
      // at its tallest height across the whole interaction so neither a
      // sub-mode switch nor a dismissal hops the scroll.
      const isDialogPresent = source.isDialogPresent();
      dialogPresentRef.current = isDialogPresent;
      if (floorEl !== null && (isDialogPresent || wasDialogPresent)) {
        // Reserve continuously while present, and once more on the dismissal
        // edge (the surface is still in the DOM in this synchronous notify,
        // before React unmounts it) so the floor is in place before the shrink.
        ratchet();
      }
      wasDialogPresent = isDialogPresent;
    };
    const unsubscribe = source.subscribe(onStoreChange);
    return () => {
      unsubscribe();
      // Release on teardown (the turn committed, so `inFlight` flipped,
      // or the cell unmounted). The fill-release below has usually
      // cleared the floor long before this; this handles the tail where
      // the result never overtook it.
      clearFloor();
    };
  }, [source, inFlight, clearFloor, ratchet]);

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
      if (dialogPresentRef.current) {
        // While pending, the floor tracks the cell's tallest height (the live
        // surface settling / a typed reply growing). A chat-about ↔ wizard
        // toggle that would SHRINK the cell is absorbed: the floor holds, so
        // `offsetHeight` stays put and the scroll never hops.
        ratchet();
        return;
      }
      // Fill-release: after dismissal, once the turn's continuing content
      // overtakes the floor, the floor is moot — clear it (no visual change;
      // content holds the height). The `+ 1` absorbs sub-pixel rounding.
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
  }, [ratchet]);

  return { floorRef };
}
