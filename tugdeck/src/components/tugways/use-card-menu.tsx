/**
 * useCardMenu — declare a per-card title-bar menu.
 *
 * Cards call this hook to expose a menu (typically a settings sheet)
 * to the pane chrome's `…` button. The hook:
 *
 *   - Owns the underlying TugSheet via {@link useTugSheet}.
 *   - Registers a stable {@link CardMenuController} in the
 *     {@link cardMenuStore} so the pane's title bar can call
 *     `controller.toggle()` directly on click.
 *   - Writes the open / closed state back to the store as the sheet's
 *     lifecycle progresses, so the pane's button can paint the
 *     highlighted state via `useSyncExternalStore(...isOpen...)`.
 *
 * `renderSheet()` must be called once in the card's JSX so the sheet
 * has a portal target.
 *
 * Laws compliance:
 *  - [L02] state is exposed via the subscribable `cardMenuStore`,
 *    consumed by the pane via `useSyncExternalStore`.
 *  - [L03] register in `useLayoutEffect` so the controller is
 *    available before any user gesture can fire.
 *  - [L07] controller methods always read the latest options through
 *    refs — no stale closures.
 *  - [L24] structure-zone state — shared between pane chrome and
 *    card content via the store, never via prop drills or DOM
 *    queries.
 *
 * @module components/tugways/use-card-menu
 */

import React, { useLayoutEffect, useMemo, useRef } from "react";

import { useTugSheet } from "@/components/tugways/tug-sheet";
import {
  cardMenuStore,
  type CardMenuController,
} from "@/lib/card-menu-store";

export interface UseCardMenuOptions {
  /** Identifies the card in {@link cardMenuStore}. The pane uses the
   *  active card id to look up this controller. */
  cardId: string;
  /** Sheet title (passed straight through to {@link useTugSheet}). */
  title: string;
  /** Render the sheet body. `close` dismisses the sheet. */
  render: (close: () => void) => React.ReactNode;
  /** Optional override of the sheet's mount autofocus. */
  onOpenAutoFocus?: (event: Event) => void;
}

export interface UseCardMenuReturn {
  /** Render this once in the card's JSX so the sheet has a portal target. */
  renderSheet: () => React.ReactNode;
  /** The same controller registered in the store. Exposed for the
   *  consumer's own keyboard / chain-action handlers. */
  controller: CardMenuController;
}

export function useCardMenu(options: UseCardMenuOptions): UseCardMenuReturn {
  const { showSheet, renderSheet } = useTugSheet();

  // The store ([cardMenuStore](../../lib/card-menu-store.ts)) is the
  // single source of truth for "is the menu open?" — a structure-zone
  // value per [L24], shared between this hook (writer) and the pane's
  // title bar button (reader, via `useSyncExternalStore`). The hook
  // never tracks open state locally; reads come straight from the
  // store, writes happen synchronously at each transition.
  //
  // The refs below hold *function pointers and live-option captures*,
  // not state — `sheetCloseFnRef` caches the most recent close
  // callback so `controller.close()` can invoke it; `optionsRef` /
  // `showSheetRef` per [L07] keep the controller's closures
  // operating on the latest options without re-creating the stable
  // controller object on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const showSheetRef = useRef(showSheet);
  showSheetRef.current = showSheet;
  const sheetCloseFnRef = useRef<(() => void) | null>(null);

  // Stable controller. Object identity is constant for the hook's
  // life; method bodies read the store and the live refs, so every
  // invocation operates on current state. The store registers the
  // controller by reference — the pane button invokes these methods
  // regardless of when the consumer last re-rendered.
  const controller = useMemo<CardMenuController>(() => {
    const open = (): void => {
      const cardId = optionsRef.current.cardId;
      // Single source of truth: the store. If it says "open", we
      // either ARE open or are in the (synchronous) act of opening.
      // Either way, don't double-mount a second sheet.
      if (cardMenuStore.isOpen(cardId)) return;
      cardMenuStore.setOpen(cardId, true);
      void showSheetRef
        .current({
          title: optionsRef.current.title,
          content: (close) => {
            sheetCloseFnRef.current = close;
            return optionsRef.current.render(close);
          },
          onOpenAutoFocus: optionsRef.current.onOpenAutoFocus,
        })
        .finally(() => {
          // `.finally` is the catch-all for chain-driven dismissals
          // (Escape, Cmd-. — the sheet's own keymap dispatches
          // `cancel-dialog`, the hook's observer resolves the
          // promise, this finally fires). Explicit `close()` paths
          // already cleared the store + ref synchronously; this is
          // an idempotent re-clear for the Escape path. [L23] —
          // store state must always reflect the user-visible state.
          sheetCloseFnRef.current = null;
          cardMenuStore.setOpen(optionsRef.current.cardId, false);
        });
    };
    const close = (): void => {
      const cardId = optionsRef.current.cardId;
      // Clear the store SYNCHRONOUSLY before invoking the close
      // function. The store is the structural truth; updating it
      // first means any follow-up `toggle()` in the same tick reads
      // "closed" and opens a fresh sheet — not "closed twice" via
      // the cached (now-noop) close callback. [L24]
      if (!cardMenuStore.isOpen(cardId)) return;
      cardMenuStore.setOpen(cardId, false);
      const fn = sheetCloseFnRef.current;
      sheetCloseFnRef.current = null;
      fn?.();
    };
    const toggle = (): void => {
      // Read state from the store, never from `sheetCloseFnRef`.
      // The ref is a function pointer; the store is the truth. [L24]
      if (cardMenuStore.isOpen(optionsRef.current.cardId)) close();
      else open();
    };
    return { open, close, toggle };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty:
    // The controller closes over refs only; no value is captured at
    // memo-creation time that could go stale.
  }, []);

  // Register the controller in the store. [L03] useLayoutEffect so
  // the pane button finds the controller before any user gesture can
  // fire on the post-mount frame.
  useLayoutEffect(() => {
    return cardMenuStore.register(options.cardId, controller);
  }, [options.cardId, controller]);

  return { renderSheet, controller };
}
