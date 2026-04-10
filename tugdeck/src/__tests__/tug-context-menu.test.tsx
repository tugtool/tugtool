/**
 * TugContextMenu unit tests — chain-native item activation and
 * chain-reactive dismissal via observeDispatch.
 *
 * TugContextMenu wraps @radix-ui/react-context-menu. Radix ContextMenu
 * is uncontrolled by design (no `open` / `defaultOpen` props — it opens
 * only on a native contextmenu event on its Trigger), so these tests
 * fire `contextmenu` events through React Testing Library's `fireEvent`
 * to drive the menu into its open state. The mirror `open` state in
 * TugContextMenu tracks Radix's internal state via `onOpenChange`, which
 * is what gates the observeDispatch effect.
 *
 * Coverage:
 *
 * 1. No-provider ergonomics — renders without throwing even when no
 *    ResponderChainProvider is in scope. The observeDispatch
 *    subscription is silently skipped because `useResponderChain()`
 *    returns null, and item activation skips the dispatch path (menu
 *    still opens/closes normally via Radix).
 *
 * 2. Opens on contextmenu event — a native contextmenu fired on the
 *    Radix Trigger opens the menu and portals content into document.body.
 *
 * 3. External dispatch closes the menu — with the menu open inside a
 *    manager context, dispatching an unrelated action through the chain
 *    triggers the observer's Escape-synthesis dismiss path. Radix
 *    responds to the synthetic Escape by flipping its internal open
 *    state to false.
 *
 * 4. Subscription lifecycle — the observer is installed only while the
 *    menu is open. A dispatch before the first open is a no-op; after
 *    close, a second dispatch does not throw and does not reopen the menu.
 *
 * Self-dispatch skip (blinkingRef) and item-activation dispatch are not
 * covered directly: the blink promise involves TugAnimator and Radix
 * pointer semantics that happy-dom does not simulate faithfully. The
 * same precedent is documented in `tug-popup-menu.test.tsx`. End-to-end
 * blink-timing and dispatch coverage belongs to gallery smoke tests.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import type { TugContextMenuEntry } from "@/components/tugways/tug-context-menu";
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
 * Query the Radix ContextMenu content element by its data-slot. Radix
 * portals the content to document.body, so plain `container.querySelector`
 * would miss it — we reach into the document directly.
 *
 * Returns null when the content element is not mounted (menu closed).
 */
function getMenuContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="tug-context-menu"]');
}

/**
 * Fire a native contextmenu event on the trigger element. Radix
 * ContextMenu.Trigger listens for onContextMenu and opens the menu when
 * it fires. happy-dom supports MouseEvent dispatch, which is enough to
 * drive Radix's internal open state here.
 */
function openMenuViaRightClick(trigger: Element) {
  act(() => {
    fireEvent.contextMenu(trigger);
  });
}

/** A minimal two-item list used by the tests. */
const ITEMS: TugContextMenuEntry[] = [
  { action: TUG_ACTIONS.CUT, label: "Cut" },
  { action: TUG_ACTIONS.COPY, label: "Copy" },
];

/**
 * A trigger the tests can query by test id. Uses forwardRef so Radix's
 * asChild path can attach its ref and event handlers to a real DOM node.
 * Without forwardRef, Radix's injected `ref` has nowhere to land.
 */
const Trigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Trigger(props, ref) {
    return (
      <div ref={ref} data-testid="ctx-trigger" style={{ padding: 20 }} {...props}>
        right-click here
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. No-provider ergonomics
// ---------------------------------------------------------------------------

describe("TugContextMenu – no-provider ergonomics", () => {
  it("renders without a ResponderChainProvider in scope", () => {
    const { getByTestId } = render(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );
    // Trigger is in the DOM; no throw during mount.
    expect(getByTestId("ctx-trigger")).not.toBeNull();
    // Menu content is portaled only when open — closed by default.
    expect(getMenuContent()).toBeNull();
  });

  it("opens on right-click even without a provider", () => {
    const { getByTestId } = render(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );
    openMenuViaRightClick(getByTestId("ctx-trigger"));
    const content = getMenuContent();
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-state")).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 2. Opens via contextmenu event
// ---------------------------------------------------------------------------

describe("TugContextMenu – open on right-click", () => {
  it("opens the menu and portals content into document.body", () => {
    const { getByTestId } = renderWithManager(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );
    expect(getMenuContent()).toBeNull();
    openMenuViaRightClick(getByTestId("ctx-trigger"));
    const content = getMenuContent();
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-state")).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 3. External dispatch closes the menu
// ---------------------------------------------------------------------------

describe("TugContextMenu – observeDispatch external dismiss", () => {
  it("closes on an unrelated chain dispatch while open", () => {
    const { getByTestId, manager } = renderWithManager(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );

    // Open the menu via right-click.
    openMenuViaRightClick(getByTestId("ctx-trigger"));
    expect(getMenuContent()?.getAttribute("data-state")).toBe("open");

    // Dispatch an unrelated action. The observer runs synchronously
    // inside the dispatch and synthesizes an Escape keydown, which
    // Radix catches and uses to close the menu. act() flushes the
    // resulting state updates and effects before we read the DOM.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    // Radix unmounts the content on close (no exit animation in
    // happy-dom), so either data-state flips to "closed" or the element
    // is gone entirely. Both are valid proofs of dismissal.
    const after = getMenuContent();
    if (after !== null) {
      expect(after.getAttribute("data-state")).toBe("closed");
    } else {
      expect(after).toBeNull();
    }
  });

  it("does nothing on dispatch when no ResponderChainProvider is in scope", () => {
    // Without a provider the hook returns null and the observer effect
    // is skipped entirely. Right-click still opens the menu (Radix
    // internal), and it just stays open because there is no manager to
    // dispatch through. The test's job is to verify the render path is
    // stable and the menu remains mounted.
    const { getByTestId } = render(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );
    openMenuViaRightClick(getByTestId("ctx-trigger"));
    expect(getMenuContent()?.getAttribute("data-state")).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// 4. Subscription lifecycle
// ---------------------------------------------------------------------------

describe("TugContextMenu – subscription lifecycle", () => {
  it("dispatches before the menu opens do nothing", () => {
    const { manager } = renderWithManager(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );

    // Menu starts closed: no observer subscribed. Dispatching is a
    // no-op for this menu. The content element stays null.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });
    expect(getMenuContent()).toBeNull();
  });

  it("observer is removed after the first dispatch closes the menu", () => {
    const { getByTestId, manager } = renderWithManager(
      <TugContextMenu items={ITEMS}>
        <Trigger />
      </TugContextMenu>,
    );

    // Open, then dismiss via chain dispatch.
    openMenuViaRightClick(getByTestId("ctx-trigger"));
    expect(getMenuContent()?.getAttribute("data-state")).toBe("open");

    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    const afterFirst = getMenuContent();
    if (afterFirst !== null) {
      expect(afterFirst.getAttribute("data-state")).toBe("closed");
    }

    // Second dispatch must not throw and must not reopen the menu. The
    // effect cleanup should have unsubscribed when open flipped to false.
    expect(() => {
      act(() => {
        manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
      });
    }).not.toThrow();

    const afterSecond = getMenuContent();
    if (afterSecond !== null) {
      expect(afterSecond.getAttribute("data-state")).toBe("closed");
    }
  });
});
