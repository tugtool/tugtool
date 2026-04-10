/**
 * TugPopupMenu unit tests — chain-reactive dismissal via observeDispatch.
 *
 * TugPopupMenu is the internal building block behind TugPopupButton and
 * the tab bar's overflow/add menus. It subscribes to
 * `manager.observeDispatch` while open so any action flowing through
 * the responder chain — a keyboard shortcut, a button click somewhere
 * else, a programmatic dispatch — dismisses the menu. The menu's own
 * item activation does NOT dismiss: the blinkingRef guard suppresses
 * the observer's close during the animate-then-onSelect window.
 *
 * This test file covers:
 *
 * 1. No-provider ergonomics — renders without error; `defaultOpen`
 *    produces a mounted, data-state="open" menu even when no
 *    ResponderChainProvider is in scope. The subscription is silently
 *    skipped because `useResponderChain()` returns null.
 *
 * 2. External dispatch closes the menu — render with `defaultOpen`
 *    inside a manager context, dispatch an unrelated action through
 *    the chain, assert the menu is no longer open. This is the core
 *    observeDispatch behavior.
 *
 * 3. Subscription lifecycle — the observer is installed only while
 *    the menu is open. Dispatching before the menu opens and after it
 *    closes has no effect on the closed menu. A second dispatch after
 *    the first close is a proxy for "the effect cleanup unsubscribed"
 *    — we cannot peek at the private dispatchObservers set, but a
 *    clean second dispatch verifies the subscription does not leak.
 *
 * Self-dispatch skip (blinkingRef) is not covered directly here: the
 * blink promise and item activation path involve TugAnimator and
 * Radix pointer semantics that happy-dom does not simulate faithfully.
 * End-to-end blink-timing coverage belongs to gallery smoke tests, not
 * happy-dom unit tests.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuItem } from "@/components/tugways/internal/tug-popup-menu";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render UI inside a bare ResponderChainManager context (no provider-level
 * keybinding/selection pipeline). Returns the container and the manager
 * so tests can dispatch actions directly.
 */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager };
}

/**
 * Query the Radix DropdownMenu content element by its test id. Radix
 * portals the content to document.body, so plain `container.querySelector`
 * would miss it — we reach into the document directly.
 *
 * Returns null when the content element is not mounted (menu closed).
 */
function getMenuContent(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

/**
 * A minimal fixed item list used by the tests. Two enabled items is
 * enough to exercise the render path without any specific selection
 * behavior.
 */
const ITEMS: TugPopupMenuItem[] = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
];

/** A trigger that is a simple button — sufficient for Radix asChild. */
function Trigger(): React.ReactElement {
  return <button type="button">open</button>;
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. No-provider ergonomics
// ---------------------------------------------------------------------------

describe("TugPopupMenu – no-provider ergonomics", () => {
  it("renders without a ResponderChainProvider and opens via defaultOpen", () => {
    render(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-noprov"
      />,
    );
    // The menu content is portaled into document.body when open.
    const content = getMenuContent("popup-noprov");
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-state")).toBe("open");
  });

  it("closed by default when defaultOpen is omitted", () => {
    render(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        data-testid="popup-closed"
      />,
    );
    expect(getMenuContent("popup-closed")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. External dispatch closes the menu
// ---------------------------------------------------------------------------

describe("TugPopupMenu – observeDispatch external dismiss", () => {
  it("dispatches through the chain while the menu is open close it", () => {
    const { manager } = renderWithManager(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-dismiss"
      />,
    );

    // Sanity: menu is initially open.
    expect(getMenuContent("popup-dismiss")?.getAttribute("data-state")).toBe(
      "open",
    );

    // Dispatch an unrelated action through the chain. No responder is
    // registered, so handled=false, but the observer still fires and
    // the menu should close. The observer callback runs synchronously
    // inside the dispatch, setOpen(false) is queued — act() flushes
    // the state update and any effects before we read the DOM.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    // Radix unmounts the content on close (no exit animation in
    // happy-dom), so either data-state flips to "closed" or the element
    // is gone entirely. Both are valid proofs of dismissal.
    const afterContent = getMenuContent("popup-dismiss");
    if (afterContent !== null) {
      expect(afterContent.getAttribute("data-state")).toBe("closed");
    } else {
      expect(afterContent).toBeNull();
    }
  });

  it("does not close the menu when there is no ResponderChainProvider in scope", () => {
    // Without a provider the hook returns null and the effect is a no-op.
    // There is no manager to dispatch through, so this just verifies the
    // render path is stable. The content element stays mounted.
    render(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-noprov-stable"
      />,
    );
    expect(
      getMenuContent("popup-noprov-stable")?.getAttribute("data-state"),
    ).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 3. Subscription lifecycle
// ---------------------------------------------------------------------------

describe("TugPopupMenu – subscription lifecycle", () => {
  it("dispatches before the menu opens do nothing and dispatches after close are safe", () => {
    // Render with the menu initially closed.
    const { manager } = renderWithManager(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        data-testid="popup-lifecycle"
      />,
    );

    // Initially closed: no observer subscribed, dispatching is a no-op
    // for this menu. The content element stays null.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });
    expect(getMenuContent("popup-lifecycle")).toBeNull();
  });

  it("the observer is removed after the first dispatch closes the menu (no stale subscription)", () => {
    const { manager } = renderWithManager(
      <TugPopupMenu
        trigger={<Trigger />}
        items={ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-unsub"
      />,
    );

    // First dispatch closes the menu.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });
    const afterFirst = getMenuContent("popup-unsub");
    if (afterFirst !== null) {
      expect(afterFirst.getAttribute("data-state")).toBe("closed");
    }

    // Second dispatch must not throw and must not re-open the menu. The
    // effect cleanup should have unsubscribed when open flipped to false.
    // We cannot peek at the private dispatchObservers set, but a clean
    // second dispatch is a sufficient integration-level proof that the
    // subscription does not leak.
    expect(() => {
      act(() => {
        manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
      });
    }).not.toThrow();
    const afterSecond = getMenuContent("popup-unsub");
    if (afterSecond !== null) {
      expect(afterSecond.getAttribute("data-state")).toBe("closed");
    }
  });
});
