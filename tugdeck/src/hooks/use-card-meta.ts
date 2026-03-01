/**
 * useCardMeta — React hook for pushing card metadata updates to the CardHeader.
 *
 * React components call this hook with their current TugCardMeta (including
 * menu item callbacks that close over React state). On mount and whenever the
 * meta value changes, the hook calls the updateMeta function from CardContext,
 * which updates DeckCanvas state flowing to CardHeader via props.
 *
 * [D04] updateMeta is a state callback in the unified DeckCanvas tree (not a CustomEvent)
 *
 * Usage:
 *   useCardMeta({ title: "My Card", icon: "Info", closable: true, menuItems: [...] });
 */

import { useContext, useEffect } from "react";
import type { TugCardMeta } from "../cards/card";
import { CardContext } from "../cards/card-context";

export function useCardMeta(meta: TugCardMeta): void {
  const { updateMeta } = useContext(CardContext);

  useEffect(() => {
    updateMeta(meta);
    // We intentionally do a deep-equivalence check via JSON for primitives
    // and stable callbacks, but for simplicity we re-run on every render
    // where the meta reference changes. React components should memoize
    // their meta objects when menu callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, updateMeta]);
}
