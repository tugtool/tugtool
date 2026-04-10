/**
 * TugTooltip unit tests — chain-reactive dismissal via observeDispatch.
 *
 * TugTooltip wraps @radix-ui/react-tooltip. Unlike the dialog-family
 * surfaces (alert/sheet/confirm-popover/popover) it has no user-
 * interaction action semantics — tooltips are display-only — so there
 * is no L11 migration and no action-dispatch coverage here. The novel
 * behavior in A4.2 is chain-reactive dismissal: while the tooltip is
 * open, any action flowing through the responder chain closes it.
 *
 * Radix Tooltip.Root supports a controlled `open` prop, so tests can
 * force the tooltip open via `defaultOpen` (TugTooltip now exposes
 * this) or via the controlled `open` prop — no need to drive Radix's
 * hover delay machinery through fake pointer events.
 *
 * Coverage:
 *
 * 1. No-provider ergonomics — renders inside TugTooltipProvider without
 *    a ResponderChainProvider, opens via defaultOpen, and stays open
 *    (the observeDispatch effect short-circuits because
 *    `useResponderChain()` returns null).
 *
 * 2. External dispatch closes the tooltip — with the tooltip open
 *    inside a manager context, dispatching an unrelated action through
 *    the chain triggers the observer's close path and Radix unmounts
 *    the content (or flips data-state to closed).
 *
 * 3. Subscription lifecycle — dispatches before the tooltip opens are
 *    a no-op; after close a second dispatch does not throw or reopen.
 *
 * 4. Controlled-mode forwarding — when a consumer owns `open`, the
 *    observeDispatch path invokes `onOpenChange(false)` so the
 *    consumer can flip their state. The component does not mutate
 *    its internal mirror when controlled.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import { TugTooltip, TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render UI inside a bare ResponderChainManager context PLUS a
 * TugTooltipProvider (Radix Tooltip.Root requires being inside a
 * Tooltip.Provider or it throws).
 */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      <TugTooltipProvider>{ui}</TugTooltipProvider>
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager };
}

/**
 * Query the Radix Tooltip content element by its data-slot. Radix
 * portals the content to document.body, so reach into the document
 * directly. Returns null when the content is not mounted.
 */
function getTooltipContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="tug-tooltip"]');
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

describe("TugTooltip – no-provider ergonomics", () => {
  it("renders and opens via defaultOpen without a ResponderChainProvider", () => {
    render(
      <TugTooltipProvider>
        <TugTooltip content="Save document" defaultOpen>
          <button type="button">save</button>
        </TugTooltip>
      </TugTooltipProvider>,
    );

    // Content is portaled to document.body when open.
    const content = getTooltipContent();
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-state")).toMatch(/^(delayed-open|instant-open)$/);
  });

  it("is closed by default when defaultOpen is omitted", () => {
    render(
      <TugTooltipProvider>
        <TugTooltip content="Save document">
          <button type="button">save</button>
        </TugTooltip>
      </TugTooltipProvider>,
    );
    expect(getTooltipContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. External dispatch closes the tooltip
// ---------------------------------------------------------------------------

describe("TugTooltip – observeDispatch external dismiss", () => {
  it("closes on an unrelated chain dispatch while open", () => {
    const { manager } = renderWithManager(
      <TugTooltip content="Save document" defaultOpen>
        <button type="button">save</button>
      </TugTooltip>,
    );

    // Sanity: tooltip is initially open.
    expect(getTooltipContent()?.getAttribute("data-state")).toMatch(/^(delayed-open|instant-open)$/);

    // Dispatch an unrelated action through the chain. The observer
    // runs synchronously inside the dispatch and calls
    // handleOpenChange(false), which updates the local open mirror.
    // act() flushes the state update and any resulting effects before
    // we read the DOM.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    // Radix unmounts the content on close (no exit animation in
    // happy-dom), so either data-state flips to "closed" or the element
    // is gone entirely. Both are valid proofs of dismissal.
    const after = getTooltipContent();
    if (after !== null) {
      expect(after.getAttribute("data-state")).toBe("closed");
    } else {
      expect(after).toBeNull();
    }
  });

  it("does not close when no ResponderChainProvider is in scope", () => {
    // Without a provider the hook returns null and the observer effect
    // is skipped entirely. The tooltip just stays open — there is no
    // manager to dispatch through. The test verifies the render path
    // is stable and the content remains mounted.
    render(
      <TugTooltipProvider>
        <TugTooltip content="Save document" defaultOpen>
          <button type="button">save</button>
        </TugTooltip>
      </TugTooltipProvider>,
    );
    expect(getTooltipContent()?.getAttribute("data-state")).toMatch(/^(delayed-open|instant-open)$/);
  });
});

// ---------------------------------------------------------------------------
// 3. Subscription lifecycle
// ---------------------------------------------------------------------------

describe("TugTooltip – subscription lifecycle", () => {
  it("dispatches before the tooltip opens do nothing", () => {
    const { manager } = renderWithManager(
      <TugTooltip content="Save document">
        <button type="button">save</button>
      </TugTooltip>,
    );

    // Initially closed: no observer subscribed, dispatching is a no-op
    // for this tooltip. The content element stays null.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });
    expect(getTooltipContent()).toBeNull();
  });

  it("observer is removed after the first dispatch closes the tooltip", () => {
    const { manager } = renderWithManager(
      <TugTooltip content="Save document" defaultOpen>
        <button type="button">save</button>
      </TugTooltip>,
    );

    // First dispatch closes the tooltip.
    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });
    const afterFirst = getTooltipContent();
    if (afterFirst !== null) {
      expect(afterFirst.getAttribute("data-state")).toBe("closed");
    }

    // Second dispatch must not throw and must not reopen. The effect
    // cleanup should have unsubscribed when effectiveOpen flipped to
    // false. A clean second dispatch is a sufficient integration-level
    // proof that the subscription does not leak.
    expect(() => {
      act(() => {
        manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
      });
    }).not.toThrow();
    const afterSecond = getTooltipContent();
    if (afterSecond !== null) {
      expect(afterSecond.getAttribute("data-state")).toBe("closed");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Controlled-mode forwarding
// ---------------------------------------------------------------------------

describe("TugTooltip – controlled-mode forwarding", () => {
  it("invokes onOpenChange(false) on external dispatch in controlled mode", () => {
    const changes: boolean[] = [];
    const { manager, rerender } = renderWithManager(
      <TugTooltip
        content="Save document"
        open
        onOpenChange={(next) => changes.push(next)}
      >
        <button type="button">save</button>
      </TugTooltip>,
    );

    expect(getTooltipContent()?.getAttribute("data-state")).toMatch(/^(delayed-open|instant-open)$/);

    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    // The component does not mutate its internal mirror in controlled
    // mode — it forwards onOpenChange(false) and waits for the consumer
    // to flip their state. We check that the callback was invoked.
    expect(changes).toContain(false);

    // Simulate the consumer responding by flipping open back.
    rerender(
      <ResponderChainContext.Provider value={manager}>
        <TugTooltipProvider>
          <TugTooltip
            content="Save document"
            open={false}
            onOpenChange={(next) => changes.push(next)}
          >
            <button type="button">save</button>
          </TugTooltip>
        </TugTooltipProvider>
      </ResponderChainContext.Provider>,
    );

    // Content is now unmounted or data-state=closed.
    const after = getTooltipContent();
    if (after !== null) {
      expect(after.getAttribute("data-state")).toBe("closed");
    } else {
      expect(after).toBeNull();
    }
  });
});
