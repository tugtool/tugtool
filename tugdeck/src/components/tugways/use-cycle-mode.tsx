/**
 * useCycleMode — the keyboard-focus-cycling mode primitive a text-first card
 * opts into ([P09]/[P10] of the focus-language rollout).
 *
 * A text-first card's resting key view is its editor, which owns Tab
 * (completion / indent). Cycling mode frees Tab to circulate the card's chrome
 * zones instead: it pushes a **trapped** engine focus mode whose members are the
 * card's cycle stops, seeds the key view on the first stop (the commit-home, by
 * authored order), and — on toggle again or an explicit exit — pops the mode,
 * restoring the key view the engine captured when the mode was pushed (the
 * editor caret). Tab walks only the cycle stops while the mode is current and
 * wraps within them ([#cfrunloop-model] trapped mode + `advance`'s modular
 * wrap); the editor is in the base mode and is untouched until restore.
 *
 * This is the general mechanism (the dev card is the first consumer). It adds no
 * new engine projection — it drives the existing focus-mode stack
 * (`pushFocusMode` / `popFocusMode` / `focusFirstInMode` / `focusKeyView`), so
 * it is the [P04] behavior carve-out via [P09], appearance untouched.
 *
 * Wiring (the consumer's responsibilities):
 *   - register the toggle on a key-card responder for `CYCLE_FOCUS_MODE`
 *     (`{ [TUG_ACTIONS.CYCLE_FOCUS_MODE]: () => toggle() }`), so ⌥⇥ reaches it;
 *   - wrap the cycle-able zones in the returned `CycleScope` so their
 *     `useFocusable` callers register into this mode (they must also set a
 *     `focusGroup` to register at all);
 *   - order the stops so the **commit-home is the lowest `focusOrder`** — it is
 *     what `focusFirstInMode` seeds on entry ([P10]).
 *
 * Laws: [L02] `cycling` is derived from the engine via `useSyncExternalStore`
 *       (the focus-mode stack is the single source of truth — no parallel React
 *       state to desync); [L22] the mode is mutated imperatively on the manager;
 *       [L03] mount cleanup pops the mode in a layout effect; [L26] `CycleScope`
 *       holds a constant function identity so children never remount.
 *
 * @module components/tugways/use-cycle-mode
 */

import React, {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { FocusManagerContext, FocusModeContext } from "./focus-manager";

export interface UseCycleModeOptions {
  /**
   * Whether the card is eligible to cycle right now (e.g. a dev card only when
   * connected, not while the picker is up). When `false`, `toggle` is inert and
   * the mode is never pushed. Defaults to `true`.
   */
  enabled?: boolean;
}

export interface UseCycleModeResult {
  /** Whether cycling mode is currently active (this card's scope is on top). */
  cycling: boolean;
  /** Toggle cycling on/off — wire to the `CYCLE_FOCUS_MODE` (⌥⇥) action. */
  toggle: () => void;
  /** Exit cycling if active (caret returns to the editor) — wire to Escape. */
  exit: () => void;
  /** Wrap the card's cycle-able zones so they register into this mode. */
  CycleScope: React.FC<{ children: React.ReactNode }>;
  /** This card's stable cycle-scope id (for diagnostics / advanced wiring). */
  scopeId: string;
}

export function useCycleMode({
  enabled = true,
}: UseCycleModeOptions = {}): UseCycleModeResult {
  const manager = useContext(FocusManagerContext);
  // Stable per-card scope id. The cycle stops (rendered under `CycleScope`) and
  // the push/pop here agree on this one id.
  const scopeId = useId();

  // `cycling` is the engine's own state, read through `useSyncExternalStore`
  // ([L02]): the mode is "on" exactly when this card's scope is the current
  // (top) focus mode. No parallel React boolean — so a pop from any path (this
  // toggle, an exit, an unmount, a surface pushed on top) is reflected without
  // a chance to desync.
  const subscribe = useCallback(
    (onChange: () => void) => (manager === null ? () => {} : manager.subscribe(onChange)),
    [manager],
  );
  const getSnapshot = useCallback(
    () => (manager === null ? false : manager.currentFocusMode() === scopeId),
    [manager, scopeId],
  );
  const cycling = useSyncExternalStore(subscribe, getSnapshot);

  const enter = useCallback(() => {
    if (manager === null || !enabled) return;
    // Push captures the current key view (the editor caret) for restore on pop.
    manager.pushFocusMode(scopeId, { trapped: true });
    // Seed the commit-home — the lowest-order cycle stop ([P10]) — and paint the
    // keyboard ring on it.
    manager.focusFirstInMode();
    manager.focusKeyView();
  }, [manager, enabled, scopeId]);

  const exit = useCallback(() => {
    if (manager === null) return;
    if (manager.currentFocusMode() !== scopeId) return;
    // Pop restores the captured prior key view (the editor); land DOM focus on
    // it so the caret returns.
    manager.popFocusMode(scopeId);
    manager.focusKeyView();
  }, [manager, scopeId]);

  const toggle = useCallback(() => {
    if (manager === null) return;
    if (manager.currentFocusMode() === scopeId) exit();
    else enter();
  }, [manager, scopeId, enter, exit]);

  // Safety: a card unmounting (or its eligibility dropping) while cycling must
  // not leave its scope stranded on the mode stack. Pop on unmount ([L03]).
  useLayoutEffect(() => {
    return () => {
      manager?.popFocusMode(scopeId);
    };
  }, [manager, scopeId]);

  // Stable scope component (constant identity across renders so children never
  // remount, [L26]). It always provides the scope id; the cycle stops register
  // into this mode via their `useFocusable` reading `FocusModeContext`.
  const scopeRef = useRef<React.FC<{ children: React.ReactNode }> | null>(null);
  if (scopeRef.current === null) {
    const id = scopeId;
    scopeRef.current = function CycleScope({
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
    () => ({ cycling, toggle, exit, CycleScope: scopeRef.current!, scopeId }),
    [cycling, toggle, exit, scopeId],
  );
}
