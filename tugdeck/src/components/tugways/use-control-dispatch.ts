/**
 * useControlDispatch -- targeted dispatch hook for controls.
 *
 * Controls (buttons, checkboxes, switches, sliders, choice groups, etc.)
 * dispatch actions to their parent responder, not the first responder.
 * This hook reads the parent responder ID from ResponderParentContext and
 * returns two stable dispatch functions:
 *
 *   - `dispatch(event)` — targeted dispatch, returns boolean
 *   - `dispatchForContinuation(event)` — targeted dispatch with continuation
 *
 * Both call manager.sendToTarget / manager.sendToTargetForContinuation with the
 * parent responder as the target. The first responder is irrelevant.
 *
 * This is the web equivalent of Cocoa's targeted action pattern:
 *   [NSApp sendAction:action to:target from:sender]
 * where target is the control's parent view controller.
 *
 * Keyboard shortcuts and menu items use the nil-targeted form (manager.sendToFirstResponder)
 * which walks from the first responder. Controls must never use that form.
 *
 * See roadmap/targeted-dispatch.md for the full design rationale.
 */

import { useCallback, useContext } from "react";
import { ResponderChainContext, ResponderParentContext } from "./responder-chain";
import type { ActionEvent, DispatchResult } from "./responder-chain";

const NOOP_RESULT: DispatchResult = { handled: false, continuation: undefined };

export interface ControlDispatch {
  /** Targeted dispatch to parent responder. Returns false outside a provider. */
  dispatch: (event: ActionEvent) => boolean;
  /** Targeted dispatch with continuation support. Returns unhandled outside a provider. */
  dispatchForContinuation: (event: ActionEvent) => DispatchResult;
}

/**
 * Returns stable dispatch functions that target this control's parent
 * responder. Both are no-ops outside a ResponderChainProvider.
 */
export function useControlDispatch(): ControlDispatch {
  const manager = useContext(ResponderChainContext);
  const parentId = useContext(ResponderParentContext);

  const dispatch = useCallback(
    (event: ActionEvent) => {
      if (!manager || !parentId) return false;
      return manager.sendToTarget(parentId, event);
    },
    [manager, parentId],
  );

  const dispatchForContinuation = useCallback(
    (event: ActionEvent) => {
      if (!manager || !parentId) return NOOP_RESULT;
      return manager.sendToTargetForContinuation(parentId, event);
    },
    [manager, parentId],
  );

  return { dispatch, dispatchForContinuation };
}
