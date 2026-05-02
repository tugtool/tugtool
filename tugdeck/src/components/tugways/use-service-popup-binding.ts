/**
 * useServicePopupBinding — close-focus restoration for service-role popups.
 *
 * Per `tugplan-tide-popup-bindings.md` [D06] / [D07] (#service-binding):
 * service popups (`TugPopupMenu`, `TugPopover`, `TugConfirmPopover`,
 * `TugContextMenu`, `tug-editor-context-menu`) take focus while open
 * via Radix's `FocusScope`. When such a popup closes, focus must
 * return to whichever responder owned it before the popup opened —
 * unless the user clicked outside any popup, in which case Radix's
 * default close-focus path runs and the user's chosen surface keeps
 * focus.
 *
 * The hook returns `{ captureOnOpen, onCloseAutoFocus }`. Consumers:
 *
 *   1. Call `captureOnOpen()` from their `onOpenChange(next)` handler
 *      when `next === true` — captures the current first-responder id
 *      and starts watching for an external pointerdown.
 *   2. Pass `onCloseAutoFocus` directly to Radix's `<Content
 *      onCloseAutoFocus>` prop. The hook decides whether to restore.
 *
 * ## Predicate ([D07])
 *
 * Restore prior responder iff: (a) something was captured at open, AND
 * (b) the chain manager is still in scope, AND (c) no external
 * pointerdown was observed during the open lifetime, AND (d) chain has
 * an active first responder.
 *
 * "External" = pointerdown target is NOT a descendant of the canvas
 * overlay root. Every popup-class primitive lives in the overlay root
 * post-[D01], so any click on any popup is "internal" — including a
 * click on a sibling popup that the current one cascades-closes from.
 * Sheet content is also "internal" post-[D02], which is correct: closing
 * a service popup by clicking on the surrounding sheet should NOT
 * restore prior responder (the user's intent is to keep working in the
 * sheet, not return to the editor below).
 *
 * ## Imperative install / uninstall ([D07])
 *
 * The pointerdown listener is installed imperatively in `captureOnOpen`
 * and removed imperatively in `onCloseAutoFocus`. We do NOT key a
 * `useLayoutEffect` on `capturedRef.current` — refs don't trigger
 * re-renders, the effect would not re-run, and "fixing" that by
 * mirroring `captured` into `useState` would inject React-render
 * machinery into pure subscription state ([L02] forbids "useState +
 * manual sync" of external state). The listener is structure-zone
 * state ([L24]); imperative install/uninstall keyed off the lifecycle
 * calls is the correct shape.
 *
 * A guard `useLayoutEffect` cleanup ([L03]) removes the listener if
 * the consumer component unmounts while a popup is still open — e.g.,
 * the gallery card unmounts mid-popup. Without this guard, the
 * listener would leak past the consumer's lifetime.
 *
 * ## TugButton trigger discipline (correctness invariant)
 *
 * The hook's correctness depends on `manager.getFirstResponder()` at
 * `captureOnOpen()` time returning the *editor's* responder id, not
 * the trigger button's. This is satisfied by the existing `TugButton`
 * discipline: `data-tug-focus="refuse"` causes
 * `pane-focus-controller` to skip responder-chain promotion when the
 * click targets a `TugButton`, and `suppressButtonFocusShift` calls
 * `e.preventDefault()` on `mousedown` to skip native browser focus
 * shift. Together they keep first responder pinned to the editor
 * across the trigger click. If that discipline regresses, the
 * service binding restores focus to the wrong place; Step 5's unit
 * tests pin the invariant.
 *
 * ## Risk R02: consumer override path
 *
 * The hook owns `onCloseAutoFocus`. A consumer who needs custom
 * close-focus behavior should NOT stack their own `onCloseAutoFocus`
 * on top — Radix only carries one. Instead, call
 * `manager.focusResponder(targetId)` directly from the menu-item
 * handler before the menu closes. The order of operations:
 *
 *   1. Menu-item handler runs (consumer dispatches and optionally
 *      calls `manager.focusResponder(target)` to redirect focus).
 *   2. Blink animation completes.
 *   3. Radix unmounts content; `onCloseAutoFocus` runs.
 *   4. If the consumer redirected focus to a non-prior responder,
 *      DOM focus is now on the chosen target; the binding's
 *      external-click predicate would NOT have fired (there was no
 *      external pointerdown), so the binding still tries to restore.
 *      The captured responder is no longer the one the consumer
 *      wants focused.
 *
 * In practice no consumer of `TugPopupMenu` / `TugPopover` /
 * `TugContextMenu` overrides close-focus today (`rg "onCloseAutoFocus"
 * tugdeck/src/` returns zero hits), so the contract above is
 * documentary. If a consumer surfaces, defer a `skipRestore()` opt-out
 * to a follow-up.
 *
 * ## Tuglaws
 *
 * - **[L02]** — chain state is external state; we read it via
 *   `manager.getFirstResponder()` and never mirror into React state.
 * - **[L03]** — guard `useLayoutEffect` runs the cleanup before any
 *   paint after the consumer's unmount, ensuring listener removal
 *   happens deterministically even if the consumer unmounts while a
 *   popup is still open.
 * - **[L07]** — `captureOnOpen` and `onCloseAutoFocus` are
 *   `useCallback`-wrapped over stable refs; consumers can pass these
 *   into Radix Content props without identity churn.
 * - **[L19]** — module docstring documents the contract, the
 *   predicate, the trigger discipline invariant, and Risk R02.
 * - **[L22]** — pointerdown is observed via direct DOM listener on
 *   the document — the structure-zone equivalent of a store-observer
 *   API; no React render cycle is interposed.
 * - **[L24]** — three refs (`capturedRef`, `externalClickRef`,
 *   `listenerRef`) are all structure zone. No `useState`.
 *
 * @module components/tugways/use-service-popup-binding
 */

import { useCallback, useLayoutEffect, useRef } from "react";

import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { useResponderChain } from "./responder-chain-provider";

/**
 * Return type of `useServicePopupBinding`.
 *
 * Consumers thread `captureOnOpen` into their `onOpenChange(next)`
 * handler (called when `next === true`) and pass `onCloseAutoFocus`
 * directly to Radix's `<Content onCloseAutoFocus>` prop.
 */
export interface ServicePopupBinding {
  /**
   * Snapshot the current first responder and start watching for an
   * external pointerdown. Idempotent: if called twice without an
   * intervening close, the second call replaces the captured value
   * and reinstalls the listener (defensive — Radix may emit duplicate
   * `onOpenChange(true)` calls under StrictMode double-mount).
   */
  captureOnOpen: () => void;
  /**
   * Decide whether to restore the captured prior responder. Pass
   * directly to Radix's `<Content onCloseAutoFocus>` prop. Calls
   * `event.preventDefault()` only when restoring; otherwise lets
   * Radix's default close-focus path run.
   */
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * Bind close-focus restoration for a service-role popup primitive.
 *
 * See module docstring for the full contract, predicate, trigger
 * discipline invariant, Risk R02 path, and tuglaws compliance.
 *
 * Tolerant of the no-provider case: if `useResponderChain()` returns
 * null (consumer rendered outside `<ResponderChainProvider>` — e.g.,
 * a standalone preview, a unit test that doesn't mount a provider),
 * `captureOnOpen` is a no-op and `onCloseAutoFocus` lets Radix's
 * default close-focus path run.
 */
export function useServicePopupBinding(): ServicePopupBinding {
  const manager = useResponderChain();
  const overlayRoot = useCanvasOverlay();

  // [L24] structure zone: all subscription state held in refs.
  // capturedRef holds the first-responder id snapshotted at open.
  // externalClickRef flags whether an external pointerdown was
  // observed during the open lifetime. listenerRef holds the
  // installed handler so we can remove it later.
  const capturedRef = useRef<string | null>(null);
  const externalClickRef = useRef<boolean>(false);
  const listenerRef = useRef<((e: PointerEvent) => void) | null>(null);

  // overlayRoot is read at use-time (not closure-captured at render
  // time) so a registry change between open and close still routes
  // through the current root. Captured into a ref so the listener
  // closure reads the latest root without re-installing.
  const overlayRootRef = useRef(overlayRoot);
  overlayRootRef.current = overlayRoot;

  const captureOnOpen = useCallback((): void => {
    if (!manager) return;
    if (typeof document === "undefined") return;

    // Snapshot the captured prior responder. May be null if no chain
    // node has claimed first-responder yet — that's still recorded;
    // the close path will skip restore on null and fall through to
    // Radix's default.
    capturedRef.current = manager.getFirstResponder();
    externalClickRef.current = false;

    // Idempotency: if a previous open didn't tear down its listener
    // (StrictMode double-mount, an interrupted close cascade), remove
    // it before installing a new one. Defensive — a leak here would
    // be invisible until the next pointerdown.
    if (listenerRef.current !== null) {
      document.removeEventListener(
        "pointerdown",
        listenerRef.current,
        { capture: true },
      );
      listenerRef.current = null;
    }

    // The listener flips externalClickRef when the pointerdown's
    // target is NOT inside the canvas overlay root. Capture phase so
    // we observe the click before any popup-internal handler may
    // call stopPropagation. Reads `overlayRootRef.current` at event
    // time so a re-registered overlay root mid-open is honored.
    const listener = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const root = overlayRootRef.current;
      if (!root.contains(target)) {
        externalClickRef.current = true;
      }
    };
    document.addEventListener("pointerdown", listener, { capture: true });
    listenerRef.current = listener;
  }, [manager]);

  const onCloseAutoFocus = useCallback((event: Event): void => {
    if (typeof document === "undefined") return;

    // Remove the listener BEFORE evaluating the predicate. Defensive
    // ordering: if Radix's close cascade synthesized a pointerdown
    // (it doesn't today, but the future is long), the listener could
    // flip the flag mid-evaluation and corrupt the decision.
    // Removing first eliminates the race entirely.
    if (listenerRef.current !== null) {
      document.removeEventListener(
        "pointerdown",
        listenerRef.current,
        { capture: true },
      );
      listenerRef.current = null;
    }

    const captured = capturedRef.current;
    capturedRef.current = null;
    const externalClick = externalClickRef.current;
    externalClickRef.current = false;

    // Restore predicate: every condition must hold for the binding
    // to take ownership of close-focus. If any short-circuits, fall
    // through to Radix's default (focus the trigger).
    if (!manager) return;
    if (captured === null) return;
    if (externalClick) return;
    if (manager.getFirstResponder() === null) return;

    event.preventDefault();
    manager.focusResponder(captured);
  }, [manager]);

  // [L03] guard: if the consumer component unmounts while a popup is
  // still open (e.g., the owning gallery card unmounts mid-popup),
  // remove the listener so it does not leak past the consumer's
  // lifetime. The empty dep array means the cleanup runs at unmount;
  // listenerRef.current is checked because in the steady-state
  // (popup never opened, popup already closed) it is null and the
  // cleanup is a no-op.
  useLayoutEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      if (listenerRef.current !== null) {
        document.removeEventListener(
          "pointerdown",
          listenerRef.current,
          { capture: true },
        );
        listenerRef.current = null;
      }
    };
  }, []);

  return { captureOnOpen, onCloseAutoFocus };
}
