/**
 * useFocusTrap -- push a CFRunLoop-style focus mode while a floating surface is
 * open, and restore the prior key view when it closes.
 *
 * A floating surface (sheet, alert, popover, menu) calls this and wraps its
 * content in the returned `FocusModeScope`. While `active`, a trapped focus
 * mode is current: the Tab walk services only focusables registered in this
 * mode ([#cfrunloop-model]), so Tab cycles within the surface; on close the
 * FocusManager restores the key view that was current when the mode was pushed.
 * Descendant `useFocusable` callers read the scope id from `FocusModeContext`
 * (provided by `FocusModeScope`) and register into this mode automatically.
 *
 * This is the engine-side trap. It is additive to a surface's existing Radix
 * `FocusScope` (which traps DOM focus) — the taming steps later remove Radix
 * per surface and let this be the sole trap. Until then the two coexist: with
 * no focusables registered in the mode yet, the engine Tab walk falls through
 * to native Tab, which Radix traps; the engine mode contributes the scope id,
 * the `data-focus-mode` projection, and key-view restore.
 *
 * Registration rides `useLayoutEffect` ([L03]) so the mode is pushed before any
 * keyboard handler that walks it can fire. Tolerant of no provider (the hook
 * no-ops outside a `FocusManagerProvider`, like `useOptionalResponder`).
 */

import React, { useContext, useId, useLayoutEffect, useMemo, useRef } from "react";
import { FocusManagerContext, FocusModeContext } from "./focus-manager";
import { CardIdContext } from "@/lib/card-id-context";

export interface UseFocusTrapOptions {
  /**
   * Whether the trap is currently active (the surface is open). The mode is
   * pushed while `true` and popped when it goes `false` or the component
   * unmounts — so surfaces with an exit animation (`open` flips before the
   * portal unmounts) release focus promptly on close.
   */
  active: boolean;
  /**
   * Every pushed mode contains the Tab walk to its own focusables; `trapped`
   * selects only the Escape semantics — `true` (default) dismisses on Escape
   * (modal surfaces), `false` ascends one level (a descend scope). Floating
   * surfaces trap; leave the default.
   */
  trapped?: boolean;
  /**
   * Close disposition toward an enclosing focus cycle, read at pop time ([P15]
   * generalized). `"retain"` (default / absent) pops normally — restore the stop
   * the surface was opened from, leaving any enclosing cycle intact. `"relinquish"`
   * cascade-pops this surface AND its enclosing cycle, landing on the cycle's
   * resting destination ({@link FocusContext.relinquishFocusMode}). A ref so a
   * surface can set the disposition on commit just before it closes, without
   * re-running the push/pop effect. No-op (ordinary pop) when there is no
   * enclosing cycle.
   */
  closeDisposition?: React.RefObject<"retain" | "relinquish">;
}

export interface UseFocusTrapResult {
  /** The generated, stable scope id for this trap's focus mode. */
  scopeId: string;
  /** Wrap the surface's content so its focusables join this trap's mode. */
  FocusModeScope: React.FC<{ children: React.ReactNode }>;
}

export function useFocusTrap({
  active,
  trapped = true,
  closeDisposition,
}: UseFocusTrapOptions): UseFocusTrapResult {
  const manager = useContext(FocusManagerContext);
  // The owning card ([P21]): the trap is pushed onto THIS card's focus context,
  // so a surface opened from a card (sheet / inline dialog, even one that mounts
  // while its card is in the background) keeps its trap in the card's own
  // universe — preserved across card switches, never the active card's mode.
  // `null` outside a card host routes to the default / active context.
  const cardId = useContext(CardIdContext);
  // Stable per-instance scope id. `useId` is stable across renders, so the
  // pushed mode and the focusables that register into it agree on one id.
  const scopeId = useId();

  // Push while active; pop on deactivate / unmount. The card's FocusContext
  // captures the key view at push and restores it at pop ([#cfrunloop-model]).
  useLayoutEffect(() => {
    if (manager === null || !active) return;
    const ctx = manager.contextFor(cardId);
    ctx.pushFocusMode(scopeId, { trapped });
    return () => {
      // The disposition is read at pop time (it is set on commit, just before the
      // surface closes). `relinquish` cascade-pops the enclosing cycle; `retain`
      // (default) restores the stop the surface was opened from.
      if (closeDisposition?.current === "relinquish") {
        ctx.relinquishFocusMode(scopeId);
      } else {
        ctx.popFocusMode(scopeId);
      }
    };
  }, [manager, cardId, active, scopeId, trapped, closeDisposition]);

  // Stable scope component (held in a ref so it keeps a constant function
  // identity across renders — children never remount, [L26]). It always
  // provides the scope id; descendants only render while the surface is open,
  // so a focusable can never register into a mode that is not pushed.
  const scopeRef = useRef<React.FC<{ children: React.ReactNode }> | null>(null);
  if (scopeRef.current === null) {
    const id = scopeId;
    scopeRef.current = function FocusModeScope({
      children,
    }: {
      children: React.ReactNode;
    }) {
      return (
        <FocusModeContext.Provider value={id}>
          {children}
        </FocusModeContext.Provider>
      );
    };
  }

  return useMemo(
    () => ({ scopeId, FocusModeScope: scopeRef.current! }),
    [scopeId],
  );
}
