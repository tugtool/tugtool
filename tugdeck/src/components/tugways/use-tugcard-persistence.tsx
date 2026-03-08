/**
 * TugcardPersistenceContext -- opt-in card content state persistence.
 *
 * Provides the registration mechanism for card content components to save and
 * restore their state across tab switches and app reloads.
 *
 * Card content components call `useTugcardPersistence({ onSave, onRestore })`
 * (added in Step 6) which reads this context to register their callbacks with
 * Tugcard. Tugcard calls `onSave` on tab deactivation and `onRestore` on tab
 * activation.
 *
 * This file is created in Step 4 so that `TugcardPersistenceCallbacks` is
 * importable by tugcard.tsx in this step, avoiding a TypeScript compilation
 * failure between Steps 4 and 6.
 *
 * The `useTugcardPersistence` hook is added in Step 6.
 *
 * **Authoritative references:** [D02] Persistence hook, Spec S04, Spec S05
 * (#s04-persistence-context, #s05-persistence-hook, #d02-persistence-hook)
 */

import { createContext } from "react";

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
