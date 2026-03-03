/**
 * DeckManagerContext -- React context and convenience hook for DeckManager store access.
 *
 * Lives in a separate file to break the circular import between
 * deck-manager.ts (which imports this file for the root.render() wrapper)
 * and DeckCanvas/other components (which need access to the store).
 *
 * Context is typed against IDeckManagerStore (not DeckManager class) so
 * this module does not need to import deck-manager.ts, avoiding a cycle.
 *
 * **Authoritative references:**
 * - [D02] Extract IDeckManagerStore interface to break circular imports
 * - Spec S02: DeckManagerContext and useDeckManager hook
 */

import { createContext, useContext } from "react";
import type { IDeckManagerStore } from "./deck-manager-store";

/**
 * React context carrying the DeckManager store instance.
 *
 * Default value is null -- components must be rendered inside a
 * DeckManagerContext.Provider. useDeckManager() throws a descriptive
 * error if the context is null, catching mis-use at runtime.
 */
export const DeckManagerContext = createContext<IDeckManagerStore | null>(null);

/**
 * Convenience hook for accessing the DeckManager store from any component
 * in the DeckManagerContext.Provider subtree.
 *
 * Throws if called outside a provider so mis-use surfaces immediately
 * rather than producing silent null-dereference bugs.
 */
export function useDeckManager(): IDeckManagerStore {
  const store = useContext(DeckManagerContext);
  if (store === null) {
    throw new Error(
      "useDeckManager must be used inside a DeckManagerContext.Provider",
    );
  }
  return store;
}
