/**
 * useKeybindings -- register dynamic, context-scoped keyboard bindings ([P11]).
 *
 * A component declares chord→action bindings that are live **only while its
 * scope is in context**: on the first-responder `parentId` walk (responder-
 * scoped, the default) or while a floating surface's focus mode is current
 * (mode-local, `{ mode: true }`). The capture-phase Stage 1 resolves these
 * before the static global `KEYBINDINGS` map, innermost-first — the keyboard
 * analog of the responder chain's action walk (Cocoa's `performKeyEquivalent:`).
 *
 * Entries cite `TUG_ACTIONS.*` constants and carry the same `KeyBinding` shape
 * as the static map (`scope` still selects *dispatch routing* —
 * `first-responder` vs `key-card` — orthogonally to *activation context*). The
 * matched action dispatches through the chain exactly as a static binding does.
 *
 * Bindings are read live at resolve time (the source closure returns the
 * current render's array), so handler/chord changes flow through without
 * re-registering — the same live-read discipline `useResponder` uses. The
 * registration itself rides `useLayoutEffect` ([L03]) so a binding is live
 * before any keydown can fire, and unregisters on unmount. Tolerant of no
 * provider / no scope: a no-op (like `useOptionalResponder`, [L26]).
 *
 * - **Responder-scoped (default):** registered under the nearest
 *   `ResponderParentContext` id; live while that responder is on the
 *   first-responder walk.
 * - **Mode-local (`{ mode: true }`):** registered under the surrounding
 *   `FocusModeContext` id (a surface's pushed mode, via `useFocusTrap`); live
 *   only while that mode is current, and gone when the surface closes ([P03]).
 *   Intended for floating surfaces — at the base mode it is inert.
 */

import { useContext, useLayoutEffect, useRef } from "react";
import { ResponderChainContext, ResponderParentContext } from "./responder-chain";
import { FocusModeContext } from "./focus-manager";
import type { KeyBinding } from "./keybinding-map";

export interface UseKeybindingsOptions {
  /**
   * Register the bindings into the surrounding focus mode (a surface's pushed
   * mode) instead of the responder scope. The bindings are live only while that
   * mode is current. Default `false` (responder-scoped).
   */
  mode?: boolean;
}

export function useKeybindings(
  bindings: readonly KeyBinding[],
  options?: UseKeybindingsOptions,
): void {
  const manager = useContext(ResponderChainContext);
  const responderScope = useContext(ResponderParentContext);
  const focusMode = useContext(FocusModeContext);
  const scopeId = options?.mode ? focusMode : responderScope;

  // Live source: resolution reads the current render's bindings without the
  // hook re-registering on every render. Mirrors `useResponder`'s actions proxy.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useLayoutEffect(() => {
    if (manager === null || scopeId === null) return;
    return manager.registerKeybinding(scopeId, () => bindingsRef.current);
  }, [manager, scopeId]);
}
