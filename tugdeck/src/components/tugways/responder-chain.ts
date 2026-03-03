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
 */
export interface ResponderNode {
  id: string;
  parentId: string | null;
  actions: Record<string, () => void>;
  /**
   * Advisory capability override for validation queries only.
   * dispatch() never consults this -- only canHandle() and validateAction()
   * queries do. Use for runtime-determined capabilities not in the actions map.
   */
  canHandle?: (action: string) => boolean;
  validateAction?: (action: string) => boolean;
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
export class ResponderChainManager {
  private nodes: Map<string, ResponderNode> = new Map();
  private firstResponderId: string | null = null;
  private validationVersion = 0;
  private subscribers: Set<() => void> = new Set();

  // ---- Registration ----

  /**
   * Register a responder node.
   *
   * Auto-first-responder for root nodes: if the node's parentId is null and
   * firstResponderId is currently null, this root node becomes the first
   * responder automatically. Increments validationVersion and notifies
   * subscribers in that case.
   */
  register(node: ResponderNode): void {
    this.nodes.set(node.id, node);
    if (node.parentId === null && this.firstResponderId === null) {
      this.firstResponderId = node.id;
      this.incrementAndNotify();
    }
  }

  /**
   * Unregister a responder node.
   *
   * If the removed node was the first responder, auto-promotes its parent
   * (via parentId) to first responder. If the node has no parent, sets
   * firstResponderId to null. Always increments validationVersion and
   * notifies subscribers.
   */
  unregister(id: string): void {
    const node = this.nodes.get(id);
    this.nodes.delete(id);

    if (this.firstResponderId === id) {
      if (node && node.parentId !== null && this.nodes.has(node.parentId)) {
        this.firstResponderId = node.parentId;
      } else {
        this.firstResponderId = null;
      }
      this.incrementAndNotify();
    }
  }

  // ---- First responder management ----

  /** Sets firstResponderId, increments validationVersion, notifies subscribers. */
  makeFirstResponder(id: string): void {
    this.firstResponderId = id;
    this.incrementAndNotify();
  }

  /** Clears firstResponderId, increments validationVersion, notifies subscribers. */
  resignFirstResponder(): void {
    this.firstResponderId = null;
    this.incrementAndNotify();
  }

  /** Returns the current firstResponderId (or null if none). */
  getFirstResponder(): string | null {
    return this.firstResponderId;
  }

  // ---- Action dispatch ----

  /**
   * Dispatch an action through the chain.
   *
   * Walks from the first responder upward via parentId. For each node,
   * checks the actions map only (not the canHandle function). If the action
   * key exists, calls the handler and returns true. Continues to parent if
   * not found. Returns false if the root is reached with no match.
   *
   * Note: canHandle is advisory for validation queries only and is never
   * consulted during dispatch.
   */
  dispatch(action: string): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      if (action in node.actions) {
        node.actions[action]();
        return true;
      }
      currentId = node.parentId;
    }
    return false;
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
  canHandle(action: string): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      if (action in node.actions) return true;
      if (node.canHandle && node.canHandle(action)) return true;
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
  validateAction(action: string): boolean {
    let currentId: string | null = this.firstResponderId;
    while (currentId !== null) {
      const node = this.nodes.get(currentId);
      if (!node) break;
      const handles =
        action in node.actions ||
        (node.canHandle ? node.canHandle(action) : false);
      if (handles) {
        return node.validateAction ? node.validateAction(action) : true;
      }
      currentId = node.parentId;
    }
    return false;
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

  // ---- Private helpers ----

  private incrementAndNotify(): void {
    this.validationVersion += 1;
    for (const cb of this.subscribers) {
      cb();
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
