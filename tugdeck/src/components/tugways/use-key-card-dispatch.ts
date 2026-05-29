/**
 * useKeyCardDispatch — programmatic key-card-scoped dispatch.
 *
 * The keyboard pipeline already routes shortcuts declared
 * `scope: "key-card"` to the key card's `kind: "card-content"`
 * responder (see `responder-chain-provider.tsx` →
 * `manager.sendToKeyCard*`). This hook exposes that same routing to
 * *code* that wants to dispatch a command to "whichever card the user is
 * in" without a keybinding — e.g. the prompt entry recognizing a typed
 * local slash command at submit and routing it to the dev card's
 * card-content responder, the exact path `CYCLE_PERMISSION_MODE` travels
 * ([D23], [#step-1c]).
 *
 * This is the key-card sibling of {@link useControlDispatch} (which
 * targets a control's *parent* responder). Use this when the target is
 * "the active card's content scope," not a specific parent in the chain.
 * The walk starts at the key card's card-content node and goes up via
 * `parentId`; `handled` reflects whether any responder consumed it, so
 * callers can fall back (e.g. send to claude) when no card handles it.
 *
 * Both functions are no-ops (`handled: false`) outside a
 * `ResponderChainProvider` or when there is no key card.
 */

import { useCallback, useContext } from "react";
import { ResponderChainContext } from "./responder-chain";
import type { ActionEvent, DispatchResult } from "./responder-chain";

const NOOP_RESULT: DispatchResult = { handled: false, continuation: undefined };

export interface KeyCardDispatch {
  /** Dispatch to the key card's card-content responder. Returns false if unhandled / no key card. */
  dispatch: (event: ActionEvent) => boolean;
  /** Key-card dispatch with continuation support. Returns unhandled outside a provider. */
  dispatchForContinuation: (event: ActionEvent) => DispatchResult;
}

/**
 * Returns stable functions that dispatch to the active card's
 * `card-content` responder. No-ops outside a ResponderChainProvider.
 */
export function useKeyCardDispatch(): KeyCardDispatch {
  const manager = useContext(ResponderChainContext);

  const dispatch = useCallback(
    (event: ActionEvent) => {
      if (!manager) return false;
      return manager.sendToKeyCard(event);
    },
    [manager],
  );

  const dispatchForContinuation = useCallback(
    (event: ActionEvent) => {
      if (!manager) return NOOP_RESULT;
      return manager.sendToKeyCardForContinuation(event);
    },
    [manager],
  );

  return { dispatch, dispatchForContinuation };
}
