/**
 * useControlDispatch -- targeted dispatch hook for controls.
 *
 * Controls (buttons, checkboxes, switches, sliders, choice groups, etc.)
 * dispatch actions to their parent responder, not the first responder.
 * This hook reads the parent responder ID from ResponderParentContext and
 * returns a stable dispatch function that calls manager.dispatchTo(parentId, event).
 *
 * This is the web equivalent of Cocoa's targeted action pattern:
 *   [NSApp sendAction:action to:target from:sender]
 * where target is the control's parent view controller. The first responder
 * is irrelevant -- the action always reaches the parent handler.
 *
 * Keyboard shortcuts and menu items use the nil-targeted form (manager.dispatch)
 * which walks from the first responder. Controls must never use that form.
 *
 * See roadmap/targeted-dispatch.md for the full design rationale.
 */

import { useCallback, useContext } from "react";
import { ResponderChainContext } from "./responder-chain";
import type { ActionEvent } from "./responder-chain";
import { ResponderParentContext } from "./use-responder";

/**
 * Returns a stable function that dispatches an action to this control's
 * parent responder via dispatchTo. Returns false if no manager or parent
 * is available (control rendered outside a ResponderChainProvider).
 */
export function useControlDispatch(): (event: ActionEvent) => boolean {
  const manager = useContext(ResponderChainContext);
  const parentId = useContext(ResponderParentContext);
  return useCallback(
    (event: ActionEvent) => {
      if (!manager || !parentId) return false;
      return manager.dispatchTo(parentId, event);
    },
    [manager, parentId],
  );
}
