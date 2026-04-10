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
 * Spec S01, Spec S06, Spec S07
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
 * Spec S01 (#s01-action-event-type)
 */
export type ActionPhase = "discrete" | "begin" | "change" | "commit" | "cancel";

/**
 * Typed action event -- the sole dispatch currency.
 *
 * All dispatch call sites produce an ActionEvent. All action handlers receive
 * a full ActionEvent, even for discrete (button click) actions.
 *
 * [D01] ActionEvent is the sole dispatch currency
 * [D02] Handler signature is (event: ActionEvent) => void | (() => void)
 * Spec S01 (#s01-action-event-type)
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
 * Callers that need the continuation use `dispatchForContinuation`.
 * `dispatch` discards it and just reports handled/unhandled.
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
 * Spec S04 (#s04-responder-node-actions)
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
 * Result of dispatchForContinuation — whether the event was handled and,
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
 * dispatchForContinuation, or dispatchTo — whether or not a handler
 * matched. `handled` reflects the final outcome. Use for components that
 * need to react to chain traffic (e.g. a context menu that closes on
 * any external action).
 */
export type DispatchObserver = (event: ActionEvent, handled: boolean) => void;

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

      this.firstResponderId = nextFirst;
      this.syncFirstResponderDomAttribute();
      this.incrementAndNotify();
    }
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

  // ---- Action dispatch ----

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
   * Spec S02 (#s02-dispatch-method)
   */
  dispatchForContinuation<Extra extends string = never>(
    event: ActionEvent<Extra>,
  ): DispatchResult {
    let handled = false;
    let continuation: (() => void) | undefined;
    let handledBy: string | null = null;

    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      const handler = lookupHandler(node, event.action);
      if (handler !== undefined) {
        const result = handler(event as ActionEvent);
        if (typeof result === "function") {
          continuation = result;
        }
        handled = true;
        handledBy = currentId;
        break;
      }
      currentId = node.parentId;
    }

    this.notifyDispatchObservers(event as ActionEvent, handled);
    this.logDispatch(event as ActionEvent, handled, handledBy);
    return { handled, continuation };
  }

  /**
   * Dispatch an action through the chain. Boolean-return wrapper around
   * dispatchForContinuation for callers that don't need the continuation.
   *
   * [D01] ActionEvent is the sole dispatch currency
   * Spec S02 (#s02-dispatch-method)
   */
  dispatch<Extra extends string = never>(event: ActionEvent<Extra>): boolean {
    return this.dispatchForContinuation(event).handled;
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
   * Dispatch an action directly to a specific registered node by ID.
   *
   * Unlike dispatch(), this does not walk the chain -- it delivers the event
   * directly to the named target. If the target is not registered, throws an
   * Error with a descriptive message. If the target is registered but does not
   * handle the action (action key not in its actions map), returns false.
   *
   * Note: canHandle is advisory for validation queries only and is never
   * consulted during dispatchTo.
   *
   * [D03] dispatchTo throws on unregistered target
   * Spec S03 (#s03-dispatch-to-method)
   */
  dispatchTo<Extra extends string = never>(
    targetId: string,
    event: ActionEvent<Extra>,
  ): boolean {
    const node = this.nodes.get(targetId);
    if (!node) {
      throw new Error(`dispatchTo: target "${targetId}" is not registered`);
    }
    let handled = false;
    const handler = lookupHandler(node, event.action);
    if (handler !== undefined) {
      handler(event as ActionEvent);
      handled = true;
    }
    this.notifyDispatchObservers(event as ActionEvent, handled);
    return handled;
  }

  /**
   * Dispatch an ActionEvent directly to a named target and return both the
   * handled flag and the optional continuation callback — the sibling to
   * dispatchForContinuation for target-scoped dispatches.
   *
   * Same target-resolution semantics as `dispatchTo` (throws on unregistered
   * target, returns `handled: false` when the node has no handler for the
   * action). Callers that want two-phase execution use this method and
   * invoke the returned continuation at their commit point.
   */
  dispatchToForContinuation<Extra extends string = never>(
    targetId: string,
    event: ActionEvent<Extra>,
  ): DispatchResult {
    const node = this.nodes.get(targetId);
    if (!node) {
      throw new Error(`dispatchTo: target "${targetId}" is not registered`);
    }
    let handled = false;
    let continuation: (() => void) | undefined;
    const handler = lookupHandler(node, event.action);
    if (handler !== undefined) {
      const result = handler(event as ActionEvent);
      if (typeof result === "function") {
        continuation = result;
      }
      handled = true;
    }
    this.notifyDispatchObservers(event as ActionEvent, handled);
    return { handled, continuation };
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
   * Spec S07 (#s07-node-can-handle)
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
  setDefaultButton(element: HTMLButtonElement): void {
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
  clearDefaultButton(element: HTMLButtonElement): void {
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
  getDefaultButton(): HTMLButtonElement | null {
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
   * The callback fires after every `dispatch`, `dispatchForContinuation`,
   * and `dispatchTo` call — whether the event was handled or not. The
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
   * for `[responder-chain] dispatch` to see only chain traffic and
   * mute the existing first-responder transition logs.
   *
   * Noise budget: one log per user-initiated action (click, key, menu
   * selection). That's the same cadence as user interactions — not a
   * firehose. If it ever becomes a problem we can gate it on a
   * `window.__tugChainDebug` flag, but for now the signal is high
   * enough to justify always-on.
   */
  private logDispatch(event: ActionEvent, handled: boolean, handledBy: string | null): void {
    if (typeof console === "undefined") return;
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
      // eslint-disable-next-line no-console
      console.log("%c[responder-chain] first responder cleared", "color:#888");
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
      // eslint-disable-next-line no-console
      console.log(`%c[responder-chain] first responder → %c${id}`, "color:#888", "color:inherit;font-weight:600", el);
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

// ---- ResponderChainContext ----

/**
 * React context holding the singleton ResponderChainManager for the canvas
 * subtree. Default value is null (outside any provider).
 *
 * Co-located here so use-responder.ts and responder-chain-provider.tsx can
 * both import it without circular dependencies.
 */
export const ResponderChainContext =
  createContext<ResponderChainManager | null>(null);
