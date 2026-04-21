/**
 * app-lifecycle.ts — Unified app-lifecycle event pipe.
 *
 * Eight lifecycle events, fired by the native host at well-defined
 * transitions of the macOS application:
 *
 *   1. applicationWillBecomeActive  — app is about to become frontmost.
 *   2. applicationDidBecomeActive   — app is now frontmost.
 *   3. applicationWillResignActive  — app is about to yield frontmost.
 *   4. applicationDidResignActive   — app is no longer frontmost.
 *   5. applicationWillHide          — app is about to be hidden.
 *   6. applicationDidHide           — app is hidden.
 *   7. applicationWillUnhide        — app is about to be un-hidden.
 *   8. applicationDidUnhide         — app is visible again.
 *
 * Per the lifecycle-delegates plan, these events are driven by the
 * Swift `NSApplicationDelegate` methods of the same name. Step 6
 * wires all eight in `tugapp/Sources/AppDelegate.swift`; Step 5
 * replaces the two pre-existing window-global RPC functions with a
 * single `app-lifecycle` control frame routed through
 * `action-dispatch.ts`.
 *
 * Subscribers register via `observeApplication{Will,Did}{BecomeActive,
 * ResignActive,Hide,Unhide}`. React components use the delegate-
 * object hook: `useAppDelegate({ applicationDidBecomeActive, ... })`.
 *
 * Timing:
 *   - All eight notifications fire SYNCHRONOUSLY at the lifecycle
 *     layer. Subscribers receive the event the instant it happens,
 *     in the same call stack as whatever triggered it.
 *   - React-integrated subscribers (`useAppDelegate`) defer their
 *     user callback via a setState → useEffect pipeline so side
 *     effects run AFTER React's post-commit paint. Same mechanism
 *     as `useCardDelegate` (see `lib/card-lifecycle.ts`). The
 *     reliability study in Step 10 of the plan will replace this
 *     deferral across both delegate hooks.
 *
 * Unlike card events, app events carry no per-target id — the app is
 * singular. Observers receive no argument; the fact of the event is
 * the payload.
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * Module-level toggle for app-lifecycle trace logs. Defaults to the
 * Vite `import.meta.env.DEV` flag: dev builds print every will/did
 * become-active/resign/hide/unhide transition; prod builds are
 * silent. Flip to `true` in source to capture a one-off trace without
 * flipping the build mode.
 */
const LIFECYCLE_LOG: boolean = Boolean(import.meta.env?.DEV);

/**
 * Observer callback shape for app-lifecycle events. No arguments —
 * the app is singular and the fact of the event is the payload.
 */
export type AppLifecycleObserver = () => void;

/**
 * The eight app-lifecycle event channels. Used internally to
 * discriminate subscriber sets and pending-event buffer entries.
 */
type AppEventName =
  | "applicationWillBecomeActive"
  | "applicationDidBecomeActive"
  | "applicationWillResignActive"
  | "applicationDidResignActive"
  | "applicationWillHide"
  | "applicationDidHide"
  | "applicationWillUnhide"
  | "applicationDidUnhide";

export class AppLifecycle {
  // One subscription set per event channel. Same pattern as
  // `CardLifecycle` — separate sets (rather than a single tagged
  // set) so iteration in notify is straightforward.
  private readonly subs: Record<AppEventName, Set<AppLifecycleObserver>> = {
    applicationWillBecomeActive: new Set(),
    applicationDidBecomeActive: new Set(),
    applicationWillResignActive: new Set(),
    applicationDidResignActive: new Set(),
    applicationWillHide: new Set(),
    applicationDidHide: new Set(),
    applicationWillUnhide: new Set(),
    applicationDidUnhide: new Set(),
  };

  // ---- Public notify entry points ----
  //
  // Called by `action-dispatch.ts` when an `app-lifecycle` control
  // frame arrives from the Swift host (Step 5 wires this). The
  // cascade layer (Step 7's `lib/lifecycle-cascade.ts`) also calls
  // these when it synthesizes app events in tests, and observes
  // them to drive card-lifecycle cascades.

  notifyApplicationWillBecomeActive(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationWillBecomeActive");
    this.fire("applicationWillBecomeActive");
  }

  notifyApplicationDidBecomeActive(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationDidBecomeActive");
    this.fire("applicationDidBecomeActive");
  }

  notifyApplicationWillResignActive(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationWillResignActive");
    this.fire("applicationWillResignActive");
  }

  notifyApplicationDidResignActive(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationDidResignActive");
    this.fire("applicationDidResignActive");
  }

  notifyApplicationWillHide(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationWillHide");
    this.fire("applicationWillHide");
  }

  notifyApplicationDidHide(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationDidHide");
    this.fire("applicationDidHide");
  }

  notifyApplicationWillUnhide(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationWillUnhide");
    this.fire("applicationWillUnhide");
  }

  notifyApplicationDidUnhide(): void {
    if (LIFECYCLE_LOG) console.log("[AppLifecycle] applicationDidUnhide");
    this.fire("applicationDidUnhide");
  }

  // ---- Observe ----
  //
  // Subscription APIs. No initial-sync — app lifecycle is strictly
  // transitional. Mount-time subscribers don't replay the most
  // recent event; if they need current state they should read it
  // from wherever it's authoritative (e.g., `document.hidden` for
  // the visibility approximation, though note that app-hidden is
  // distinct from tab-hidden).

  observeApplicationWillBecomeActive(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationWillBecomeActive", cb);
  }

  observeApplicationDidBecomeActive(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationDidBecomeActive", cb);
  }

  observeApplicationWillResignActive(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationWillResignActive", cb);
  }

  observeApplicationDidResignActive(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationDidResignActive", cb);
  }

  observeApplicationWillHide(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationWillHide", cb);
  }

  observeApplicationDidHide(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationDidHide", cb);
  }

  observeApplicationWillUnhide(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationWillUnhide", cb);
  }

  observeApplicationDidUnhide(cb: AppLifecycleObserver): () => void {
    return this.subscribe("applicationDidUnhide", cb);
  }

  // ---- Internals ----

  private subscribe(
    event: AppEventName,
    cb: AppLifecycleObserver,
  ): () => void {
    const set = this.subs[event];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private fire(event: AppEventName): void {
    for (const cb of this.subs[event]) {
      try {
        cb();
      } catch (err) {
        console.error(`AppLifecycle ${event} observer threw:`, err);
      }
    }
  }
}

// ---- Module-level singleton for cross-provider bootstrapping ----

/**
 * Current process-wide `AppLifecycle` instance, registered by
 * `DeckManager` at construction so non-React subscribers (notably
 * the Step 5 `action-dispatch.ts` control-frame handler, which
 * routes `app-lifecycle` frames to the correct `notifyApplication*`
 * method) can find the instance without threading a prop or a
 * context.
 *
 * Last-registration-wins: mirrors `registerCardLifecycle` in
 * `card-lifecycle.ts`. Intentionally nullable so tests that don't
 * construct a DeckManager see `null`.
 */
let appLifecycleRef: AppLifecycle | null = null;

export function registerAppLifecycle(lifecycle: AppLifecycle | null): void {
  appLifecycleRef = lifecycle;
}

export function getAppLifecycle(): AppLifecycle | null {
  return appLifecycleRef;
}

// ---- React integration ----

/**
 * Context holding the process-wide `AppLifecycle` instance.
 * Consumers outside any provider receive `null` and should no-op
 * cleanly — production always has a provider; tests opt in when
 * they're exercising lifecycle-driven behavior.
 */
export const AppLifecycleContext = createContext<AppLifecycle | null>(null);

export function useAppLifecycle(): AppLifecycle | null {
  return useContext(AppLifecycleContext);
}

/**
 * Delegate protocol for app-lifecycle events.
 *
 * Apple-style: a single object with optional methods, supplied to
 * `useAppDelegate(delegate)`. Missing methods are no-ops.
 */
export interface TugAppDelegate {
  applicationWillBecomeActive?(): void;
  applicationDidBecomeActive?(): void;
  applicationWillResignActive?(): void;
  applicationDidResignActive?(): void;
  applicationWillHide?(): void;
  applicationDidHide?(): void;
  applicationWillUnhide?(): void;
  applicationDidUnhide?(): void;
}

// ---- MessageChannel-based delegate drain queue ----
//
// Same mechanism as `card-lifecycle.ts`. See that file's banner for
// the full rationale; this module keeps its own queue so the two
// delegate paths don't interleave on a shared message port.

type AppDelegateCall = () => void;
const appDelegateQueue: AppDelegateCall[] = [];
const appDelegateChannel: MessageChannel =
  typeof MessageChannel !== "undefined" ? new MessageChannel() : (null as unknown as MessageChannel);

if (appDelegateChannel !== null) {
  appDelegateChannel.port1.onmessage = (): void => {
    const pending = appDelegateQueue.splice(0);
    for (const fn of pending) {
      try {
        fn();
      } catch (err) {
        console.error("[AppLifecycle] delegate callback threw:", err);
      }
    }
  };
}

function scheduleAppDelegateCall(fn: AppDelegateCall): void {
  appDelegateQueue.push(fn);
  if (appDelegateChannel !== null) {
    appDelegateChannel.port2.postMessage(null);
  }
}

/**
 * `useAppDelegate` — subscribe a React component to app-lifecycle
 * events as a delegate.
 *
 * Architecture (mirrors `useCardDelegate`):
 *   - Subscriptions install in `useLayoutEffect` (L03).
 *   - One subscription per event channel is installed unconditionally;
 *     routing to a delegate method happens at drain time.
 *   - Observer callbacks enqueue closures onto the module-scope
 *     `MessageChannel` drain queue. The drain runs as the next
 *     macrotask, escaping WebKit's gesture focus-lock and independent
 *     of React's commit scheduling. See the reliability study for why.
 *
 * The delegate object is held in a ref so inline literals don't
 * re-install the subscription on every render.
 */
export function useAppDelegate(delegate: TugAppDelegate): void {
  const lifecycle = useAppLifecycle();

  // Live delegate ref — avoids re-subscribing when the caller
  // passes an inline object every render.
  const delegateRef = useRef(delegate);
  useLayoutEffect(() => {
    delegateRef.current = delegate;
  }, [delegate]);

  useLayoutEffect(() => {
    if (lifecycle === null) return;
    const enqueue = (event: AppEventName): void => {
      scheduleAppDelegateCall(() => {
        const fn = delegateRef.current[event];
        if (fn === undefined) return;
        try {
          fn();
        } catch (err) {
          console.error(`useAppDelegate ${event} threw:`, err);
        }
      });
    };
    const unsubs: Array<() => void> = [
      lifecycle.observeApplicationWillBecomeActive(() =>
        enqueue("applicationWillBecomeActive"),
      ),
      lifecycle.observeApplicationDidBecomeActive(() =>
        enqueue("applicationDidBecomeActive"),
      ),
      lifecycle.observeApplicationWillResignActive(() =>
        enqueue("applicationWillResignActive"),
      ),
      lifecycle.observeApplicationDidResignActive(() =>
        enqueue("applicationDidResignActive"),
      ),
      lifecycle.observeApplicationWillHide(() =>
        enqueue("applicationWillHide"),
      ),
      lifecycle.observeApplicationDidHide(() => enqueue("applicationDidHide")),
      lifecycle.observeApplicationWillUnhide(() =>
        enqueue("applicationWillUnhide"),
      ),
      lifecycle.observeApplicationDidUnhide(() =>
        enqueue("applicationDidUnhide"),
      ),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [lifecycle]);
}
