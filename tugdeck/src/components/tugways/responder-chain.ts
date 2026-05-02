/**
 * ResponderChainManager -- tugways responder chain infrastructure.
 *
 * A plain TypeScript class (outside React state) that manages the responder
 * chain tree: registration, first-responder tracking, action dispatch, and
 * two-level action validation.
 *
 * Also exports ResponderChainContext so both use-responder.ts and
 * responder-chain-provider.tsx can import it without circular dependencies.
 *
 * [D01] Plain TypeScript class outside React state
 * [D05] Two-level action validation (canHandle + validateAction)
 *
 * ## INVARIANTS (per `tugplan-tide-overlay-framework.md` [D04])
 *
 * Six contracts the chain guarantees. Each is asserted by a test in
 * `tugdeck/src/__tests__/responder-chain-invariants.test.ts`. Reviewers
 * touching the chain should verify whether their change preserves
 * each invariant; tests are the load-bearing assertion.
 *
 *   I1. Every registered responder's `parentId` is either `null` or the
 *       id of another registered responder (at registration time). The
 *       chain does NOT enforce this — it is a caller contract. The walk
 *       semantics (#i1-test) tolerate a stale parentId by stopping at
 *       the dangling reference (no infinite loop, no crash).
 *
 *   I2. `firstResponderId` is `null` OR the id of a currently registered
 *       responder. Maintained by `unregister`'s DOM-walk fallback that
 *       promotes the nearest still-registered ancestor when the current
 *       first responder is removed; never leaves a dangling id.
 *
 *   I3. `sendToTarget(id, ...)` walks `parentId` from `id`, regardless
 *       of `firstResponderId` state. Never a no-op because the first
 *       responder is unexpected. (This is the contract that fixed the
 *       Step 3 cancel-cascade bug — see `tugplan-tide-overlay-framework.md`
 *       (#sheet-cascade-rationale).)
 *
 *   I4. `findResponderForTarget(node)` walks DOM `parentElement` from
 *       `node`, returning the id of the nearest *registered* responder
 *       along the rendered DOM path, or `null` if none exists. This is
 *       the DOM-walk axis of (#mental-model)'s [D03] dual-walk policy:
 *       different by design from `walkFromNode`, which walks `parentId`
 *       through the registry.
 *
 *   I5. A modal that captures a `cascadeTargetId` at open time can
 *       dispatch to that target on close even when there is no DOM-walk
 *       path between the modal's portaled DOM and the target. The two
 *       walks (DOM vs. parentId) serve different purposes per [D03];
 *       cascade dispatches must use the parentId-walking variant
 *       (`sendToTarget`) so they are independent of DOM ancestry.
 *
 *   I6. `data-tug-focus="refuse"` controls only chain-promotion-skip and
 *       browser-focus-prevention semantics (button-class behavior, in
 *       `responder-chain-provider.tsx`). It does NOT control
 *       pane-focus-controller activation/deselect — that subsystem keys
 *       on `[data-slot="tug-canvas-overlay-root"]` (per [D01]). One
 *       attribute, one semantic; do not overload.
 *
 * The mental model the framework operates within — five subsystems
 * (portals, responder chain, focus events, pane focus controller, focus-
 * discipline markers) and their interactions — is documented in
 * `tugplan-tide-overlay-framework.md` (#mental-model). Read it before
 * proposing chain-touching changes.
 */

import { createContext } from "react";
import type { TugAction } from "./action-vocabulary";

export type { TugAction, GalleryAction } from "./action-vocabulary";

// ---- ActionPhase and ActionEvent ----

/**
 * Five-phase action lifecycle.
 *
 * - `discrete`: one-shot action (button click, menu selection)
 * - `begin`:    start of a continuous interaction (scrub start, drag start)
 * - `change`:   intermediate update during a continuous interaction
 * - `commit`:   end of a continuous interaction with final value
 * - `cancel`:   continuous interaction cancelled (no value change committed)
 *
 * [D01] ActionEvent is the sole dispatch currency
 * (#s01-action-event-type)
 */
export type ActionPhase = "discrete" | "begin" | "change" | "commit" | "cancel";

// ---- ResponderKind ----

/**
 * Tier tag for responder nodes. A typed string-union enum so misspellings
 * are compile errors and adding a new tier (e.g. `"panel"`) is reviewed
 * at one location.
 *
 * Used by `getKeyResponderOfKind` to walk up the chain looking for the
 * nearest ancestor of a given tier — the mechanism that gives us a
 * stable "active card" identity without storing one. See
 * design doc for the design.
 *
 * Initial members:
 * - `"card"` — top-level card responders (TugCard).
 *
 * New members are added here and consumed by `useResponder` callers
 * that pass `kind`. The default `kind === undefined` is the "untagged"
 * case — most responders are untagged (text inputs, sliders, popups);
 * only tier-defining nodes opt in.
 */
export type ResponderKind = "card" | "card-content";

/**
 * Typed action event -- the sole dispatch currency.
 *
 * All dispatch call sites produce an ActionEvent. All action handlers receive
 * a full ActionEvent, even for discrete (button click) actions.
 *
 * [D01] ActionEvent is the sole dispatch currency
 * [D02] Handler signature is (event: ActionEvent) => void | (() => void)
 * (#s01-action-event-type)
 */
export interface ActionEvent<Extra extends string = never> {
  /**
   * Semantic action name from the TugAction vocabulary.
   * See action-vocabulary.ts for the complete list and payload
   * conventions. Misspellings are compile errors.
   *
   * The `Extra` type parameter lets non-production consumers
   * (galleries, demos) extend the vocabulary without polluting the
   * default. Defaults to `never` — bare `ActionEvent` is the
   * production form.
   */
  action: TugAction<Extra>;
  /** The control that initiated the event (ref or instance). Optional. */
  sender?: unknown;
  /** Typed payload (color, number, point, etc.). Optional for discrete actions. */
  value?: unknown;
  /** Lifecycle phase. Use "discrete" for one-shot actions (button clicks, menu selections). */
  phase: ActionPhase;
}

/**
 * Return type of an action handler.
 *
 * Handlers may return:
 * - `void` — the handler's work is complete. Standard case.
 * - `() => void` — a "continuation" callback that the caller may invoke
 *   at a later commit point (e.g., after a menu activation blink
 *   finishes). The sync portion of the handler (e.g., a user-gesture-bound
 *   clipboard write) runs inline; the deferred portion (e.g., mutating
 *   the document after visual feedback) runs from the continuation.
 *
 * Callers that need the continuation use the `ForContinuation` variants.
 * `sendToFirstResponder` / `sendToTarget` discard it and just report
 * handled/unhandled.
 *
 * [D02] Two-phase action handling via optional continuation
 */
export type ActionHandlerResult = void | (() => void);

/**
 * Action handler signature — receives the event, optionally returns a
 * continuation. Generic on the same `Extra` parameter as `ActionEvent`
 * so gallery consumers can type their handlers with opt-in extras.
 */
export type ActionHandler<Extra extends string = never> = (
  event: ActionEvent<Extra>,
) => ActionHandlerResult;

// ---- ResponderNode interface ----

/**
 * A node in the responder chain tree.
 *
 * Each node has a unique ID, an optional parent link, a map of action
 * handlers, and optional validation functions.
 *
 * The `actions` map is the primary mechanism for dispatch. Any action that
 * should be dispatchable MUST have an entry in the actions map. The optional
 * `canHandle` function is an advisory override for cases where the set of
 * handleable actions is not statically known (e.g., a card delegating to a
 * child). It is only consulted by the canHandle() validation query -- never
 * by dispatch().
 *
 * [D02] Handler signature is (event: ActionEvent) => void
 * (#s04-responder-node-actions)
 */
export interface ResponderNode<Extra extends string = never> {
  id: string;
  parentId: string | null;
  /**
   * Partial map of TugAction names to handlers. A responder registers
   * handlers for only the subset of actions it cares about; other
   * actions walk past it in the chain. Generic on `Extra` so galleries
   * can register handlers for opt-in action names.
   */
  actions: Partial<Record<TugAction<Extra>, ActionHandler<Extra>>>;
  /**
   * Advisory capability override for validation queries only.
   * dispatch() never consults this -- only canHandle() and validateAction()
   * queries do. Use for runtime-determined capabilities not in the actions map.
   */
  canHandle?: (action: TugAction<Extra>) => boolean;
  validateAction?: (action: TugAction<Extra>) => boolean;
  /**
   * Optional tier tag. Consumed by `getKeyResponderOfKind` to find the
   * nearest ancestor of a given tier from the current first responder.
   * Untagged responders are skipped during the walk. Most responders
   * are untagged; only tier-defining nodes (cards) opt in.
   */
  kind?: ResponderKind;
}

// ---- ResponderChainManager ----

/**
 * Manages the responder chain tree.
 *
 * Instantiated once per ResponderChainProvider and provided via
 * ResponderChainContext as a stable reference (never replaced).
 *
 * Maintains a validationVersion counter that increments on any structural
 * change so useSyncExternalStore subscribers know to re-check.
 */
/**
 * Result of the ForContinuation dispatch methods — whether the event was handled and,
 * if the handler returned a continuation callback, that callback.
 */
export interface DispatchResult {
  /** True if a responder's actions map contained a matching handler. */
  handled: boolean;
  /**
   * Optional continuation returned by the handler. Callers that need
   * two-phase execution (e.g., a menu that plays a blink after the sync
   * phase and wants the visible side effect to run after) invoke this
   * at their commit point.
   */
  continuation?: () => void;
}

/**
 * Signature of a dispatch observer. Fires after every call to dispatch,
 * sendToFirstResponder, sendToTarget, or their ForContinuation siblings — whether or not a handler
 * matched. `handled` reflects the final outcome. Use for components that
 * need to react to chain traffic (e.g. a context menu that closes on
 * any external action).
 */
export type DispatchObserver = (event: ActionEvent, handled: boolean) => void;

/**
 * Signature of a key-responder observer. Fires after any chain change
 * (register, unregister, first-responder change) when, *and only when*,
 * the derived `getKeyResponderOfKind(kind)` value differs from the
 * value seen at the previous notification. Initial subscription does
 * not fire — callers read the current value via
 * `getKeyResponderOfKind` synchronously after subscribing.
 */
export type KeyResponderObserver = (responderId: string | null) => void;

/**
 * Internal subscription record for `observeKeyResponder`. Stores the
 * tier the observer is interested in, the callback to invoke, and the
 * last value the observer was notified about so we can dedupe to
 * "fires only when the derived value changes."
 */
interface KeyResponderSubscription {
  kind: ResponderKind;
  callback: KeyResponderObserver;
  lastValue: string | null;
}

/**
 * Internal helper: look up an action handler on a stored responder
 * node. Accepts a `TugAction<Extra>` (widened by the caller) and
 * narrows to the stored node's key type via a single localized cast.
 *
 * Rationale: `ResponderNode.actions` is typed against `TugAction`
 * (the default `never` form), but the manager's public dispatch and
 * query methods accept `TugAction<Extra>` so gallery and test
 * consumers can register opt-in action names. At runtime every
 * action is just a string, and the stored function object only ever
 * receives events whose action matches the key it was registered
 * under — so the variance mismatch is soundness at runtime, and the
 * cast is the minimum amount of type-system escape needed to bridge
 * the generic public API to the non-generic internal storage.
 */
function lookupHandler(
  node: ResponderNode,
  action: string,
): ActionHandler | undefined {
  return node.actions[action as TugAction];
}

/**
 * Whether the chain debug logs are enabled. Reads
 * `window.__tugChainDebug` at call time so devtools toggles take
 * effect immediately without a reload. Default: off.
 *
 * ```
 * window.__tugChainDebug = true;   // enable
 * window.__tugChainDebug = false;  // silence
 * ```
 */
function isChainDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __tugChainDebug?: boolean }).__tugChainDebug === true;
}

export class ResponderChainManager {
  // Internal storage uses the default `ResponderNode` (i.e.
  // `ResponderNode<never>`) — the narrowest, production-only form.
  // Gallery consumers that register with an `Extra` type parameter
  // widen at the `register` boundary via an `as unknown as` assertion.
  // The assertion is sound at runtime because the manager treats
  // action names as opaque strings: it only indexes `node.actions` by
  // `event.action` and passes the event back to the same function
  // object that was registered for that key, so the handler always
  // receives the exact event shape it was written against.
  //
  // TypeScript's variance rules forbid a direct structural widening
  // (ActionHandler is contravariant in its event parameter), hence
  // the one `as unknown as` cast inside `register`. The escape hatch
  // is confined to that single call site; every other method below
  // operates on `ResponderNode<never>` safely, because the extras
  // that gallery consumers add are only visible through their own
  // generic API — the manager never constructs new ActionEvents on
  // their behalf.
  private nodes: Map<string, ResponderNode> = new Map();
  private firstResponderId: string | null = null;
  private validationVersion = 0;
  private subscribers: Set<() => void> = new Set();
  private dispatchObservers: Set<DispatchObserver> = new Set();
  private keyResponderSubscriptions: Set<KeyResponderSubscription> = new Set();
  private defaultButtonStack: HTMLButtonElement[] = [];

  // ---- Registration ----

  /**
   * Register a responder node.
   *
   * Auto-first-responder for root nodes: if the node's parentId is null and
   * firstResponderId is currently null, this root node becomes the first
   * responder automatically. Increments validationVersion and notifies
   * subscribers in that case.
   */
  register<Extra extends string = never>(node: ResponderNode<Extra>): void {
    // Widen to `ResponderNode<never>` for internal storage. See the
    // comment on `private nodes` for why this cast is sound at runtime.
    this.nodes.set(node.id, node as unknown as ResponderNode);
    if (node.parentId === null && this.firstResponderId === null) {
      this.firstResponderId = node.id;
      this.syncFirstResponderDomAttribute();
      this.incrementAndNotify();
    }
  }

  /**
   * Unregister a responder node.
   *
   * If the removed node was the first responder, auto-promotes the
   * nearest still-registered ancestor to first responder. The lookup
   * walks the unregistering node's DOM ancestors via
   * `findResponderForTarget`, which is robust against the order in
   * which sibling effect cleanups run during a tree unmount.
   *
   * Why DOM walk instead of `node.parentId`:
   *
   * React useLayoutEffect cleanup order during a multi-level unmount is
   * not strictly child-to-parent. A wrapping responder's effect cleanup
   * can run BEFORE the cleanup of a responder it nests — concretely,
   * when a gallery card uses `useResponderForm` to wrap a
   * `tug-prompt-input`, switching tabs unmounts the form responder
   * before the prompt input. By the time the prompt input's cleanup
   * fires, its captured `parentId` (the form responder's id) is no
   * longer in `nodes`, so the previous one-level promotion would set
   * `firstResponderId = null`. Subsequent dispatches start from null
   * and walk nothing — every keyboard shortcut becomes a no-op until
   * the next click promotes a new first responder. (Symptom in the
   * field: ⇧⌘[ / ⇧⌘] tab navigation got "stuck" the first time the
   * user passed through a tab containing such a nested form responder.)
   *
   * The DOM is the truth source during cleanup: React runs effect
   * cleanups before removing DOM nodes, so the unregistering node's
   * element and its ancestors are all still in the document.
   * `findResponderForTarget` walks DOM parents looking for
   * `data-responder-id` whose value IS in `this.nodes` — it naturally
   * skips ancestors that have already unregistered in the same
   * cleanup pass and stops at the nearest one that's still alive.
   *
   * Falls back to the captured `parentId` when there is no document
   * (jsdom-less unit tests) or when the unregistering element is
   * already detached.
   */
  unregister(id: string): void {
    const node = this.nodes.get(id);
    this.nodes.delete(id);

    if (this.firstResponderId === id) {
      let nextFirst: string | null = null;

      if (typeof document !== "undefined") {
        const escapedId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(id)
            : id;
        const el = document.querySelector(`[data-responder-id="${escapedId}"]`);
        if (el && el.parentElement) {
          nextFirst = this.findResponderForTarget(el.parentElement);
        }
      }

      if (
        nextFirst === null &&
        node &&
        node.parentId !== null &&
        this.nodes.has(node.parentId)
      ) {
        nextFirst = node.parentId;
      }

      // Last-resort fallback: if neither the DOM walk nor the
      // captured parentId yields a still-registered ancestor, but a
      // root responder (parentId === null) is registered, promote it.
      // This is the symmetric counterpart of `register()`'s "auto-
      // promote on first registration when firstResponder is null"
      // branch — same invariant, applied at unregister time:
      //
      //   *while at least one root responder is registered, the
      //   chain has a first responder.*
      //
      // Without this rule, a multi-step cascade (e.g. close a multi-
      // tab pane in one render — cards unregister, then pane
      // unregisters, then a portaled popover unmounts somewhere in
      // between) can land `firstResponderId` on `null` even though
      // the root (typically `deck-canvas`) is still alive. Subsequent
      // `sendToFirstResponder` walks from null and silently no-ops —
      // breaking menu items / keyboard shortcuts / control-frame
      // actions that rely on the root's last-resort handlers ([D08]).
      if (nextFirst === null) {
        nextFirst = this.findRootResponderId();
      }

      this.firstResponderId = nextFirst;
      this.syncFirstResponderDomAttribute();
      this.incrementAndNotify();
    }
  }

  /**
   * Return the id of any registered root responder
   * (`parentId === null`), or `null` if none is registered.
   *
   * `Map` iteration order is insertion order, so this returns the
   * earliest-registered root — typically `deck-canvas`, which
   * mounts before any descendant. Multi-root scenarios are not
   * expected in production; this picks deterministically rather
   * than throwing.
   */
  private findRootResponderId(): string | null {
    for (const [rootId, rootNode] of this.nodes) {
      if (rootNode.parentId === null) return rootId;
    }
    return null;
  }

  // ---- First responder management ----

  /** Sets firstResponderId, increments validationVersion, notifies subscribers. */
  makeFirstResponder(id: string): void {
    this.firstResponderId = id;
    this.syncFirstResponderDomAttribute();
    this.incrementAndNotify();
  }

  /** Clears firstResponderId, increments validationVersion, notifies subscribers. */
  resignFirstResponder(): void {
    this.firstResponderId = null;
    this.syncFirstResponderDomAttribute();
    this.incrementAndNotify();
  }

  /** Returns the current firstResponderId (or null if none). */
  getFirstResponder(): string | null {
    return this.firstResponderId;
  }

  /**
   * True when `id` is the current first responder, or is reachable by
   * walking `parentId` up from the first responder. False when the
   * first responder is unset, when the walk falls off the root, or
   * when the walk encounters an unregistered ancestor before reaching
   * `id`.
   *
   * Use case: idempotency guards on "promote a container to first
   * responder" operations. When the first responder is already
   * somewhere inside the container's subtree, promoting the container
   * would demote the inner responder for no benefit — and would
   * silently steal keyboard commands the user expects to reach the
   * inner responder. `setResponderChainKey` (in `card-lifecycle.ts`)
   * is the canonical example: clicking inside an already-active card
   * must not demote the card's editor.
   */
  firstResponderIsAtOrBelow(id: string): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      if (currentId === id) return true;
      const node = this.nodes.get(currentId);
      if (!node) return false;
      currentId = node.parentId;
    }
    return false;
  }

  // ---- Key responder of kind (derived) ----

  /**
   * Walk up `parentId` from the current first responder and return the
   * id of the nearest registered node whose `kind` matches. Returns
   * null if the first responder is unset, no ancestor matches, or the
   * walk falls off the root.
   *
   * The walk is inclusive of the first responder: if the first
   * responder itself was registered with the requested kind, its id is
   * returned without further walking.
   *
   * Untagged ancestors (`kind === undefined`) are skipped — they do
   * not terminate the walk. This is the property that lets a tier tag
   * mean "I am the nearest of my kind to whatever the user is doing"
   * regardless of how many untagged responders sit between the first
   * responder and the next tagged ancestor.
   *
   * No state is stored — the value is recomputed on every call. See
   * design doc Phase 1 for the design and the rationale for
   * keeping this derived rather than stored.
   */
  getKeyResponderOfKind(kind: ResponderKind): string | null {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      if (node.kind === kind) return currentId;
      currentId = node.parentId;
    }
    return null;
  }

  /**
   * Convenience wrapper over `getKeyResponderOfKind("card")`. The vast
   * majority of consumers want the active card; the
   * `getKeyResponderOfKind` form is the escape hatch for future tiers.
   */
  getKeyCard(): string | null {
    return this.getKeyResponderOfKind("card");
  }

  /**
   * Subscribe to changes in the derived key-responder-of-kind value.
   *
   * The callback fires *only when* the derived value differs from the
   * value seen at the previous notification — not on every chain
   * change. Initial subscription does not fire; callers read the
   * current value synchronously via `getKeyResponderOfKind(kind)` after
   * subscribing if they need it.
   *
   * Recomputation runs in `incrementAndNotify`, so the same code path
   * that drives `useSyncExternalStore` re-renders also drives this
   * observer. Returns an unsubscribe function.
   *
   * Most React consumers will use the higher-level
   * `useKeyCardId`/`useIsKeyCard` hooks (which use
   * `useSyncExternalStore` over the existing `subscribe` API). This
   * observer is for non-React consumers and for components that want
   * to react to transitions imperatively without re-rendering.
   */
  observeKeyResponder(
    kind: ResponderKind,
    callback: KeyResponderObserver,
  ): () => void {
    const subscription: KeyResponderSubscription = {
      kind,
      callback,
      lastValue: this.getKeyResponderOfKind(kind),
    };
    this.keyResponderSubscriptions.add(subscription);
    return () => {
      this.keyResponderSubscriptions.delete(subscription);
    };
  }

  // ---- Action dispatch ----

  /**
   * Walk the chain from a specified starting node upward via parentId,
   * invoking the first matching handler and capturing any continuation
   * it returns. This is the shared implementation for all four dispatch
   * entry points. The only thing those methods differ on is which node
   * the walk starts at and how they report the result.
   *
   * The four public methods form a 2x2 matrix:
   *
   *   |                    | boolean return         | DispatchResult return                    |
   *   |--------------------|------------------------|------------------------------------------|
   *   | **First responder**| sendToFirstResponder   | sendToFirstResponderForContinuation      |
   *   | **Named target**   | sendToTarget           | sendToTargetForContinuation              |
   *
   * Observer notification and console logging are NOT performed here —
   * the entry point methods call `notifyDispatchObservers` and
   * `logDispatch` after the walk so each method can arrange its own
   * error-handling without duplicating the walk itself.
   *
   * `startId` may be null, in which case the walk is vacuous and the
   * result is `handled: false`. This is the correct outcome when
   * `dispatch` is called with no first responder set.
   */
  private walkFromNode(
    startId: string | null,
    event: ActionEvent,
  ): { handled: boolean; continuation?: () => void; handledBy: string | null } {
    let currentId: string | null = startId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      const handler = lookupHandler(node, event.action);
      if (handler !== undefined) {
        const result = handler(event);
        return {
          handled: true,
          continuation: typeof result === "function" ? result : undefined,
          handledBy: currentId,
        };
      }
      currentId = node.parentId;
    }
    return { handled: false, handledBy: null };
  }

  /**
   * Dispatch an action through the chain and return both whether it was
   * handled and any continuation callback returned by the handler.
   *
   * Walks from the first responder upward via parentId. For each node,
   * checks `event.action` in the actions map only (not the canHandle
   * function). If the action key exists, calls the handler with the
   * full ActionEvent and captures its return value; if the return value
   * is a function, it becomes the continuation. Continues to parent if
   * not found.
   *
   * After the walk (handled or not), every dispatch observer is
   * notified — enabling "close on any action" patterns for context
   * menus and similar transient UIs.
   *
   * Note: canHandle is advisory for validation queries only and is
   * never consulted during dispatch.
   *
   * [D01] ActionEvent is the sole dispatch currency
   * [D02] Handlers may return continuations for two-phase execution
   * (#s02-dispatch-method)
   */
  sendToFirstResponderForContinuation<Extra extends string = never>(
    event: ActionEvent<Extra>,
  ): DispatchResult {
    const { handled, continuation, handledBy } = this.walkFromNode(
      this.firstResponderId,
      event as ActionEvent,
    );
    this.notifyDispatchObservers(event as ActionEvent, handled);
    this.logDispatch(event as ActionEvent, handled, handledBy);
    return { handled, continuation };
  }

  /**
   * Dispatch an action to the first responder. Boolean-return wrapper around
   * sendToFirstResponderForContinuation for callers that don't need the continuation.
   *
   * [D01] ActionEvent is the sole dispatch currency
   * (#s02-dispatch-method)
   */
  sendToFirstResponder<Extra extends string = never>(event: ActionEvent<Extra>): boolean {
    return this.sendToFirstResponderForContinuation(event).handled;
  }

  // ---- Validation queries ----

  /**
   * Query whether any responder in the chain can handle the given action.
   *
   * Walks from the first responder upward. For each node:
   * 1. Check the actions map (primary path) -- if the key exists, return true.
   * 2. Check the node's optional canHandle function (dynamic override) -- if
   *    it returns true, return true.
   * Continues to parent if neither matches. Returns false if root reached.
   */
  canHandle<Extra extends string = never>(action: TugAction<Extra>): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      if (lookupHandler(node, action) !== undefined) return true;
      if (node.canHandle && node.canHandle(action as TugAction)) return true;
      currentId = node.parentId;
    }
    return false;
  }

  /**
   * Query whether the action is currently enabled.
   *
   * Walks the chain to find the responder via canHandle logic. Calls that
   * responder's validateAction function if present; defaults to true if not.
   * Returns false if no responder can handle the action.
   */
  validateAction<Extra extends string = never>(action: TugAction<Extra>): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      const handles =
        lookupHandler(node, action) !== undefined ||
        (node.canHandle ? node.canHandle(action as TugAction) : false);
      if (handles) {
        return node.validateAction
          ? node.validateAction(action as TugAction)
          : true;
      }
      currentId = node.parentId;
    }
    return false;
  }

  // ---- Explicit-target dispatch ----

  /**
   * Dispatch an action through the chain, starting the walk at a
   * specific registered node instead of at the current first responder.
   *
   * The walk otherwise behaves identically to `dispatch` — if the target
   * node itself handles the action, its handler runs and the walk stops
   * there; if not, the walk continues upward via `parentId` until some
   * ancestor handles it, or falls off the root with `handled: false`.
   *
   * Throws if `targetId` is not registered. That is a programming error:
   * the emitter has a stale reference and should be fixed upstream, not
   * silently no-oped. If you specifically want "deliver to this one
   * node and do nothing if it doesn't handle" behavior, check
   * `nodeCanHandle(targetId, action)` before calling.
   *
   * Why a walking target dispatch: the emitter knows the approximate
   * scope the event should reach (e.g. "this specific card") but
   * doesn't need to know exactly which node in that scope owns the
   * action's state. The gallery inspector dispatches `setProperty` "to
   * the card," and the walk starts at the card — whether the card
   * itself owns the PropertyStore or delegates to a wrapper above it,
   * the chain finds the handler without the inspector having to know
   * the target's internal shape.
   *
   * Note: canHandle is advisory for validation queries only and is never
   * consulted during sendToTarget.
   *
   * [D03] sendToTarget throws on unregistered target
   * (#s03-dispatch-to-method)
   */
  sendToTarget<Extra extends string = never>(
    targetId: string,
    event: ActionEvent<Extra>,
  ): boolean {
    return this.sendToTargetForContinuation(targetId, event).handled;
  }

  /**
   * Dispatch an ActionEvent through the chain starting at a named target
   * and return both the handled flag and the optional continuation
   * callback — the sibling to `sendToFirstResponderForContinuation` for
   * target-scoped dispatches.
   *
   * Same walk semantics as `sendToTarget` (starts at the named node and
   * walks upward via parentId until a handler matches or the walk falls
   * off the root) and same error handling (throws if `targetId` is not
   * registered). Callers that want two-phase execution use this method
   * and invoke the returned continuation at their commit point.
   */
  sendToTargetForContinuation<Extra extends string = never>(
    targetId: string,
    event: ActionEvent<Extra>,
  ): DispatchResult {
    if (!this.nodes.has(targetId)) {
      throw new Error(`sendToTargetForContinuation: target "${targetId}" is not registered`);
    }
    const { handled, continuation, handledBy } = this.walkFromNode(
      targetId,
      event as ActionEvent,
    );
    this.notifyDispatchObservers(event as ActionEvent, handled);
    this.logDispatch(event as ActionEvent, handled, handledBy);
    return { handled, continuation };
  }

  // ---- Key-card dispatch ----

  /**
   * Dispatch an action to the key card's content-scope responder — the
   * `kind: "card-content"` node that lives inside the key card's DOM
   * subtree. This is the routing used by keybindings with
   * `scope: "key-card"`: shortcuts scoped to "whichever card the user
   * is currently in" that each card type's body declares handlers for.
   *
   * The walk starts at the card-content responder and goes up via
   * parentId, so content-scope handlers win; unhandled actions fall
   * through to the card-level responder, the canvas, and up. Returns
   * `{ handled: false }` if there is no key card, or if the key card
   * has no descendant `card-content` responder.
   *
   * The card-content node is located by walking the DOM subtree under
   * the card's `data-responder-id` element; the first descendant whose
   * `data-responder-id` resolves to a node of `kind === "card-content"`
   * wins. Zero per-card registration is required — any `useResponder`
   * call that passes `kind: "card-content"` and whose element is
   * rendered inside the card's DOM makes this route work.
   */
  sendToKeyCardForContinuation<Extra extends string = never>(
    event: ActionEvent<Extra>,
  ): DispatchResult {
    const contentId = this.findKeyCardContentId();
    if (contentId === null) {
      this.notifyDispatchObservers(event as ActionEvent, false);
      this.logDispatch(event as ActionEvent, false, null);
      return { handled: false };
    }
    const { handled, continuation, handledBy } = this.walkFromNode(
      contentId,
      event as ActionEvent,
    );
    this.notifyDispatchObservers(event as ActionEvent, handled);
    this.logDispatch(event as ActionEvent, handled, handledBy);
    return { handled, continuation };
  }

  /**
   * Boolean-return wrapper over `sendToKeyCardForContinuation` for
   * callers that don't need the continuation.
   */
  sendToKeyCard<Extra extends string = never>(event: ActionEvent<Extra>): boolean {
    return this.sendToKeyCardForContinuation(event).handled;
  }

  /**
   * Locate the key card's `card-content` responder id, if any.
   * Algorithm:
   *   1. `getKeyCard()` to identify the active card.
   *   2. Look up the card's DOM element via its `data-responder-id`.
   *   3. Walk its descendants; for each `[data-responder-id]`, check
   *      whether the node's kind is `"card-content"`.
   *   4. Return the first match, or null.
   *
   * No document / no key card / no content-scope descendant → null.
   */
  private findKeyCardContentId(): string | null {
    const cardId = this.getKeyCard();
    if (cardId === null || typeof document === "undefined") return null;
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(cardId)
        : cardId;
    const cardEl = document.querySelector(
      `[data-responder-id="${escapedId}"]`,
    );
    if (cardEl === null) return null;
    const descendants = cardEl.querySelectorAll<HTMLElement>(
      "[data-responder-id]",
    );
    for (const el of descendants) {
      const id = el.getAttribute("data-responder-id");
      if (id === null) continue;
      const node = this.nodes.get(id);
      if (node && node.kind === "card-content") return id;
    }
    return null;
  }

  // ---- Target-based first-responder resolution ----

  /**
   * Walk the DOM from `target` upward looking for the nearest ancestor
   * (inclusive of the target itself) that carries a `data-responder-id`
   * attribute whose value is a registered responder node. Returns the
   * id, or null if no registered responder is found along the path.
   *
   * Used by ResponderChainProvider's document-level pointerdown
   * listener to promote the "innermost responder under the event
   * target" to first responder. This is what makes nested responders
   * compose naturally: clicking inside an editor that lives inside a
   * card makes the editor the first responder, not the card, without
   * any per-component wiring.
   *
   * Registration of `data-responder-id` is done by `useResponder`'s
   * `responderRef` callback; callers must attach that ref to their
   * root DOM element for this lookup to find them.
   */
  findResponderForTarget(target: Node | null): string | null {
    let el: Element | null =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
    while (el) {
      const id = el.getAttribute("data-responder-id");
      if (id && this.nodes.has(id)) {
        return id;
      }
      el = el.parentElement;
    }
    return null;
  }

  // ---- Per-node capability query ----

  /**
   * Query whether a specific registered node can handle the given action.
   *
   * Checks the node's actions map first, then the optional canHandle function.
   * Returns false if the node is not registered.
   *
   * [D07] nodeCanHandle for per-node capability query
   * (#s07-node-can-handle)
   */
  nodeCanHandle<Extra extends string = never>(
    nodeId: string,
    action: TugAction<Extra>,
  ): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    if (lookupHandler(node, action) !== undefined) return true;
    if (node.canHandle && node.canHandle(action as TugAction)) return true;
    return false;
  }

  // ---- Default button stack ----

  /**
   * Push a default button onto the stack.
   *
   * The most recently pushed button is the active default button. Supports
   * nested modal scoping: inner modals push their button on open and pop it
   * on close, restoring the outer button automatically.
   *
   * [D01] Stack semantics for nested modal scoping
   */
  pushDefaultButton(element: HTMLButtonElement): void {
    this.defaultButtonStack.push(element);
  }

  /**
   * Remove a specific button from the stack by reference.
   *
   * Uses strict reference equality (===) to find the last occurrence of the
   * element via lastIndexOf and removes exactly one instance. No-op if the
   * element is not found on the stack.
   *
   * [D01] Reference-based removal
   * [R02] Defensive: no-op if not found
   */
  popDefaultButton(element: HTMLButtonElement): void {
    const index = this.defaultButtonStack.lastIndexOf(element);
    if (index !== -1) {
      this.defaultButtonStack.splice(index, 1);
    }
  }

  /**
   * Return the topmost default button, or null if the stack is empty.
   *
   * [D01] Most recent registration wins
   */
  peekDefaultButton(): HTMLButtonElement | null {
    return this.defaultButtonStack[this.defaultButtonStack.length - 1] ?? null;
  }

  // ---- Subscription (for useSyncExternalStore) ----

  /**
   * Subscribe to chain state changes.
   *
   * The callback fires whenever validationVersion increments (focus change,
   * register, unregister). Returns an unsubscribe function.
   */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Returns the current validationVersion for useSyncExternalStore snapshots. */
  getValidationVersion(): number {
    return this.validationVersion;
  }

  // ---- Dispatch observers ----

  /**
   * Subscribe to every action flowing through the chain.
   *
   * The callback fires after every `sendToFirstResponder`,
   * `sendToTarget`, and their ForContinuation siblings — whether the
   * event was handled or not. The
   * `handled` argument reports the final outcome. Returns an
   * unsubscribe function.
   *
   * Use case: a transient UI (e.g. a context menu) that needs to close
   * itself whenever unrelated action traffic flows through the chain.
   * The observer can filter by action name or sender.
   */
  observeDispatch(callback: DispatchObserver): () => void {
    this.dispatchObservers.add(callback);
    return () => {
      this.dispatchObservers.delete(callback);
    };
  }

  // ---- Private helpers ----

  private incrementAndNotify(): void {
    this.validationVersion += 1;
    for (const cb of this.subscribers) {
      cb();
    }
    this.notifyKeyResponderObservers();
  }

  /**
   * Recompute the derived key-responder-of-kind value for every
   * subscription and fire the callback only if it differs from the
   * value the subscription was last notified about.
   *
   * Snapshotted to a local array first so a callback that
   * unsubscribes itself during notification doesn't mutate the set
   * mid-iteration — same defensive pattern as
   * `notifyDispatchObservers`.
   */
  private notifyKeyResponderObservers(): void {
    if (this.keyResponderSubscriptions.size === 0) return;
    const subs = Array.from(this.keyResponderSubscriptions);
    for (const sub of subs) {
      const current = this.getKeyResponderOfKind(sub.kind);
      if (current !== sub.lastValue) {
        sub.lastValue = current;
        sub.callback(current);
      }
    }
  }

  private notifyDispatchObservers(event: ActionEvent, handled: boolean): void {
    // Snapshot to a local array so observers that unsubscribe themselves
    // during notification don't mutate the set mid-iteration.
    const observers = Array.from(this.dispatchObservers);
    for (const obs of observers) {
      obs(event, handled);
    }
  }

  /**
   * Log every dispatch to the console with a gray prefix so developers
   * can see what's flowing through the chain in real time. Includes
   * the action name, sender (if present), value (if present), whether
   * it was handled, and which responder handled it. Filter the console
   * for `[responder-chain] dispatch` to see only chain traffic.
   *
   * Gated on `window.__tugChainDebug === true`. Default: off. Toggle
   * from devtools at any time:
   *
   *     window.__tugChainDebug = true;   // enable chain logs
   *     window.__tugChainDebug = false;  // silence them again
   *
   * The opt-in default keeps the console clean when debugging things
   * outside the responder chain. One-line opt-in from devtools turns
   * the firehose back on whenever needed.
   */
  private logDispatch(event: ActionEvent, handled: boolean, handledBy: string | null): void {
    if (typeof console === "undefined") return;
    if (!isChainDebugEnabled()) return;
    const senderPart = event.sender !== undefined ? ` sender=${JSON.stringify(event.sender)}` : "";
    const valuePart = event.value !== undefined ? ` value=${JSON.stringify(event.value)}` : "";
    const outcomePart = handled
      ? `handled by ${handledBy}`
      : "unhandled";
    // eslint-disable-next-line no-console
    console.log(
      `%c[responder-chain] dispatch %c${event.action}%c${senderPart}${valuePart} %c(${outcomePart})`,
      "color:#888",
      "color:inherit;font-weight:600",
      "color:#888",
      handled ? "color:#4a7" : "color:#c55",
    );
  }

  /**
   * Sync the `data-first-responder` attribute on the DOM so exactly one
   * element in the document carries it at any instant — specifically,
   * the element whose `data-responder-id` matches the current
   * `firstResponderId`. Called from every method that changes
   * `firstResponderId`.
   *
   * The attribute's *value* is the responder id, not "true" — so the
   * DOM is self-describing. Searching devtools for
   * `[data-first-responder]` shows the attribute with its id
   * inline (e.g. `data-first-responder="editor-:r5:"`), and you can
   * immediately tell which responder the chain considers active
   * without having to cross-reference `data-responder-id`.
   *
   * A single `console.log` fires on every change with a gray-prefixed
   * marker and the DOM element as a second argument — devtools makes
   * the element clickable so you can jump to it in the Elements panel.
   * Filter the console for `[responder-chain]` to see the full
   * first-responder history, or mute it if it's too noisy for your
   * current workflow.
   *
   * Implementation: clear the attribute from any element that has it,
   * then find the element with the matching `data-responder-id` and
   * set it. DOM-free environments (server-side rendering, unit tests
   * without jsdom) are detected via `typeof document` and skipped
   * entirely — logging included.
   *
   * Cost: two `querySelector` calls per first-responder change,
   * bounded by document size. Negligible in practice.
   */
  private syncFirstResponderDomAttribute(): void {
    if (typeof document === "undefined") return;
    // Clear the previous marker. In normal operation there is at most
    // one, but we use querySelectorAll defensively in case something
    // external set the attribute.
    document.querySelectorAll<HTMLElement>("[data-first-responder]").forEach((el) => {
      el.removeAttribute("data-first-responder");
    });
    if (this.firstResponderId === null) {
      if (isChainDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.log("%c[responder-chain] first responder cleared", "color:#888");
      }
      return;
    }
    const id = this.firstResponderId;
    const escapedId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id;
    const el = document.querySelector<HTMLElement>(`[data-responder-id="${escapedId}"]`);
    if (el) {
      // Attribute value is the id itself, so searching devtools for
      // `[data-first-responder]` shows `data-first-responder="<id>"`
      // inline — no cross-referencing required.
      el.setAttribute("data-first-responder", id);
      if (isChainDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.log(`%c[responder-chain] first responder → %c${id}`, "color:#888", "color:inherit;font-weight:600", el);
      }
    } else {
      // No DOM element matches the id. This can happen if the
      // responder registered via useResponder but forgot to attach
      // responderRef, or if the responder was registered during a
      // render that hadn't committed yet. Either way, log a warning
      // so it surfaces during development.
      // eslint-disable-next-line no-console
      console.warn(`[responder-chain] first responder "${id}" has no matching [data-responder-id] element — did the caller attach responderRef?`);
    }
  }
}

// ---- React Contexts ----

/**
 * React context holding the singleton ResponderChainManager for the canvas
 * subtree. Default value is null (outside any provider).
 *
 * Co-located here so use-responder.ts and responder-chain-provider.tsx can
 * both import it without circular dependencies.
 */
export const ResponderChainContext =
  createContext<ResponderChainManager | null>(null);

/**
 * React context holding the nearest ancestor responder ID.
 *
 * Default is null (no parent -- caller is a root node).
 * Each useResponder call provides its own ID as the new value for its subtree
 * via ResponderScope, enabling automatic parent discovery without prop drilling.
 *
 * Controls read this to discover their dispatch target (useControlDispatch).
 * useResponder reads this to register with the correct parentId.
 *
 * Co-located with ResponderChainContext so both contexts live in the same
 * infrastructure module.
 */
export const ResponderParentContext = createContext<string | null>(null);
