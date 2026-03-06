/**
 * useResponder -- hook for registering a component as a responder node.
 *
 * Reads the ResponderChainManager from ResponderChainContext and the nearest
 * parent responder ID from ResponderParentContext. Registers the caller as a
 * node on mount, unregisters on unmount. Returns a stable ResponderScope
 * component that provides this node's ID as the parent context for children.
 *
 * Registration uses useLayoutEffect ([D41], Rule of Tug #3) so the node is
 * registered during the commit phase (after DOM mutations, before paint).
 * Combined with useSyncExternalStore-driven SyncLane renders ([D01]), this
 * guarantees all responder registrations complete before the next browser
 * event fires, eliminating the timing gap between imperative state mutations
 * and React rendering.
 *
 * [D02] Nested context for parent discovery
 * [D03] useResponder uses useLayoutEffect for registration
 * [D41] Use useLayoutEffect for registrations that events depend on
 * Spec S02
 */

import React, { createContext, useContext, useLayoutEffect, useRef } from "react";
import { ResponderChainContext } from "./responder-chain";
import type { ActionEvent } from "./responder-chain";

// ---- ResponderParentContext ----

/**
 * React context holding the nearest ancestor responder ID.
 *
 * Default is null (no parent -- caller is a root node).
 * Each useResponder call provides its own ID as the new value for its subtree
 * via ResponderScope, enabling automatic parent discovery without prop drilling.
 */
export const ResponderParentContext = createContext<string | null>(null);

// ---- UseResponderOptions ----

/** Options for useResponder. */
export interface UseResponderOptions {
  /** Stable string ID for this responder node. Should be a constant at the call site. */
  id: string;
  /**
   * Map of action names to handler functions (primary dispatch path).
   *
   * [D02] Handler signature is (event: ActionEvent) => void
   * Spec S05 (#s05-use-responder-options)
   */
  actions?: Record<string, (event: ActionEvent) => void>;
  /**
   * Advisory canHandle function for actions not in the actions map.
   * Consulted by canHandle() and validateAction() queries only -- never by dispatch().
   */
  canHandle?: (action: string) => boolean;
  /** Per-action enabled-state query. Defaults to true if omitted. */
  validateAction?: (action: string) => boolean;
}

// ---- useResponder ----

/**
 * Register the calling component as a responder node.
 *
 * Must be called inside a <ResponderChainProvider>. Throws a descriptive
 * error if the manager context is null (programming error -- not a valid
 * runtime state for components that intend to register as responders).
 *
 * Returns { ResponderScope } -- a stable wrapper component that provides
 * this responder's ID as the parent context for its children. The component
 * has a stable function identity across re-renders (held in a ref) so React
 * does not unmount/remount children when the parent re-renders.
 *
 * Each component using useResponder must render <ResponderScope> around the
 * subtree that should treat this node as its parent responder.
 */
export function useResponder(options: UseResponderOptions): {
  ResponderScope: React.FC<{ children: React.ReactNode }>;
} {
  const manager = useContext(ResponderChainContext);

  if (manager === null) {
    throw new Error("useResponder must be used inside a <ResponderChainProvider>");
  }

  const parentId = useContext(ResponderParentContext);

  // Keep a ref to the latest options so the cleanup effect always sees the
  // correct id without needing to tear down and re-register on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Register during the commit phase (useLayoutEffect), unregister on unmount.
  // useLayoutEffect fires synchronously after all DOM mutations but before the
  // browser paints, ensuring the responder is registered before any keyboard or
  // pointer event handler can fire. This is the Rule of Tug #3 / [D41] contract.
  //
  // manager and parentId are stable references:
  //   - manager is the singleton from context, never replaced.
  //   - parentId changes only if an ancestor re-registers with a new ID,
  //     which is not a normal runtime condition.
  useLayoutEffect(() => {
    const { id, actions = {}, canHandle, validateAction } = optionsRef.current;
    manager.register({ id, parentId, actions, canHandle, validateAction });
    return () => {
      manager.unregister(id);
    };
  }, [manager, parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the ResponderScope component exactly once and hold it in a ref.
  // This gives the component a stable function identity across re-renders,
  // preventing React from unmounting and remounting children. The closure
  // captures options.id at creation time; since IDs should be stable string
  // literals at each call site, this is always correct.
  const scopeRef = useRef<React.FC<{ children: React.ReactNode }> | null>(null);
  if (scopeRef.current === null) {
    const nodeId = options.id;
    scopeRef.current = function ResponderScope({ children }: { children: React.ReactNode }) {
      return (
        <ResponderParentContext.Provider value={nodeId}>
          {children}
        </ResponderParentContext.Provider>
      );
    };
  }

  return { ResponderScope: scopeRef.current };
}
