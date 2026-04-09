/**
 * useResponder -- hook for registering a component as a responder node.
 *
 * Reads the ResponderChainManager from ResponderChainContext and the nearest
 * parent responder ID from ResponderParentContext. Registers the caller as a
 * node on mount, unregisters on unmount. Returns a stable ResponderScope
 * component that provides this node's ID as the parent context for children
 * and a stable `responderRef` callback that the caller attaches to its
 * root DOM element; the hook uses that ref to write a `data-responder-id`
 * attribute so the chain can resolve "innermost responder under the event
 * target" without a React tree walk (see ResponderChainManager.findResponderForTarget).
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

import React, { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";
import { ResponderChainContext } from "./responder-chain";
import type { ActionHandler, ResponderNode, TugAction } from "./responder-chain";

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

/**
 * Options for useResponder.
 *
 * Generic on `Extra extends string` so consumers can opt into action
 * names outside the production `TugAction` vocabulary (see
 * `action-vocabulary.ts`'s docstring). Production call sites use
 * `useResponder({ ... })` with the default `never` and see only
 * production action names in autocomplete; galleries and demos use
 * `useResponder<GalleryAction>({ ... })` to register handlers for
 * their opt-in names.
 */
export interface UseResponderOptions<Extra extends string = never> {
  /** Stable string ID for this responder node. Should be a constant at the call site. */
  id: string;
  /**
   * Partial map of TugAction names to handler functions (primary
   * dispatch path). A responder registers handlers for only the
   * subset of actions it cares about; other actions walk past it in
   * the chain.
   *
   * Handlers may return `void` (standard case) or `() => void` — an
   * optional "continuation" callback that the caller will invoke at a
   * later commit point (e.g. after a menu activation blink). The sync
   * portion of the handler (clipboard writes, state capture) runs
   * inline; the deferred portion runs from the continuation.
   *
   * [D02] Handler signature is (event: ActionEvent) => void | (() => void)
   * Spec S05 (#s05-use-responder-options)
   */
  actions?: Partial<Record<TugAction<Extra>, ActionHandler<Extra>>>;
  /**
   * Advisory canHandle function for actions not in the actions map.
   * Consulted by canHandle() and validateAction() queries only -- never by dispatch().
   *
   * Optional — when omitted, the hook skips installing the wrapper
   * closure entirely and the responder node's `canHandle` field
   * stays `undefined`, which the chain treats as "no advisory
   * override." Callers who genuinely need runtime-determined
   * capabilities (e.g. DeckCanvas as last-resort responder) provide
   * this function; all other responders leave it out.
   */
  canHandle?: (action: TugAction<Extra>) => boolean;
  /** Per-action enabled-state query. Defaults to true if omitted. */
  validateAction?: (action: TugAction<Extra>) => boolean;
}

// ---- useResponder ----

/**
 * Return type of useResponder.
 *
 * - `ResponderScope`: stable wrapper component that provides this
 *   responder's id as the parent context for children.
 * - `responderRef`: stable ref callback to attach to the component's
 *   root DOM element. The hook writes `data-responder-id="<id>"` on
 *   that element so the chain can resolve "innermost responder under
 *   this DOM node" via findResponderForTarget. Elements with no
 *   registered responder simply have no attribute.
 */
export interface UseResponderResult {
  ResponderScope: React.FC<{ children: React.ReactNode }>;
  responderRef: (el: Element | null) => void;
}

/**
 * Register the calling component as a responder node.
 *
 * Must be called inside a <ResponderChainProvider>. Throws a descriptive
 * error if the manager context is null (programming error -- not a valid
 * runtime state for components that intend to register as responders).
 *
 * Returns { ResponderScope, responderRef }.
 * - `ResponderScope` is a stable wrapper component that provides this
 *   responder's ID as the parent context for its children. The component
 *   has a stable function identity across re-renders (held in a ref) so
 *   React does not unmount/remount children when the parent re-renders.
 * - `responderRef` is a stable ref callback the caller attaches to its
 *   root DOM element. The hook writes `data-responder-id` on that
 *   element so the chain's first-responder promotion can walk the DOM
 *   from an event target and find this node.
 *
 * Each component using useResponder must:
 *   1. Render <ResponderScope> around the subtree that should treat
 *      this node as its parent responder.
 *   2. Attach responderRef to its root DOM element so the chain can
 *      resolve it during pointerdown capture.
 */
export function useResponder<Extra extends string = never>(
  options: UseResponderOptions<Extra>,
): UseResponderResult {
  const manager = useContext(ResponderChainContext);

  if (manager === null) {
    throw new Error("useResponder must be used inside a <ResponderChainProvider>");
  }

  const parentId = useContext(ResponderParentContext);

  // Keep a ref to the latest options so the cleanup effect always sees the
  // correct id without needing to tear down and re-register on every render.
  // Also: the proxy actions map installed into the chain reads from this
  // ref on every dispatch, so handler identity changes between renders
  // are reflected without re-registering (closes the stale-closure
  // loophole described in the audit doc section 2.5 / R5).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Capture whether the caller provided `canHandle` / `validateAction`
  // at mount time. The hook uses these flags to decide whether to
  // install live-lookup closures for those fields or to leave them
  // undefined on the registered node. Leaving them undefined lets the
  // chain's dispatch/query code skip the advisory-override branch
  // entirely, which is the expected behavior for the vast majority of
  // responders that don't need runtime capability overrides.
  //
  // Design note: the flag is captured once at mount (not read live
  // from optionsRef). A caller that adds `canHandle` after the fact
  // would need to re-register to have it take effect — which is fine,
  // because `canHandle` existence is a structural property of the
  // responder's identity, not a per-render toggle. The R5 live-proxy
  // mechanism handles handler identity changes; this flag handles
  // structural shape changes, which are not expected to happen.
  const hasCanHandleAtMount = useRef(options.canHandle !== undefined);
  const hasValidateActionAtMount = useRef(options.validateAction !== undefined);

  // Register during the commit phase (useLayoutEffect), unregister on unmount.
  // useLayoutEffect fires synchronously after all DOM mutations but before the
  // browser paints, ensuring the responder is registered before any keyboard or
  // pointer event handler can fire. This is the Rule of Tug #3 / [D41] contract.
  //
  // manager and parentId are stable references:
  //   - manager is the singleton from context, never replaced.
  //   - parentId changes only if an ancestor re-registers with a new ID,
  //     which is not a normal runtime condition.
  //
  // The `actions` we register is a live Proxy: rather than capturing the
  // current actions map at registration time, every access reads from
  // optionsRef.current.actions. This means a caller that forgets to
  // useCallback-wrap their handlers still gets correct dispatch — the
  // manager always sees the current render's handlers.
  useLayoutEffect(() => {
    const id = optionsRef.current.id;
    // Live-lookup proxy: every access reads from optionsRef.current.actions
    // so re-renders with new handler identities are reflected without
    // re-registering the node. Closes the stale-closure loophole
    // documented in R5 of the audit.
    const liveActions = new Proxy(
      {} as Partial<Record<TugAction<Extra>, ActionHandler<Extra>>>,
      {
        get(_, prop: string | symbol): ActionHandler<Extra> | undefined {
          if (typeof prop !== "string") return undefined;
          const actions = optionsRef.current.actions;
          return actions ? actions[prop as TugAction<Extra>] : undefined;
        },
        has(_, prop: string | symbol): boolean {
          if (typeof prop !== "string") return false;
          const actions = optionsRef.current.actions;
          return actions ? prop in actions : false;
        },
        ownKeys(): ArrayLike<string | symbol> {
          const actions = optionsRef.current.actions;
          return actions ? Reflect.ownKeys(actions) : [];
        },
        getOwnPropertyDescriptor(_, prop: string | symbol) {
          if (typeof prop !== "string") return undefined;
          const actions = optionsRef.current.actions;
          if (actions && prop in actions) {
            return {
              enumerable: true,
              configurable: true,
              value: actions[prop as TugAction<Extra>],
            };
          }
          return undefined;
        },
      },
    );
    // Build the node without always installing canHandle/validateAction
    // wrapper closures. Callers who did not provide those fields get
    // `undefined` on the node, which the chain treats as "no advisory
    // override" and skips in dispatch/query walks. Only callers who
    // actually supplied a function pay the closure cost, and for
    // those we still read via optionsRef so handler identity changes
    // are reflected without re-registering.
    const node: ResponderNode<Extra> = {
      id,
      parentId,
      actions: liveActions,
    };
    if (hasCanHandleAtMount.current) {
      node.canHandle = (action: TugAction<Extra>) =>
        optionsRef.current.canHandle?.(action) ?? false;
    }
    if (hasValidateActionAtMount.current) {
      node.validateAction = (action: TugAction<Extra>) =>
        optionsRef.current.validateAction?.(action) ?? true;
    }
    manager.register(node);
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

  // Stable ref callback that writes data-responder-id to the host element.
  // Handles cleanup when the element is detached and re-attachment on
  // element swap (React may remount the host in rare cases).
  const currentElementRef = useRef<Element | null>(null);
  const responderRef = useCallback((el: Element | null) => {
    const prev = currentElementRef.current;
    if (prev && prev !== el) {
      prev.removeAttribute("data-responder-id");
    }
    if (el) {
      el.setAttribute("data-responder-id", options.id);
    }
    currentElementRef.current = el;
  }, [options.id]);

  return { ResponderScope: scopeRef.current, responderRef };
}
