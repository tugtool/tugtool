/**
 * CardPersistenceContext and useCardPersistence hook.
 *
 * Provides the opt-in card content state persistence mechanism for card content.
 *
 * Card content components call `useCardPersistence({ onSave, onRestore })`
 * to register save/restore callbacks with their enclosing CardHost, which
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
 * Options accepted by useCardPersistence.
 *
 * Generic over T so card content components get type-safe onRestore.
 * Internally stored as CardPersistenceCallbacks (erased to unknown)
 * so CardHost can treat the content payload as opaque JSON.
 *
 * Spec S05 ([D02])
 */
export interface UseCardPersistenceOptions<T> {
  /** Called by CardHost on tab deactivation. Must return JSON-serializable state. */
  onSave: () => T;
  /** Called by CardHost on tab activation with the previously saved state. */
  onRestore: (state: T) => void;
  /**
   * Called when this card transitions to being the focus destination —
   * i.e. `isFocusDestination` flips from `false` to `true`. Typical
   * implementation for content-owning cards:
   *
   * ```ts
   * onCardActivated: () => {
   *   engine.root.focus({ preventScroll: true });
   * }
   * ```
   *
   * The callback fires only after the shared `CardHost` activation
   * effect ([A3]) is installed (M-phase 2). At the step that declares
   * this field, registering the callback is a no-op; implementors may
   * register it now in preparation. The has-been-active ref-guard in
   * [A3] skips the initial activation at mount; the callback fires on
   * subsequent `false → true` transitions only.
   *
   * Optional. FC (DOM-authority) cards don't need this — `CardHost`
   * re-applies `bag.focus` + `bag.domSelection` directly for them.
   */
  onCardActivated?: () => void;
}

// ---------------------------------------------------------------------------
// CardPersistenceCallbacks
// ---------------------------------------------------------------------------

/**
 * Save/restore callback pair registered by card content components via
 * `useCardPersistence`. CardHost calls these on tab deactivation/activation.
 *
 * - `onSave()` is called on deactivation. Returns opaque JSON-serializable state.
 * - `onRestore(state)` is called on activation with the previously saved state.
 * - `onContentReady` is written by CardHost into this object before calling
 *   `onRestore`. The hook's no-deps `useLayoutEffect` fires it after the child's
 *   DOM commits (Rule 11, Rule 12, [D78], [D79]).
 * - `restorePendingRef` is created by the hook and included here so CardHost can
 *   set it to `true` before calling `onRestore`, signaling that a restore is in
 *   flight. The hook's no-deps `useLayoutEffect` reads this flag. ([D03])
 *
 * Spec S04 ([D02], [D01], [D03])
 */
export interface CardPersistenceCallbacks {
  onSave: () => unknown;
  onRestore: (state: unknown) => void;
  /**
   * Written by CardHost before calling `onRestore`. Fired by the hook's
   * no-deps `useLayoutEffect` after the child's DOM commits. Optional because
   * existing card content that doesn't need ready signaling is unaffected.
   *
   * Rule 11, Rule 12, [D78], [D79], [D01]
   */
  onContentReady?: () => void;
  /**
   * Ref created by the hook, set to `true` by CardHost before calling
   * `onRestore`. Read by the hook's no-deps `useLayoutEffect`. Shared via this
   * callbacks object so no new context or side channel is needed. ([D03])
   */
  restorePendingRef?: React.RefObject<boolean>;
  /**
   * Called by the shared `CardHost` activation effect ([A3]) when this
   * card becomes the focus destination — a `false → true` transition
   * of `isFocusDestination(cardId)`. Mount is skipped by the
   * has-been-active guard inside the effect.
   *
   * The callback fires only after the activation effect is installed
   * (M-phase 2). While the field is declared but not yet dispatched,
   * registering it is a no-op — content factories can opt in in advance
   * without waiting for the dispatcher to land.
   *
   * Optional. FC (DOM-authority) cards leave it unset; `CardHost`
   * handles their reactivation by re-applying `bag.focus` +
   * `bag.domSelection` directly ([A3]).
   */
  onCardActivated?: () => void;
}

// ---------------------------------------------------------------------------
// CardPersistenceContext
// ---------------------------------------------------------------------------

/**
 * Value carried by {@link CardPersistenceContext}. CardHost writes this
 * pair on mount so descendants can both register persistence callbacks
 * and learn the id of the card they are rendering inside. `cardId` is
 * separate from the render-time `CardHost` props so content components
 * (e.g. `TugPromptInput`) can forward the id to non-React singletons
 * like `selectionGuard` without prop-drilling or reading the deck tree.
 */
export interface CardPersistenceContextValue {
  /** Stable identity of the enclosing card — survives cross-pane moves. */
  cardId: string;
  /** Register persistence callbacks for this card. Called once per mount. */
  register: (callbacks: CardPersistenceCallbacks) => void;
}

/**
 * Context provided by CardHost to its children.
 *
 * The value bundles the enclosing card's id and the stable registration
 * function. Card content components call `useCardPersistence()` which
 * reads this context and registers their save/restore callbacks in
 * `useLayoutEffect` (Rule 3 of Rules of Tugways). Components that need
 * the card id for out-of-tree wiring read it via {@link useCardId}.
 *
 * null when rendered outside CardHost (no-op in useCardPersistence).
 *
 * Spec S04 ([D02])
 */
export const CardPersistenceContext = createContext<
  CardPersistenceContextValue | null
>(null);

/**
 * Hook that returns the enclosing card's id, or `null` when rendered
 * outside `CardHost`. Card content components use this to wire
 * themselves into card-scoped singletons (e.g. `selectionGuard`).
 */
export function useCardId(): string | null {
  return useContext(CardPersistenceContext)?.cardId ?? null;
}

// ---------------------------------------------------------------------------
// useCardPersistence hook
// ---------------------------------------------------------------------------

/**
 * Hook for card content components to opt in to state persistence.
 *
 * On tab deactivation, CardHost calls `onSave()` and stores the result in
 * the DeckManager tab state cache (and debounced to tugbank). On tab
 * activation, CardHost calls `onRestore(savedState)` with the previously
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
export function useCardPersistence<T>(options: UseCardPersistenceOptions<T>): void {
  // Read the registration function from context (null outside CardHost).
  const register = useContext(CardPersistenceContext)?.register ?? null;

  // Store the caller's options in refs so the registered wrappers never go
  // stale when options change on re-renders (Rule 5).
  const onSaveRef = useRef<(() => T) | undefined>(undefined);
  const onRestoreRef = useRef<((state: T) => void) | undefined>(undefined);
  const onCardActivatedRef = useRef<(() => void) | undefined>(undefined);
  onSaveRef.current = options.onSave;
  onRestoreRef.current = options.onRestore;
  onCardActivatedRef.current = options.onCardActivated;

  // Ref-flag mechanism ([D02], [D03], Spec S02):
  // CardHost sets restorePendingRef.current = true before calling onRestore.
  // The no-deps useLayoutEffect below checks this flag on every commit and
  // fires onContentReady when set. This is the deterministic alternative to
  // requestAnimationFrame (Rule 12, [D79]).
  const restorePendingRef = useRef<boolean>(false);

  // Holds the callbacks object so the no-deps effect can read onContentReady
  // from it without capturing a closure. May reference a stale callbacks object
  // after unmount cleanup (which re-registers a no-op pair without
  // restorePendingRef). This is safe: after unmount, no further effects fire on
  // this component, so the no-deps useLayoutEffect never reads the stale ref.
  const callbacksObjRef = useRef<CardPersistenceCallbacks | null>(null);

  // Register stable wrappers that read from refs at call time.
  // useLayoutEffect runs before any events can fire (Rule 3).
  // Dependency array is [register] so registration runs once on mount and
  // cleanup runs on unmount -- updating onSave/onRestore does not re-register.
  useLayoutEffect(() => {
    if (!register) return;

    const callbacks: CardPersistenceCallbacks = {
      onSave: () => onSaveRef.current?.() as unknown,
      onRestore: (state: unknown) => onRestoreRef.current?.(state as T),
      // Forward through a stable ref-reading wrapper so the latest
      // caller-supplied implementation fires even when `options`
      // changes across re-renders (Rule 5). `undefined` when the
      // caller didn't provide it — the dispatcher in [A3] checks for
      // presence before invoking.
      onCardActivated: () => onCardActivatedRef.current?.(),
      restorePendingRef,
    };

    register(callbacks);
    callbacksObjRef.current = callbacks;

    // Cleanup: unregister when the card content component unmounts by
    // registering a no-op pair. CardHost will call onSave on cleanup if it
    // runs deactivation, but the ref callbacks will still be valid until
    // unmount completes, so this is safe.
    return () => {
      register({ onSave: () => undefined, onRestore: () => {} });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  // No-deps useLayoutEffect: fires on every commit of this component.
  // When restorePendingRef is true (set by CardHost's Phase 1 effect before
  // calling onRestore), the child's setState has now committed to the DOM.
  // Fire onContentReady and reset the flag. ([D01], [D02], Spec S02, Rule 11)
  useLayoutEffect(() => {
    if (!restorePendingRef.current) return;
    restorePendingRef.current = false;
    const onReady = callbacksObjRef.current?.onContentReady;
    if (onReady) onReady();
  });
}
