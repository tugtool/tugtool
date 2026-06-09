/**
 * useSpatialOrder — declare a bounded scope's spatial arrow order ([P22] / [P23]).
 *
 * A layout (a card, or a dialog's trap mode) declares the ring / seam table for its
 * scope; the spatial navigator ([#step-7-8-spatial]) consults it by focus mode. The
 * order references nodes by their stable `group:order` focus key ([Q12]) — the same
 * key the surface seeds with — so an author never needs an auto-generated focusable
 * id. Registered on the card's `FocusContext` (resolved via `CardIdContext`, the same
 * context the focusables register into), keyed by the focus mode the navigator reads
 * from `currentFocusMode()`.
 *
 * Two forms:
 *  - `useSpatialOrder(scopeId, order)` — explicit scope. A surface that OWNS its trap
 *    (the dialogs) passes the `scopeId` it got back from `useFocusTrap`.
 *  - `useSpatialOrder(order)` — context-derived scope. Content rendered INSIDE someone
 *    else's trap (a sheet body, whose trap lives in `TugSheet`) has no local scopeId;
 *    it reads the enclosing `FocusModeContext` that `FocusModeScope` provides. A no-op
 *    when there is no enclosing trap (the base mode), so the order never lands on the
 *    resting card.
 *
 * Pass `order: null` while the scope is inactive (e.g. a dialog that is not pending)
 * so nothing is registered; pass a **memoized** order otherwise so registration does
 * not thrash. Laws: [L03] registration in a layout effect; [L22] structure-zone
 * config on the engine; [L26] a no-op without a manager (gallery / standalone) or an
 * enclosing scope.
 */

import { useContext, useLayoutEffect } from "react";

import { CardIdContext } from "@/lib/card-id-context";
import { BASE_FOCUS_MODE, FocusManagerContext, FocusModeContext } from "./focus-manager";
import type { SpatialOrder } from "./spatial-order";

export function useSpatialOrder(order: SpatialOrder | null): void;
export function useSpatialOrder(scopeId: string, order: SpatialOrder | null): void;
export function useSpatialOrder(
  scopeIdOrOrder: string | SpatialOrder | null,
  maybeOrder?: SpatialOrder | null,
): void {
  const explicitScope =
    typeof scopeIdOrOrder === "string" ? scopeIdOrOrder : null;
  const order =
    typeof scopeIdOrOrder === "string" ? (maybeOrder ?? null) : scopeIdOrOrder;

  const manager = useContext(FocusManagerContext);
  const cardId = useContext(CardIdContext);
  const contextScope = useContext(FocusModeContext);
  const scopeId = explicitScope ?? contextScope;

  useLayoutEffect(() => {
    if (manager === null || order === null) return;
    // Context form with no enclosing trap → the base mode; declaring an order there
    // would bind it to the resting card, so no-op ([L26]).
    if (explicitScope === null && scopeId === BASE_FOCUS_MODE) return;
    const ctx = manager.contextFor(cardId);
    ctx.registerSpatialOrder(scopeId, order);
    return () => ctx.unregisterSpatialOrder(scopeId);
  }, [manager, cardId, scopeId, explicitScope, order]);
}
