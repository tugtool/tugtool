/**
 * AppLifecycle unit tests.
 *
 * Pins the Step 4 invariants from the lifecycle-delegates plan:
 *   - Eight `notifyApplication*` methods fire matching observers
 *     synchronously.
 *   - Eight `observeApplication*` methods return disposable
 *     unsubscribers and carry no initial-sync (lifecycle is
 *     strictly transitional).
 *   - `useAppDelegate(delegate)` routes events to the matching
 *     delegate method via the post-paint deferral pattern.
 *   - Missing delegate methods are no-ops.
 *   - Inline delegate literals do not re-install subscriptions.
 */

import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  AppLifecycle,
  AppLifecycleContext,
  useAppDelegate,
} from "@/lib/app-lifecycle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushDeferred(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function wrapperFor(
  lifecycle: AppLifecycle | null,
): React.ComponentType<{ children: React.ReactNode }> {
  return function Wrapper({ children }) {
    return (
      <AppLifecycleContext.Provider value={lifecycle}>
        {children}
      </AppLifecycleContext.Provider>
    );
  };
}

// ---------------------------------------------------------------------------
// AppLifecycle — direct observer API
// ---------------------------------------------------------------------------

describe("AppLifecycle.notify*", () => {
  it("T-AL-01: notifyApplicationDidBecomeActive fires matching observers synchronously", () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];
    lifecycle.observeApplicationDidBecomeActive(() =>
      calls.push("didBecomeActive"),
    );

    lifecycle.notifyApplicationDidBecomeActive();

    expect(calls).toEqual(["didBecomeActive"]);
  });

  it("T-AL-02: observers only fire on their matching channel", () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];
    lifecycle.observeApplicationWillBecomeActive(() =>
      calls.push("willBecomeActive"),
    );
    lifecycle.observeApplicationDidBecomeActive(() =>
      calls.push("didBecomeActive"),
    );
    lifecycle.observeApplicationWillResignActive(() =>
      calls.push("willResignActive"),
    );
    lifecycle.observeApplicationDidResignActive(() =>
      calls.push("didResignActive"),
    );

    lifecycle.notifyApplicationDidBecomeActive();

    expect(calls).toEqual(["didBecomeActive"]);
  });

  it("T-AL-03: subscribe returns an unsubscriber that stops subsequent fires", () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];
    const unsub = lifecycle.observeApplicationDidHide(() => calls.push("hide"));

    lifecycle.notifyApplicationDidHide();
    unsub();
    lifecycle.notifyApplicationDidHide();

    expect(calls).toEqual(["hide"]);
  });

  it("T-AL-04: all eight notify methods exist and fire their channel", () => {
    const lifecycle = new AppLifecycle();
    const events: string[] = [];
    lifecycle.observeApplicationWillBecomeActive(() =>
      events.push("willBecomeActive"),
    );
    lifecycle.observeApplicationDidBecomeActive(() =>
      events.push("didBecomeActive"),
    );
    lifecycle.observeApplicationWillResignActive(() =>
      events.push("willResignActive"),
    );
    lifecycle.observeApplicationDidResignActive(() =>
      events.push("didResignActive"),
    );
    lifecycle.observeApplicationWillHide(() => events.push("willHide"));
    lifecycle.observeApplicationDidHide(() => events.push("didHide"));
    lifecycle.observeApplicationWillUnhide(() => events.push("willUnhide"));
    lifecycle.observeApplicationDidUnhide(() => events.push("didUnhide"));

    lifecycle.notifyApplicationWillBecomeActive();
    lifecycle.notifyApplicationDidBecomeActive();
    lifecycle.notifyApplicationWillResignActive();
    lifecycle.notifyApplicationDidResignActive();
    lifecycle.notifyApplicationWillHide();
    lifecycle.notifyApplicationDidHide();
    lifecycle.notifyApplicationWillUnhide();
    lifecycle.notifyApplicationDidUnhide();

    expect(events).toEqual([
      "willBecomeActive",
      "didBecomeActive",
      "willResignActive",
      "didResignActive",
      "willHide",
      "didHide",
      "willUnhide",
      "didUnhide",
    ]);
  });

  it("T-AL-05: a throwing observer does not prevent subsequent observers from firing", () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];
    lifecycle.observeApplicationDidBecomeActive(() => {
      throw new Error("boom");
    });
    lifecycle.observeApplicationDidBecomeActive(() => calls.push("second"));

    // Should not throw — errors are caught and logged.
    lifecycle.notifyApplicationDidBecomeActive();

    expect(calls).toEqual(["second"]);
  });
});

// ---------------------------------------------------------------------------
// useAppDelegate — React hook
// ---------------------------------------------------------------------------

describe("useAppDelegate", () => {
  it("T-AL-HOOK-01: delegate.applicationDidBecomeActive fires on notify (deferred)", async () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useAppDelegate({
          applicationDidBecomeActive: () => calls.push("didBecomeActive"),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyApplicationDidBecomeActive();
    });
    await flushDeferred();

    expect(calls).toEqual(["didBecomeActive"]);
  });

  it("T-AL-HOOK-02: missing delegate methods are no-ops", async () => {
    // Only applicationDidBecomeActive is defined; other events fire
    // but produce no delegate invocations.
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useAppDelegate({
          applicationDidBecomeActive: () => calls.push("didBecomeActive"),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyApplicationWillBecomeActive();
      lifecycle.notifyApplicationDidBecomeActive();
      lifecycle.notifyApplicationWillResignActive();
      lifecycle.notifyApplicationDidResignActive();
    });
    await flushDeferred();

    expect(calls).toEqual(["didBecomeActive"]);
  });

  it("T-AL-HOOK-03: routes to the right method across all eight channels", async () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useAppDelegate({
          applicationWillBecomeActive: () => calls.push("willBecomeActive"),
          applicationDidBecomeActive: () => calls.push("didBecomeActive"),
          applicationWillResignActive: () => calls.push("willResignActive"),
          applicationDidResignActive: () => calls.push("didResignActive"),
          applicationWillHide: () => calls.push("willHide"),
          applicationDidHide: () => calls.push("didHide"),
          applicationWillUnhide: () => calls.push("willUnhide"),
          applicationDidUnhide: () => calls.push("didUnhide"),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyApplicationWillResignActive();
      lifecycle.notifyApplicationDidResignActive();
      lifecycle.notifyApplicationWillHide();
      lifecycle.notifyApplicationDidHide();
      lifecycle.notifyApplicationWillUnhide();
      lifecycle.notifyApplicationDidUnhide();
      lifecycle.notifyApplicationWillBecomeActive();
      lifecycle.notifyApplicationDidBecomeActive();
    });
    await flushDeferred();

    expect(calls).toEqual([
      "willResignActive",
      "didResignActive",
      "willHide",
      "didHide",
      "willUnhide",
      "didUnhide",
      "willBecomeActive",
      "didBecomeActive",
    ]);
  });

  it("T-AL-HOOK-04: unmount unsubscribes from all channels", async () => {
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];

    const { unmount } = renderHook(
      () =>
        useAppDelegate({
          applicationDidBecomeActive: () => calls.push("didBecomeActive"),
          applicationDidResignActive: () => calls.push("didResignActive"),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    unmount();
    act(() => {
      lifecycle.notifyApplicationDidBecomeActive();
      lifecycle.notifyApplicationDidResignActive();
    });
    await flushDeferred();

    expect(calls).toEqual([]);
  });

  it("T-AL-HOOK-05: no-op when no AppLifecycle is provided", () => {
    // No wrapper — useAppLifecycle returns null; subscriptions skip.
    const calls: string[] = [];
    expect(() => {
      renderHook(() =>
        useAppDelegate({
          applicationDidBecomeActive: () => calls.push("didBecomeActive"),
        }),
      );
    }).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("T-AL-HOOK-06: inline delegate re-renders don't re-install subscriptions", async () => {
    // If subscriptions were re-installed on each render, a sequence
    // of re-renders followed by a single notify would fire the most-
    // recent closure exactly once — but stale closures would also
    // fire if the old subscriptions weren't cleaned up. This test
    // pins the delegate-ref pattern: exactly one call, latest tag.
    const lifecycle = new AppLifecycle();
    const calls: string[] = [];

    const { rerender } = renderHook(
      ({ tag }: { tag: number }) =>
        useAppDelegate({
          applicationDidBecomeActive: () => calls.push(`${tag}:didBecome`),
        }),
      {
        initialProps: { tag: 1 },
        wrapper: wrapperFor(lifecycle),
      },
    );

    rerender({ tag: 2 });
    rerender({ tag: 3 });

    act(() => {
      lifecycle.notifyApplicationDidBecomeActive();
    });
    await flushDeferred();

    // Latest closure runs exactly once.
    expect(calls).toEqual(["3:didBecome"]);
  });
});
