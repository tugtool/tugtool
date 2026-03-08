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
 * **Authoritative references:** [D02] Persistence hook, Spec S04, Spec S05
 * (#s04-persistence-context, #s05-persistence-hook, #d02-persistence-hook)
 */

import { createContext, useContext, useLayoutEffect, useRef } from "react";

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
 *
 * Spec S04 ([D02])
 */
export interface TugcardPersistenceCallbacks {
  onSave: () => unknown;
  onRestore: (state: unknown) => void;
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
 *
 * Returns cleanup that unregisters (sets persistence callbacks to null) when
 * the card content component unmounts.
 *
 * Spec S05 ([D02], #s05-persistence-hook)
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

  // Register stable wrappers that read from refs at call time.
  // useLayoutEffect runs before any events can fire (Rule 3).
  // Dependency array is empty so registration runs once on mount and cleanup
  // runs on unmount -- updating onSave/onRestore does not re-register.
  useLayoutEffect(() => {
    if (!register) return;

    const callbacks: TugcardPersistenceCallbacks = {
      onSave: () => onSaveRef.current?.() as unknown,
      onRestore: (state: unknown) => onRestoreRef.current?.(state as T),
    };

    register(callbacks);

    // Cleanup: unregister when the card content component unmounts by
    // registering a no-op pair. Tugcard will call onSave on cleanup if it
    // runs deactivation, but the ref callbacks will still be valid until
    // unmount completes, so this is safe.
    return () => {
      register({ onSave: () => undefined, onRestore: () => {} });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);
}
