/**
 * useSpatialOrder — declare a bounded scope's spatial arrow order ([P22] / [P23]).
 *
 * A layout (a card, or a dialog's trap mode) declares the ring / seam table for its
 * scope; the spatial navigator ([#step-7-8-spatial]) consults it by focus mode. The
 * order references nodes by their stable `group:order` focus key ([Q12]) — the same
 * key the surface seeds with — so an author never needs an auto-generated focusable
 * id. Registered on the card's `FocusContext` (resolved via `CardIdContext`, the same
 * context the focusables register into), keyed by `scopeId` (the focus mode the
 * navigator reads from `currentFocusMode()`).
 *
 * Pass `order: null` while the scope is inactive (e.g. a dialog that is not pending)
 * so nothing is registered; pass a **memoized** order otherwise so registration does
 * not thrash. Laws: [L03] registration in a layout effect; [L22] structure-zone
 * config on the engine; [L26] a no-op without a manager (gallery / standalone).
 */

import { useContext, useLayoutEffect } from "react";

import { CardIdContext } from "@/lib/card-id-context";
import { FocusManagerContext } from "./focus-manager";
import type { SpatialOrder } from "./spatial-order";

export function useSpatialOrder(scopeId: string, order: SpatialOrder | null): void {
  const manager = useContext(FocusManagerContext);
  const cardId = useContext(CardIdContext);
  useLayoutEffect(() => {
    if (manager === null || order === null) return;
    const ctx = manager.contextFor(cardId);
    ctx.registerSpatialOrder(scopeId, order);
    return () => ctx.unregisterSpatialOrder(scopeId);
  }, [manager, cardId, scopeId, order]);
}
