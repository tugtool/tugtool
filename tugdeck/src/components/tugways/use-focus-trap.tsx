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

import React, { useCallback, useContext, useId, useLayoutEffect, useMemo, useRef } from "react";
import { FocusManagerContext, FocusModeContext } from "./focus-manager";
import { CardIdContext } from "@/lib/card-id-context";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { useExternalPointerdownObserver } from "./internal/external-dismiss-observer";

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
  /**
   * Set when the surface owns its own DOM-focus write at teardown (the returned
   * {@link UseFocusTrapResult.onCloseAutoFocus} wired to a Radix `Content` /
   * `FocusScope`, or a surface-specific writer like the sheet's
   * `handleUnmountAutoFocus`). The trap then pops `moveDomFocus: false` so the
   * engine's `popFocusMode` restores only the logical state (key view + first
   * responder) and does NOT also move DOM focus — the teardown writer is the
   * single DOM writer, at the moment the focus scope is gone. Leave unset for a
   * host-less surface (an inline dialog): the engine moves DOM focus in
   * `popFocusMode` as before.
   */
  deferDomFocusToTeardown?: boolean;
}

export interface UseFocusTrapResult {
  /** The generated, stable scope id for this trap's focus mode. */
  scopeId: string;
  /** Wrap the surface's content so its focusables join this trap's mode. */
  FocusModeScope: React.FC<{ children: React.ReactNode }>;
  /**
   * The surface's single close-focus DOM writer, wired to its Radix teardown slot
   * (`Popover.Content` `onCloseAutoFocus` / `FocusScope` `onUnmountAutoFocus`).
   * Three branches, in order: a `relinquish` close stands down (the engine's
   * `relinquishFocusMode` owns the landing); an external pointerdown during open
   * defers to Radix (the user clicked elsewhere); otherwise it re-projects the
   * engine's already-restored key view onto the DOM. Only meaningful when the
   * surface also sets `deferDomFocusToTeardown`.
   */
  onCloseAutoFocus: (event: Event) => void;
}

export function useFocusTrap({
  active,
  trapped = true,
  closeDisposition,
  deferDomFocusToTeardown,
}: UseFocusTrapOptions): UseFocusTrapResult {
  const manager = useContext(FocusManagerContext);
  // The "user clicked outside any popup" predicate ([D07] generalized): while the
  // surface is open, watch for a pointerdown outside the canvas overlay root, so
  // `onCloseAutoFocus` can defer to the clicked surface instead of restoring.
  const overlayRoot = useCanvasOverlay();
  const wasExternalRef = useExternalPointerdownObserver(active, overlayRoot);
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
        // When the surface owns its own teardown DOM write (`onCloseAutoFocus`),
        // pop logical state only — the engine must not also move DOM focus here
        // (the focus scope is still trapping, so it would land on `<body>`). A
        // host-less surface leaves `deferDomFocusToTeardown` unset and the engine
        // moves DOM focus as before.
        ctx.popFocusMode(scopeId, { moveDomFocus: !deferDomFocusToTeardown });
      }
    };
  }, [
    manager,
    cardId,
    active,
    scopeId,
    trapped,
    closeDisposition,
    deferDomFocusToTeardown,
  ]);

  // The surface's single close-focus DOM writer (see UseFocusTrapResult). Stable
  // identity so a consumer can pass it to Radix's `onCloseAutoFocus` without
  // identity churn ([L07]).
  const onCloseAutoFocus = useCallback(
    (event: Event): void => {
      // No engine in scope (standalone preview / test): leave Radix's default
      // close-focus path alone.
      if (manager === null) return;
      // A `relinquish` close: the engine's `relinquishFocusMode` (fired by the
      // trap's pop) is the sole authority for the landing — stand down so we do
      // not race it. `preventDefault` so Radix does not refocus the trigger.
      if (closeDisposition?.current === "relinquish") {
        event.preventDefault();
        return;
      }
      // The user dismissed by clicking some other surface: let that surface keep
      // focus (Radix's default), do not restore.
      if (wasExternalRef.current) return;
      // Otherwise re-project the engine's already-restored key view onto the DOM,
      // now that the focus scope has torn down and will not yank it to `<body>`.
      event.preventDefault();
      manager.focusKeyView();
    },
    [manager, closeDisposition, wasExternalRef],
  );

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
    () => ({ scopeId, FocusModeScope: scopeRef.current!, onCloseAutoFocus }),
    [scopeId, onCloseAutoFocus],
  );
}
