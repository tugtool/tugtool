/**
 * TugcardPersistenceContext and useTugcardPersistence hook.
 *
 * Provides the opt-in card content state persistence mechanism for Tugcard.
 *
 * Card content components call `useTugcardPersistence({ onSave, onRestore })`
 * to register save/restore callbacks with their enclosing Tugcard. Tugcard
 * calls `onSave` on tab deactivation and `onRestore` on tab activation, using
 * the DeckManager tab state cache as the durable backing store.
 *
 * **Authoritative references:** [D01] onContentReady callback, [D02] Persistence
 * hook, [D03] restorePendingRef, Spec S04, Spec S05, Rule 11, Rule 12
 * (#s04-persistence-context, #s05-persistence-hook, #d02-persistence-hook,
 * #d01-on-content-ready, #d03-restore-pending-ref)
 */

import React, { createContext, useContext, useLayoutEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options accepted by useTugcardPersistence.
 *
 * Generic over T so card content components get type-safe onRestore.
 * Internally stored as TugcardPersistenceCallbacks (erased to unknown)
 * so Tugcard can treat the content payload as opaque JSON.
 *
 * Spec S05 ([D02])
 */
export interface UseTugcardPersistenceOptions<T> {
  /** Called by Tugcard on tab deactivation. Must return JSON-serializable state. */
  onSave: () => T;
  /** Called by Tugcard on tab activation with the previously saved state. */
  onRestore: (state: T) => void;
}

// ---------------------------------------------------------------------------
// TugcardPersistenceCallbacks
// ---------------------------------------------------------------------------

/**
 * Save/restore callback pair registered by card content components via
 * `useTugcardPersistence`. Tugcard calls these on tab deactivation/activation.
 *
 * - `onSave()` is called on deactivation. Returns opaque JSON-serializable state.
 * - `onRestore(state)` is called on activation with the previously saved state.
 * - `onContentReady` is written by Tugcard into this object before calling
 *   `onRestore`. The hook's no-deps `useLayoutEffect` fires it after the child's
 *   DOM commits (Rule 11, Rule 12, [D78], [D79]).
 * - `restorePendingRef` is created by the hook and included here so Tugcard can
 *   set it to `true` before calling `onRestore`, signaling that a restore is in
 *   flight. The hook's no-deps `useLayoutEffect` reads this flag. ([D03])
 *
 * Spec S04 ([D02], [D01], [D03])
 */
export interface TugcardPersistenceCallbacks {
  onSave: () => unknown;
  onRestore: (state: unknown) => void;
  /**
   * Written by Tugcard before calling `onRestore`. Fired by the hook's
   * no-deps `useLayoutEffect` after the child's DOM commits. Optional because
   * existing card content that doesn't need ready signaling is unaffected.
   *
   * Rule 11, Rule 12, [D78], [D79], [D01]
   */
  onContentReady?: () => void;
  /**
   * Ref created by the hook, set to `true` by Tugcard before calling
   * `onRestore`. Read by the hook's no-deps `useLayoutEffect`. Shared via this
   * callbacks object so no new context or side channel is needed. ([D03])
   */
  restorePendingRef?: React.RefObject<boolean>;
}

// ---------------------------------------------------------------------------
// TugcardPersistenceContext
// ---------------------------------------------------------------------------

/**
 * Context provided by Tugcard to its children.
 *
 * The value is a stable registration function. Card content components call
 * `useTugcardPersistence()` which reads this context and registers their
 * save/restore callbacks in `useLayoutEffect` (Rule 3 of Rules of Tugways).
 *
 * null when rendered outside a Tugcard (no-op in useTugcardPersistence).
 *
 * Spec S04 ([D02])
 */
export const TugcardPersistenceContext = createContext<
  ((callbacks: TugcardPersistenceCallbacks) => void) | null
>(null);

// ---------------------------------------------------------------------------
// useTugcardPersistence hook
// ---------------------------------------------------------------------------

/**
 * Hook for card content components to opt in to state persistence.
 *
 * On tab deactivation, Tugcard calls `onSave()` and stores the result in
 * the DeckManager tab state cache (and debounced to tugbank). On tab
 * activation, Tugcard calls `onRestore(savedState)` with the previously
 * saved value. If no state was saved, `onRestore` is not called.
 *
 * **Rules of Tugways compliance:**
 * - Rule 3: Registers callbacks via `useLayoutEffect` so they are available
 *   before any events fire.
 * - Rule 5: Stores `onSave`/`onRestore` in refs so the registered wrappers
 *   never go stale, even when options change on re-renders.
 * - Rule 11: `onContentReady` fires deterministically after child DOM commits
 *   via the ref-flag no-deps `useLayoutEffect`. No `requestAnimationFrame`.
 * - Rule 12: The `restorePendingRef` flag is the cancellation mechanism for
 *   rapid tab switches. ([D78], [D79])
 *
 * Returns cleanup that unregisters (sets persistence callbacks to null) when
 * the card content component unmounts.
 *
 * Spec S05 ([D02], [D01], [D02], [D03], #s05-persistence-hook)
 */
export function useTugcardPersistence<T>(options: UseTugcardPersistenceOptions<T>): void {
  // Read the registration function from context (null outside a Tugcard).
  const register = useContext(TugcardPersistenceContext);

  // Store the caller's options in refs so the registered wrappers never go
  // stale when options change on re-renders (Rule 5).
  const onSaveRef = useRef<(() => T) | undefined>(undefined);
  const onRestoreRef = useRef<((state: T) => void) | undefined>(undefined);
  onSaveRef.current = options.onSave;
  onRestoreRef.current = options.onRestore;

  // Ref-flag mechanism ([D02], [D03], Spec S02):
  // Tugcard sets restorePendingRef.current = true before calling onRestore.
  // The no-deps useLayoutEffect below checks this flag on every commit and
  // fires onContentReady when set. This is the deterministic alternative to
  // requestAnimationFrame (Rule 12, [D79]).
  const restorePendingRef = useRef<boolean>(false);

  // Holds the callbacks object so the no-deps effect can read onContentReady
  // from it without capturing a closure. May reference a stale callbacks object
  // after unmount cleanup (which re-registers a no-op pair without
  // restorePendingRef). This is safe: after unmount, no further effects fire on
  // this component, so the no-deps useLayoutEffect never reads the stale ref.
  const callbacksObjRef = useRef<TugcardPersistenceCallbacks | null>(null);

  // Register stable wrappers that read from refs at call time.
  // useLayoutEffect runs before any events can fire (Rule 3).
  // Dependency array is [register] so registration runs once on mount and
  // cleanup runs on unmount -- updating onSave/onRestore does not re-register.
  useLayoutEffect(() => {
    if (!register) return;

    const callbacks: TugcardPersistenceCallbacks = {
      onSave: () => onSaveRef.current?.() as unknown,
      onRestore: (state: unknown) => onRestoreRef.current?.(state as T),
      restorePendingRef,
    };

    register(callbacks);
    callbacksObjRef.current = callbacks;

    // Cleanup: unregister when the card content component unmounts by
    // registering a no-op pair. Tugcard will call onSave on cleanup if it
    // runs deactivation, but the ref callbacks will still be valid until
    // unmount completes, so this is safe.
    return () => {
      register({ onSave: () => undefined, onRestore: () => {} });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  // No-deps useLayoutEffect: fires on every commit of this component.
  // When restorePendingRef is true (set by Tugcard's Phase 1 effect before
  // calling onRestore), the child's setState has now committed to the DOM.
  // Fire onContentReady and reset the flag. ([D01], [D02], Spec S02, Rule 11)
  useLayoutEffect(() => {
    if (!restorePendingRef.current) return;
    restorePendingRef.current = false;
    const onReady = callbacksObjRef.current?.onContentReady;
    if (onReady) onReady();
  });
}
