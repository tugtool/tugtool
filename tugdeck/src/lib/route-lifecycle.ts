/**
 * route-lifecycle — the per-prompt-entry route-change pipe.
 *
 * `RouteLifecycle` is the route-scoped sibling of the deck's
 * `CardLifecycle`. Where `CardLifecycle` surfaces six framework-driven
 * card moments, `RouteLifecycle` surfaces one route moment — the change
 * — as a will/did pair, and holds the current route as queryable state.
 *
 * One instance per `TugPromptEntry`; provided to that entry's subtree
 * through `RouteLifecycleContext`. It is not deck-level — each Tide card
 * has its own route ([D01]).
 *
 * Two surfaces, one fire path ([D03]):
 *
 *   - **Store surface** — `subscribe` + `getRoute`. Drives
 *     `useSyncExternalStore`; this is how renderers read the route
 *     ([L02]). `getRoute` is the authoritative route ([D02]).
 *   - **Delegate / observer surface** — `observeRouteWillChange` /
 *     `observeRouteDidChange` and the `useRouteDelegate` hook. Fires
 *     **synchronously** in the `setRoute` call stack — no
 *     `MessageChannel` drain: route consumers re-render, they do not do
 *     gesture-surviving focus work, so synchronous dispatch is correct
 *     and simpler ([D03]).
 *
 * The store surface answers "what is the route now"; the delegate
 * surface answers "the route changed". The delegate surface is purely
 * transitional — it has no initial-sync replay; a `useRouteDelegate`
 * that mounts after a change is not given a synthetic fire. Read the
 * current route through the store surface (`useRoute`).
 *
 * @module lib/route-lifecycle
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Delegate protocol for route changes.
 *
 * Apple-style: a single object with optional methods, supplied to
 * {@link useRouteDelegate}. Missing methods are no-ops. Unlike
 * `TugCardDelegate`, the methods carry the `(prev, next)` pair — the
 * route value *is* the event's information, and there is no separate
 * store to read the old value from after the fact ([D03]).
 */
export interface TugRouteDelegate {
  /** The route is about to change. Fires before the commit — `getRoute()` still returns `prev`. */
  routeWillChange?(prev: string, next: string): void;
  /** The route has changed. Fires after the commit — `getRoute()` returns `next`. */
  routeDidChange?(prev: string, next: string): void;
}

/** A raw route-change observer — the delegate surface's lower level. */
export type RouteChangeObserver = (prev: string, next: string) => void;

/**
 * The per-prompt-entry route-change pipe ([D01]–[D03]).
 *
 * Owns the authoritative route ([D02]). `subscribe` and `getRoute` are
 * stable, pre-bound references — safe to hand straight to
 * `useSyncExternalStore`; a `string` snapshot is referentially stable
 * by value.
 */
export class RouteLifecycle {
  private route: string;
  private readonly storeListeners = new Set<() => void>();
  private readonly willChangeObservers = new Set<RouteChangeObserver>();
  private readonly didChangeObservers = new Set<RouteChangeObserver>();

  /** Seed the lifecycle with the restored or default route. */
  constructor(initialRoute: string) {
    this.route = initialRoute;
  }

  // ── Store surface ([L02]) ────────────────────────────────────────────────

  /**
   * Subscribe to route commits. Returns an unsubscribe function. The
   * listener fires after the route has committed — paired with
   * {@link getRoute} this is the `useSyncExternalStore` store surface.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.storeListeners.add(listener);
    return () => {
      this.storeListeners.delete(listener);
    };
  };

  /** The current, authoritative route. Stable `useSyncExternalStore` snapshot. */
  getRoute = (): string => this.route;

  // ── Delegate / observer surface ([D03]) ──────────────────────────────────

  /**
   * Observe the pre-commit moment. The observer fires synchronously in
   * the `setRoute` call stack, before the commit — `getRoute()` still
   * returns `prev`. Returns an unsubscribe function.
   */
  observeRouteWillChange(observer: RouteChangeObserver): () => void {
    this.willChangeObservers.add(observer);
    return () => {
      this.willChangeObservers.delete(observer);
    };
  }

  /**
   * Observe the post-commit moment. The observer fires synchronously in
   * the `setRoute` call stack, after the commit — `getRoute()` returns
   * `next`. Returns an unsubscribe function.
   */
  observeRouteDidChange(observer: RouteChangeObserver): () => void {
    this.didChangeObservers.add(observer);
    return () => {
      this.didChangeObservers.delete(observer);
    };
  }

  // ── Mutation ─────────────────────────────────────────────────────────────

  /**
   * Change the route. Runs the will → commit → did sequence:
   *
   *   1. `routeWillChange(prev, next)` observers fire — route still `prev`.
   *   2. The route commits and store-surface listeners are notified.
   *   3. `routeDidChange(prev, next)` observers fire — route now `next`.
   *
   * Setting the route to its current value is a no-op on every channel.
   */
  setRoute(next: string): void {
    const prev = this.route;
    if (next === prev) return;
    this.fire(this.willChangeObservers, prev, next);
    this.route = next;
    this.notifyStore();
    this.fire(this.didChangeObservers, prev, next);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private notifyStore(): void {
    for (const listener of [...this.storeListeners]) {
      try {
        listener();
      } catch (err) {
        console.error("RouteLifecycle store listener threw:", err);
      }
    }
  }

  private fire(
    observers: Set<RouteChangeObserver>,
    prev: string,
    next: string,
  ): void {
    // Snapshot the set so an observer that subscribes or unsubscribes
    // mid-fire does not perturb this dispatch.
    for (const observer of [...observers]) {
      try {
        observer(prev, next);
      } catch (err) {
        console.error("RouteLifecycle observer threw:", err);
      }
    }
  }
}

// ── React integration ─────────────────────────────────────────────────────

/**
 * Context carrying the prompt-entry's {@link RouteLifecycle}. Consumers
 * outside any provider receive `null` and should no-op cleanly — the
 * provider is `TugPromptEntry`; tests opt in when exercising route
 * behavior.
 */
export const RouteLifecycleContext = createContext<RouteLifecycle | null>(null);

/** The {@link RouteLifecycle} from context, or `null` outside a provider. */
export function useRouteLifecycle(): RouteLifecycle | null {
  return useContext(RouteLifecycleContext);
}

/**
 * Subscribe a component to the current route ([L02]). Returns the
 * route, or `null` outside a `RouteLifecycleContext` provider.
 */
export function useRoute(): string | null {
  const lifecycle = useRouteLifecycle();
  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      lifecycle === null ? () => {} : lifecycle.subscribe(listener),
    [lifecycle],
  );
  const getSnapshot = useCallback(
    (): string | null => lifecycle?.getRoute() ?? null,
    [lifecycle],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Subscribe a component to route changes as a {@link TugRouteDelegate}.
 *
 * Both channels install in `useLayoutEffect` so the subscription is
 * ready before any `setRoute` can fire ([L03]). The delegate methods
 * run **synchronously** in the `setRoute` call stack ([D03]). The
 * delegate is held in a ref, so an inline literal does not re-install
 * the subscription on every render.
 *
 * No initial-sync: a delegate mounting after a change is not given a
 * synthetic fire. Read the current route via {@link useRoute}.
 */
export function useRouteDelegate(delegate: TugRouteDelegate): void {
  const lifecycle = useRouteLifecycle();

  // Live delegate ref — avoids re-subscribing when the caller passes
  // an inline object every render.
  const delegateRef = useRef(delegate);
  useLayoutEffect(() => {
    delegateRef.current = delegate;
  }, [delegate]);

  useLayoutEffect(() => {
    if (lifecycle === null) return;
    const unsubscribes = [
      lifecycle.observeRouteWillChange((prev, next) => {
        const fn = delegateRef.current.routeWillChange;
        if (fn === undefined) return;
        try {
          fn(prev, next);
        } catch (err) {
          console.error("useRouteDelegate routeWillChange threw:", err);
        }
      }),
      lifecycle.observeRouteDidChange((prev, next) => {
        const fn = delegateRef.current.routeDidChange;
        if (fn === undefined) return;
        try {
          fn(prev, next);
        } catch (err) {
          console.error("useRouteDelegate routeDidChange threw:", err);
        }
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [lifecycle]);
}
