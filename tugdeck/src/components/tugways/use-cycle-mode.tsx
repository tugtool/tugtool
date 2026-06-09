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
import type { CycleDisposition, FocusCommit } from "./focus-manager";
import { CardIdContext } from "@/lib/card-id-context";

/**
 * The toggleable-cycling default disposition ([P15]): a keyboard value commit at
 * a stop (`select` / `act` on an item-group) returns the keyboard to the editor
 * (relinquish); `descend` keeps cycling (you went deeper, not done). Leaf acts
 * (chips / Z2 cells that open a popover) go native and never reach this path, so
 * they retain by construction. A persistent context (`useFocusTrap`) injects no
 * disposition at all, so it retains — the derivation from the [P13] type.
 */
function toggleableCommitDisposition(commit: FocusCommit): CycleDisposition {
  return commit.kind === "select" || commit.kind === "act"
    ? "relinquish"
    : "retain";
}

export interface UseCycleModeOptions {
  /**
   * Whether the card is eligible to cycle right now (e.g. a dev card only when
   * connected, not while the picker is up). When `false`, `toggle` is inert and
   * the mode is never pushed. Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * Optional per-context override for the cycle commit disposition ([P15]).
   * Omit to inherit the toggleable default (a `select`/`act` value-commit
   * relinquishes the cycle back to the editor; `descend` retains). Provide a
   * function to decide per-stop / per-commit — e.g. keep cycling after a
   * particular stop commits. Returns `"retain"` or `"relinquish"`.
   */
  dispositionAfterCommit?: (commit: FocusCommit) => CycleDisposition;
  /**
   * Land the resting caret when the cycle is relinquished — the card's resting
   * focus destination (a dev card's prompt entry). Called when `cycling` flips
   * false by any non-pointer path: ⌥⇥ toggle-off, the editor text-stop's
   * Return-descend, or a sub-surface commit that relinquishes the cycle ([P15] —
   * {@link FocusContext.relinquishFocusMode}). Skipped on a mouse exit (the click
   * places focus itself). This makes the relinquish landing a first-class part of
   * the cycle, not bespoke per-card glue. Runs in a layout effect after the
   * cycle's zones reactivate ([L04]).
   */
  restingFocus?: () => void;
}

export interface UseCycleModeResult {
  /** Whether cycling mode is currently active (this card's scope is on top). */
  cycling: boolean;
  /** Toggle cycling on/off — wire to the `CYCLE_FOCUS_MODE` (⌥⇥) action. */
  toggle: () => void;
  /**
   * Exit cycling if active (caret returns to the editor). Currently reached via
   * the editor text-stop's Return-descend; a dedicated Escape binding is left to
   * the mode-keys work. Today's other exits are the ⌥⇥ `toggle` and the
   * mouse-exit rule below.
   */
  exit: () => void;
  /** Wrap the card's cycle-able zones so they register into this mode. */
  CycleScope: React.FC<{ children: React.ReactNode }>;
  /** This card's stable cycle-scope id (for diagnostics / advanced wiring). */
  scopeId: string;
}

export function useCycleMode({
  enabled = true,
  dispositionAfterCommit,
  restingFocus,
}: UseCycleModeOptions = {}): UseCycleModeResult {
  const manager = useContext(FocusManagerContext);
  // The owning card ([P21]): the cycle mode is pushed onto, and read back from,
  // THIS card's focus context — so the `cycling` snapshot stays correct even
  // after the card is switched to the background (its cycle is preserved in its
  // own universe; the active card's mode never bleeds in). `null` outside a card
  // host routes to the default / active context.
  const cardId = useContext(CardIdContext);
  const ctx = useMemo(
    () => (manager === null ? null : manager.contextFor(cardId)),
    [manager, cardId],
  );
  // Stable per-card scope id. The cycle stops (rendered under `CycleScope`) and
  // the push/pop here agree on this one id.
  const scopeId = useId();
  // Set true by the mouse-exit listener so the resting-focus reclaim skips a
  // pointer-driven exit (the click places focus itself); read-and-cleared by the
  // relinquish effect above. Structure-zone ref, no React state ([L24]).
  const exitViaPointerRef = useRef(false);

  // Latest commit-disposition override, read at commit time via a stable wrapper
  // so an inline `dispositionAfterCommit` never re-installs the pushed mode or
  // churns the `toggle`/`enter` identities ([L24] structure-zone ref).
  const dispositionRef = useRef(dispositionAfterCommit);
  dispositionRef.current = dispositionAfterCommit;
  const commitDispositionRef = useRef<(commit: FocusCommit) => CycleDisposition>(
    (commit) => (dispositionRef.current ?? toggleableCommitDisposition)(commit),
  );

  // Latest resting-focus reclaim, read live by the relinquish effect ([L07]).
  const restingFocusRef = useRef(restingFocus);
  restingFocusRef.current = restingFocus;

  // `cycling` is the engine's own state, read through `useSyncExternalStore`
  // ([L02]): the mode is "on" exactly when this card's scope is **on the mode
  // stack** — current, OR merely covered by a transient mode pushed on top of
  // it (a popover / sheet opened from within the cycle). Using stack-membership
  // (not top-of-stack) is deliberate: opening a nested surface from a cycle stop
  // must NOT read as "exited cycling" — otherwise the consumer would tear down
  // its cycling treatment (and, e.g., yank the caret back to its editor) the
  // instant a status-cell popover opens, then be stranded when it closes. The
  // toggle/exit guards below still use top-of-stack (`currentFocusMode`); only
  // this "am I still cycling?" snapshot is stack-membership. No parallel React
  // boolean — so a pop from any path (toggle, exit, unmount, a covering surface
  // closing) is reflected without a chance to desync.
  const subscribe = useCallback(
    (onChange: () => void) => (manager === null ? () => {} : manager.subscribe(onChange)),
    [manager],
  );
  const getSnapshot = useCallback(
    () => (ctx === null ? false : ctx.isFocusModePushed(scopeId)),
    [ctx, scopeId],
  );
  const cycling = useSyncExternalStore(subscribe, getSnapshot);

  // Land the resting caret when the cycle is relinquished. This fires off the
  // engine-owned `cycling` transition (true → false) by ANY non-pointer path —
  // ⌥⇥ toggle-off, the editor text-stop's Return-descend, or a sub-surface commit
  // that relinquished the cycle ([P15]). Because it rides the engine's own state
  // flip, the cycle owns its resting landing as one transition (no card-side
  // race); running in a layout effect, it fires after the cycle's zones (the
  // prompt editor) reactivate, so the caret lands ([L03]/[L04]). Skipped on a
  // mouse exit — the click that ended the cycle places focus itself.
  const prevCyclingRef = useRef(false);
  useLayoutEffect(() => {
    if (prevCyclingRef.current && !cycling) {
      if (!exitViaPointerRef.current) restingFocusRef.current?.();
      exitViaPointerRef.current = false;
    }
    prevCyclingRef.current = cycling;
  }, [cycling]);

  const enter = useCallback(() => {
    if (ctx === null || !enabled) return;
    // Push captures the current key view (the editor caret) for restore on pop.
    // The mode carries the toggleable commit disposition ([P15]) — a stable
    // wrapper reading the latest override (or the toggleable default).
    ctx.pushFocusMode(scopeId, {
      trapped: true,
      commitDisposition: (commit) => commitDispositionRef.current(commit),
    });
    // Seed the commit-home — the lowest-order cycle stop ([P10]) — and paint the
    // keyboard ring on it.
    ctx.focusFirstInMode();
    ctx.focusKeyView();
  }, [ctx, enabled, scopeId]);

  const exit = useCallback(() => {
    if (ctx === null) return;
    if (ctx.currentFocusMode() !== scopeId) return;
    // Pop restores the captured prior key view (the editor); land DOM focus on
    // it so the caret returns.
    ctx.popFocusMode(scopeId);
    ctx.focusKeyView();
  }, [ctx, scopeId]);

  const toggle = useCallback(() => {
    if (ctx === null) return;
    if (ctx.currentFocusMode() === scopeId) exit();
    else enter();
  }, [ctx, scopeId, enter, exit]);

  // Comprehensive rule for toggleable focus-cycling: **using the mouse exits
  // cycling.** Cycling is a keyboard mode; the moment the user reaches for the
  // pointer they have left keyboard navigation, so the cycle ends and the
  // resting key view (the editor caret) returns. Implemented as a capture-phase
  // `pointerdown` while cycling — but only when this card's cycle scope is the
  // CURRENT (top) mode: a pointerdown inside a nested surface (a sheet / popover
  // opened from a cycle stop) leaves cycling intact, so that surface's close can
  // return focus to the originating stop ([engine-owns close-focus]). Exiting on
  // the pointerdown (before the click's default) means a mouse-opened sheet then
  // opens un-cycled and restores the editor caret on close, while a
  // keyboard-opened one (cycle still current at open) returns to its stop. [L03]
  useLayoutEffect(() => {
    if (ctx === null || !cycling) return;
    const onPointerDown = (): void => {
      if (ctx.currentFocusMode() === scopeId) {
        exitViaPointerRef.current = true;
        // Pop WITHOUT restoring focus: the click that triggered this exit owns
        // the next focus (it opens a Z2/Z4B surface, or lands the caret where
        // clicked). Restoring focus to the resting editor here would flash its
        // caret for a frame before the click's own focus lands. The
        // `restingFocus` reclaim is likewise skipped on this pointer exit (via
        // `exitViaPointerRef`).
        ctx.popFocusMode(scopeId, { restoreFocus: false });
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
  }, [ctx, cycling, scopeId]);

  // Safety: a card unmounting (or its eligibility dropping) while cycling must
  // not leave its scope stranded on its context's mode stack. Pop on unmount
  // ([L03]) — routed to the card's own context so it pops the right stack even
  // if the card is no longer the key card.
  useLayoutEffect(() => {
    return () => {
      ctx?.popFocusMode(scopeId);
    };
  }, [ctx, scopeId]);

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
    () => ({
      cycling,
      toggle,
      exit,
      CycleScope: scopeRef.current!,
      scopeId,
    }),
    [cycling, toggle, exit, scopeId],
  );
}
