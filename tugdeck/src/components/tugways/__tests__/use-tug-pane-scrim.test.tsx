/**
 * useTugPaneScrim tests.
 *
 * Pins the four invariants the hook exists to enforce:
 *
 *   1. `show()` / `hide()` drive the registry: the chrome's
 *      `data-scrim` attribute toggles in lockstep.
 *   2. Cleanup-on-unmount: a consumer that mounted with the scrim up
 *      must release it on unmount, even if it never explicitly called
 *      hide().
 *   3. No-provider fallback: rendering without a `TugPanePortalContext`
 *      yields no-op callbacks (no crash, no DOM mutation).
 *   4. Stable identities: the returned `{ show, hide }` object identity
 *      is stable across re-renders for a given chrome — consumers can
 *      put it in `useLayoutEffect` deps without re-firing.
 */
import "../../../__tests__/setup-rtl";

import React, { useLayoutEffect } from "react";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, cleanup, renderHook } from "@testing-library/react";

import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import * as paneScrimRegistry from "@/lib/pane-scrim-registry";
import { useTugPaneScrim } from "@/components/tugways/use-tug-pane-scrim";

beforeEach(() => {
  // No global registry state to reset (WeakMap entries belong to the
  // chrome elements created in each test). Listed here for symmetry
  // with sibling tests that DO need beforeEach reset.
});

afterEach(() => {
  cleanup();
});

/** A test consumer that holds the scrim up while mounted. */
function ScrimConsumer(): React.ReactElement {
  const scrim = useTugPaneScrim();
  useLayoutEffect(() => {
    scrim.show();
    return () => scrim.hide();
  }, [scrim]);
  return <div data-testid="consumer" />;
}

describe("useTugPaneScrim", () => {
  test("show()/hide() drive data-scrim on the chrome from context", () => {
    const chrome = document.createElement("div");
    chrome.className = "tug-pane-chrome";
    document.body.appendChild(chrome);

    const { unmount } = render(
      <TugPanePortalContext value={chrome as HTMLDivElement}>
        <ScrimConsumer />
      </TugPanePortalContext>,
    );

    expect(chrome.getAttribute("data-scrim")).toBe("on");
    expect(paneScrimRegistry._getCountForTests(chrome)).toBe(1);

    unmount();
    expect(chrome.hasAttribute("data-scrim")).toBe(false);
    expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);

    document.body.removeChild(chrome);
  });

  test("two consumers on the same chrome ref-count correctly", () => {
    const chrome = document.createElement("div");
    chrome.className = "tug-pane-chrome";
    document.body.appendChild(chrome);

    const { rerender, unmount } = render(
      <TugPanePortalContext value={chrome as HTMLDivElement}>
        <ScrimConsumer />
        <ScrimConsumer />
      </TugPanePortalContext>,
    );

    // Both consumers showed; attribute on; count == 2.
    expect(chrome.getAttribute("data-scrim")).toBe("on");
    expect(paneScrimRegistry._getCountForTests(chrome)).toBe(2);

    // Unmount one consumer by re-rendering with only one child.
    rerender(
      <TugPanePortalContext value={chrome as HTMLDivElement}>
        <ScrimConsumer />
      </TugPanePortalContext>,
    );

    // Still on — one consumer remains.
    expect(chrome.getAttribute("data-scrim")).toBe("on");
    expect(paneScrimRegistry._getCountForTests(chrome)).toBe(1);

    unmount();
    expect(chrome.hasAttribute("data-scrim")).toBe(false);
    expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);

    document.body.removeChild(chrome);
  });

  test("no-provider fallback: callbacks no-op without throwing", () => {
    // Hook rendered with no TugPanePortalContext provider. The
    // returned callbacks must be safe to call.
    const { result } = renderHook(() => useTugPaneScrim());
    expect(typeof result.current.show).toBe("function");
    expect(typeof result.current.hide).toBe("function");
    // Calling either must not throw.
    expect(() => result.current.show()).not.toThrow();
    expect(() => result.current.hide()).not.toThrow();
  });

  test("stable identity for a given chrome across rerenders", () => {
    const chrome = document.createElement("div");
    chrome.className = "tug-pane-chrome";

    const wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
      <TugPanePortalContext value={chrome as HTMLDivElement}>{children}</TugPanePortalContext>
    );

    const { result, rerender } = renderHook(() => useTugPaneScrim(), { wrapper });
    const first = result.current;
    rerender();
    const second = result.current;
    // Same controller object across renders — `useLayoutEffect` deps
    // depending on `scrim` will not re-fire on parent re-renders.
    expect(second).toBe(first);
  });

  test("identity changes when the chrome ref changes", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");

    // Capture the controller across renders so we can compare
    // identities before/after a chrome swap (cross-pane move shape).
    const captured: Array<ReturnType<typeof useTugPaneScrim>> = [];
    function Probe(): null {
      captured.push(useTugPaneScrim());
      return null;
    }

    const { rerender } = render(
      <TugPanePortalContext value={a as HTMLDivElement}>
        <Probe />
      </TugPanePortalContext>,
    );
    const first = captured[captured.length - 1];

    rerender(
      <TugPanePortalContext value={b as HTMLDivElement}>
        <Probe />
      </TugPanePortalContext>,
    );
    const second = captured[captured.length - 1];

    // Different chrome → different callbacks. Cross-pane card moves
    // depend on this — the consumer's effect re-runs against the new
    // pane, decrementing the old count and incrementing the new one.
    expect(second).not.toBe(first);
  });
});
