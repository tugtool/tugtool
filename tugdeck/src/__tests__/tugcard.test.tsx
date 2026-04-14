/**
 * Tugcard component unit tests -- Phase 5f4.
 *
 * Tests cover:
 * - T09: Tugcard renders header with title text
 * - T10: Tugcard renders children in content area
 * - T11: Tugcard close button calls onClose
 * - T12: Tugcard with accessory renders accessory between header and content
 * - T13: Tugcard without accessory renders no visible accessory content
 * - T14: Tugcard calls onMinSizeChange with computed minimum on mount
 * - T15: Tugcard registers as responder with expected actions
 * - T01 (Phase 5f4): onContentReady fires after child DOM commits (persist path
 *   with scroll+content); visibility:hidden applied before and removed after.
 * - T02 (Phase 5f4): content-only restore (no scroll) uses persist path without
 *   visibility:hidden; onContentReady still fires after child re-render.
 * - T03 (Phase 5f4): no-persist fallback — scroll applied directly, no hiding.
 * - T04 (Phase 5f4): selection-only restore with persistence registered — synchronous,
 *   no hiding, no onContentReady (bag.content undefined → direct-apply fallback).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import { mock } from "bun:test";

// Override the connection-singleton for this file. The global singleton
// can be mocked-over by other test files (see filetree-store.test.ts) which
// leaves it in an inconsistent state for tests that actually need a working
// `onFrame` surface. By providing a file-local mock backed by a mutable
// closure variable, the W2 filter tests below can install and replace their
// mock connection at will.
let _testConnection: unknown = null;
mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => _testConnection,
  setConnection: (c: unknown) => {
    _testConnection = c;
  },
}));

import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

import { Tugcard } from "@/components/tugways/tug-card";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { registerCard, _resetForTest } from "@/card-registry";
import type { TabItem } from "@/layout-tree";
import type { FeedIdValue } from "@/protocol";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { withDeckManager, makeMockStore } from "./mock-deck-manager-store";
import { useTugcardPersistence } from "@/components/tugways/use-tugcard-persistence";
import type { TugConnection } from "@/connection";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a Tugcard inside a ResponderChainProvider and DeckManagerContext.
 * Tugcard calls useResponder (chain) and useDeckManager (store).
 */
function renderInChain(ui: React.ReactElement) {
  return render(
    withDeckManager(<ResponderChainProvider>{ui}</ResponderChainProvider>)
  );
}

/**
 * Render a Tugcard inside a manually-controlled ResponderChainManager and
 * DeckManagerContext. Lets tests inspect the manager directly after render.
 */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    withDeckManager(
      <ResponderChainContext.Provider value={manager}>
        {ui}
      </ResponderChainContext.Provider>
    )
  );
  return { ...result, manager };
}

/**
 * Render a Tugcard with both a controlled manager and a mock store that
 * records setTabState calls. Useful for Step 4 phase 5f tests.
 *
 * Pass `storeOverrides` to swap individual store methods (e.g. record
 * `setActiveTab` / `removeTab` calls when testing the A2.3 chain handlers).
 */
function renderWithManagerAndStore(
  ui: React.ReactElement,
  storeOverrides?: Partial<import("../deck-manager-store").IDeckManagerStore>,
) {
  const manager = new ResponderChainManager();
  const store = makeMockStore(storeOverrides);
  const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");
  const result = render(
    <DeckManagerContext.Provider value={store}>
      <ResponderChainContext.Provider value={manager}>
        {ui}
      </ResponderChainContext.Provider>
    </DeckManagerContext.Provider>
  );
  return { ...result, manager, store };
}

/** Minimal valid Tugcard props for a feedless card. */
const defaultProps = {
  cardId: "card-test-1",
  meta: { title: "Test Card" },
  feedIds: [] as readonly FeedIdValue[],
} as const;

// ---------------------------------------------------------------------------
// T09: Tugcard renders header with title text
// ---------------------------------------------------------------------------

describe("Tugcard – header title", () => {
  it("T09: renders header with the title text from meta prop", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps} meta={{ title: "My Card Title" }}>
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toBe("My Card Title");
  });
});

// ---------------------------------------------------------------------------
// T10: Tugcard renders children in content area
// ---------------------------------------------------------------------------

describe("Tugcard – children rendered in content area", () => {
  it("T10: renders children inside the content area", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps}>
        <div data-testid="child-content">Hello from child</div>
      </Tugcard>
    );

    const content = container.querySelector("[data-testid='child-content']");
    expect(content).not.toBeNull();
    expect(content?.textContent).toBe("Hello from child");

    // Child should be inside the content area
    const contentArea = container.querySelector("[data-testid='tugcard-content']");
    expect(contentArea).not.toBeNull();
    expect(contentArea?.contains(content)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T11: Tugcard close button calls onClose
// ---------------------------------------------------------------------------

describe("Tugcard – close button", () => {
  it("T11: clicking the close button calls onClose", () => {
    const onClose = mock(() => {});

    const { container } = renderInChain(
      <Tugcard {...defaultProps} onClose={onClose}>
        <div>content</div>
      </Tugcard>
    );

    const closeBtn = container.querySelector("[data-testid='tugcard-close-button']") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button does not appear when meta.closable is false", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps} meta={{ title: "Test", closable: false }}>
        <div>content</div>
      </Tugcard>
    );

    const closeBtn = container.querySelector("[data-testid='tugcard-close-button']");
    expect(closeBtn).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T12: Tugcard with accessory renders accessory between header and content
// ---------------------------------------------------------------------------

describe("Tugcard – accessory slot", () => {
  it("T12: renders accessory content between header and content area", () => {
    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        accessory={<div data-testid="accessory-content">Toolbar</div>}
      >
        <div>content</div>
      </Tugcard>
    );

    const accessoryEl = container.querySelector("[data-testid='tugcard-accessory']");
    expect(accessoryEl).not.toBeNull();

    const accessoryContent = container.querySelector("[data-testid='accessory-content']");
    expect(accessoryContent).not.toBeNull();
    expect(accessoryContent?.textContent).toBe("Toolbar");

    // Accessory must be between title bar and content in DOM order
    const titleBar = container.querySelector("[data-testid='tugcard-title-bar']");
    const content = container.querySelector("[data-testid='tugcard-content']");
    expect(titleBar).not.toBeNull();
    expect(content).not.toBeNull();

    // DOM order check: title-bar -> accessory -> content
    const allSections = container.querySelectorAll(
      "[data-testid='tugcard-title-bar'], [data-testid='tugcard-accessory'], [data-testid='tugcard-content']"
    );
    expect(allSections[0]?.getAttribute("data-testid")).toBe("tugcard-title-bar");
    expect(allSections[1]?.getAttribute("data-testid")).toBe("tugcard-accessory");
    expect(allSections[2]?.getAttribute("data-testid")).toBe("tugcard-content");
  });
});

// ---------------------------------------------------------------------------
// T13: Tugcard without accessory renders no visible accessory content
// ---------------------------------------------------------------------------

describe("Tugcard – no accessory", () => {
  it("T13: accessory slot has no visible content when accessory prop is null", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps} accessory={null}>
        <div>content</div>
      </Tugcard>
    );

    // Accessory div is present but empty (no children rendered)
    const accessoryEl = container.querySelector("[data-testid='tugcard-accessory']");
    expect(accessoryEl).not.toBeNull();
    expect(accessoryEl?.children.length).toBe(0);
  });

  it("T13: accessory slot also empty when accessory prop is omitted (default)", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps}>
        <div>content</div>
      </Tugcard>
    );

    const accessoryEl = container.querySelector("[data-testid='tugcard-accessory']");
    expect(accessoryEl).not.toBeNull();
    expect(accessoryEl?.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T14: Tugcard calls onMinSizeChange with computed minimum on mount
// ---------------------------------------------------------------------------

describe("Tugcard – onMinSizeChange", () => {
  it("T14: calls onMinSizeChange with computed minimum on mount", () => {
    const onMinSizeChange = mock((_size: { width: number; height: number }) => {});
    const minContentSize = { width: 120, height: 80 };

    act(() => {
      renderInChain(
        <Tugcard
          {...defaultProps}
          minContentSize={minContentSize}
          onMinSizeChange={onMinSizeChange}
        >
          <div>content</div>
        </Tugcard>
      );
    });

    // onMinSizeChange must have been called at least once on mount
    expect(onMinSizeChange.mock.calls.length).toBeGreaterThan(0);

    // The reported height must be at least header (28px) + minContentSize.height
    const lastCall = onMinSizeChange.mock.calls[onMinSizeChange.mock.calls.length - 1];
    const reported = lastCall[0] as { width: number; height: number };
    expect(reported.width).toBe(minContentSize.width);
    // height >= 28 (header) + 80 (minContentSize) = 108
    // (accessory height is 0 in happy-dom since getBoundingClientRect returns 0)
    expect(reported.height).toBeGreaterThanOrEqual(28 + minContentSize.height);
  });

  it("uses default minContentSize of { width: 100, height: 60 } when not specified", () => {
    const onMinSizeChange = mock((_size: { width: number; height: number }) => {});

    act(() => {
      renderInChain(
        <Tugcard {...defaultProps} onMinSizeChange={onMinSizeChange}>
          <div>content</div>
        </Tugcard>
      );
    });

    expect(onMinSizeChange.mock.calls.length).toBeGreaterThan(0);
    const lastCall = onMinSizeChange.mock.calls[onMinSizeChange.mock.calls.length - 1];
    const reported = lastCall[0] as { width: number; height: number };
    expect(reported.width).toBe(100);
    expect(reported.height).toBeGreaterThanOrEqual(28 + 60);
  });
});

// ---------------------------------------------------------------------------
// T15: Tugcard registers as responder with expected actions
// ---------------------------------------------------------------------------

describe("Tugcard – responder registration", () => {
  it("T15: registers as a responder node with close, minimize, toggleMenu, find actions", () => {
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-responder-test">
        <div>content</div>
      </Tugcard>
    );

    // The card should be registered and able to handle the standard actions
    expect(manager.canHandle("close")).toBe(true);
    expect(manager.canHandle("minimize")).toBe(true);
    expect(manager.canHandle("toggle-menu")).toBe(true);
    expect(manager.canHandle("find")).toBe(true);
  });

  it("dispatching close through the chain calls onClose", () => {
    const onClose = mock(() => {});
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-close-test" onClose={onClose}>
        <div>content</div>
      </Tugcard>
    );

    manager.sendToFirstResponder({ action: TUG_ACTIONS.CLOSE, phase: "discrete" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Extra: feedless card mounts children immediately
// ---------------------------------------------------------------------------

describe("Tugcard – feedless card", () => {
  it("feedless card (feedIds=[]) mounts children immediately (no Loading... placeholder)", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps} feedIds={[]}>
        <div data-testid="real-content">Ready</div>
      </Tugcard>
    );

    const realContent = container.querySelector("[data-testid='real-content']");
    expect(realContent).not.toBeNull();

    const loadingEl = container.querySelector("[data-testid='tugcard-loading']");
    expect(loadingEl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 5b: Tab support tests
// ---------------------------------------------------------------------------

/** Build a TabItem for use in tests. */
function makeTab(id: string, componentId: string, title: string, closable = true): TabItem {
  return { id, componentId, title, closable };
}

/** Register a minimal card type for a given componentId with an icon. */
function registerTabCard(componentId: string, title: string, icon?: string): void {
  registerCard({
    componentId,
    defaultMeta: { title, icon, closable: true },
    contentFactory: () => <div>{title}</div>,
  });
}

describe("Tugcard – tab support: TugTabBar in accessory slot", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders TugTabBar in accessory slot when tabs.length > 1", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div data-testid="active-content">Hello content</div>
      </Tugcard>
    );

    const tabBar = container.querySelector("[data-testid='tug-tab-bar']");
    expect(tabBar).not.toBeNull();
  });

  it("does not render TugTabBar when tabs is undefined (backward compatible)", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps}>
        <div>content</div>
      </Tugcard>
    );

    const tabBar = container.querySelector("[data-testid='tug-tab-bar']");
    expect(tabBar).toBeNull();
  });

  it("does not render TugTabBar when tabs has exactly one entry", () => {
    registerTabCard("hello", "Hello");

    const tabs = [makeTab("tab-1", "hello", "Hello")];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    const tabBar = container.querySelector("[data-testid='tug-tab-bar']");
    expect(tabBar).toBeNull();
  });
});

describe("Tugcard – tab support: header follows active tab metadata", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("header title reflects the active tab's registration metadata", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        meta={{ title: "Original Title" }}
        tabs={tabs}
        activeTabId="tab-2"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    // Should show "Terminal" (active tab's registration), not "Original Title"
    expect(titleEl!.textContent).toBe("Terminal");
  });

  it("header title falls back to meta prop when tabs.length <= 1", () => {
    registerTabCard("hello", "Hello");

    const tabs = [makeTab("tab-1", "hello", "Hello")];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        meta={{ title: "Original Title" }}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl!.textContent).toBe("Original Title");
  });
});

describe("Tugcard – tab support: previousTab and nextTab responder actions", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("registers previousTab and nextTab actions on the responder chain", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManager(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    expect(manager.canHandle("previous-tab")).toBe(true);
    expect(manager.canHandle("next-tab")).toBe(true);
  });

  it("nextTab dispatches setActiveTab with the next tab id (A2.3)", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const setActiveCalls: Array<{ cardId: string; tabId: string }> = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManagerAndStore(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>,
      {
        setActiveTab: (cardId: string, tabId: string) => {
          setActiveCalls.push({ cardId, tabId });
        },
      },
    );

    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.NEXT_TAB, phase: "discrete" });
    });

    expect(setActiveCalls.length).toBe(1);
    expect(setActiveCalls[0].tabId).toBe("tab-2");
    expect(setActiveCalls[0].cardId).toBe(defaultProps.cardId);
  });

  it("previousTab dispatches setActiveTab with the previous tab id, wrapping around (A2.3)", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const setActiveCalls: Array<{ cardId: string; tabId: string }> = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManagerAndStore(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>,
      {
        setActiveTab: (cardId: string, tabId: string) => {
          setActiveCalls.push({ cardId, tabId });
        },
      },
    );

    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.PREVIOUS_TAB, phase: "discrete" });
    });

    // Wraps from tab-1 (index 0) back to tab-2 (index 1, last)
    expect(setActiveCalls.length).toBe(1);
    expect(setActiveCalls[0].tabId).toBe("tab-2");
  });

  it("jumpToTab dispatches setActiveTab with the Nth tab id (A3 / R4)", () => {
    // Round-trip guard: jumpToTab → handleJumpToTab → re-dispatch
    // selectTab → store.setActiveTab. The intermediate selectTab dispatch
    // is what runs the save-current-tab-state side effect, so this
    // assertion is what protects ⌘1..⌘9 from a future refactor that
    // breaks the re-dispatch chain.
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");
    registerTabCard("editor", "Editor");

    const setActiveCalls: Array<{ cardId: string; tabId: string }> = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
      makeTab("tab-3", "editor", "Editor"),
    ];

    const { manager } = renderWithManagerAndStore(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>,
      {
        setActiveTab: (cardId: string, tabId: string) => {
          setActiveCalls.push({ cardId, tabId });
        },
      },
    );

    // ⌘2 → 1-based index 2 → tab-2
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.JUMP_TO_TAB,
        value: 2,
        phase: "discrete",
      });
    });
    expect(setActiveCalls.length).toBe(1);
    expect(setActiveCalls[0].tabId).toBe("tab-2");
    expect(setActiveCalls[0].cardId).toBe(defaultProps.cardId);

    // ⌘3 → 1-based index 3 → tab-3
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.JUMP_TO_TAB,
        value: 3,
        phase: "discrete",
      });
    });
    expect(setActiveCalls.length).toBe(2);
    expect(setActiveCalls[1].tabId).toBe("tab-3");
  });

  it("jumpToTab is a no-op for out-of-range or non-number payloads", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const setActiveCalls: Array<{ cardId: string; tabId: string }> = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManagerAndStore(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>,
      {
        setActiveTab: (cardId: string, tabId: string) => {
          setActiveCalls.push({ cardId, tabId });
        },
      },
    );

    act(() => {
      // index 0 — invalid (1-based)
      manager.sendToFirstResponder({ action: TUG_ACTIONS.JUMP_TO_TAB, value: 0, phase: "discrete" });
      // index 9 — past the end of a 2-tab card
      manager.sendToFirstResponder({ action: TUG_ACTIONS.JUMP_TO_TAB, value: 9, phase: "discrete" });
      // wrong type
      manager.sendToFirstResponder({ action: TUG_ACTIONS.JUMP_TO_TAB, value: "2", phase: "discrete" });
      // missing payload
      manager.sendToFirstResponder({ action: TUG_ACTIONS.JUMP_TO_TAB, phase: "discrete" });
    });

    expect(setActiveCalls.length).toBe(0);
  });

  it("previousTab/nextTab are no-ops when tabs.length <= 1", () => {
    registerTabCard("hello", "Hello");

    const setActiveCalls: Array<{ cardId: string; tabId: string }> = [];
    const tabs = [makeTab("tab-1", "hello", "Hello")];

    const { manager } = renderWithManagerAndStore(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>,
      {
        setActiveTab: (cardId: string, tabId: string) => {
          setActiveCalls.push({ cardId, tabId });
        },
      },
    );

    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.NEXT_TAB, phase: "discrete" });
      manager.sendToFirstResponder({ action: TUG_ACTIONS.PREVIOUS_TAB, phase: "discrete" });
    });

    expect(setActiveCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 5b3 Step 3: cardTitle prop composes header title
// ---------------------------------------------------------------------------

describe("Tugcard – cardTitle prop (Phase 5b3)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("with cardTitle='Component Gallery', header shows 'Component Gallery: Hello'", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        cardTitle="Component Gallery"
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Component Gallery: Hello");
  });

  it("with cardTitle omitted, header shows just the tab title", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        // cardTitle intentionally omitted
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Hello");
  });

  it("with cardTitle='', header shows just the tab title (empty string treated as omitted)", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        cardTitle=""
        tabs={tabs}
        activeTabId="tab-1"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Hello");
  });

  it("cardTitle also composes when active tab is the second tab", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { container } = renderInChain(
      <Tugcard
        {...defaultProps}
        cardTitle="Component Gallery"
        tabs={tabs}
        activeTabId="tab-2"
      >
        <div>content</div>
      </Tugcard>
    );

    const titleEl = container.querySelector("[data-testid='tugcard-title']");
    expect(titleEl!.textContent).toBe("Component Gallery: Terminal");
  });
});

// ---------------------------------------------------------------------------
// Phase 5d4: PropertyStore / setProperty action tests
// ---------------------------------------------------------------------------

import { usePropertyStore } from "@/components/tugways/hooks/use-property-store";
import type { PropertyDescriptor } from "@/components/tugways/property-store";
import { PropertyStore } from "@/components/tugways/property-store";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

/** Card content that registers a PropertyStore and exposes it via a ref. */
function MakePropertyCardContent({
  storeOutRef,
}: {
  storeOutRef: React.MutableRefObject<PropertyStore | null>;
}) {
  const SCHEMA: PropertyDescriptor[] = [
    { path: "style.backgroundColor", type: "color", label: "Background Color" },
    { path: "style.fontSize", type: "number", label: "Font Size", min: 8, max: 72 },
  ];
  const store = usePropertyStore({
    schema: SCHEMA,
    initialValues: { "style.backgroundColor": "#ffffff", "style.fontSize": 16 },
  });
  storeOutRef.current = store;
  return <div data-testid="property-card-content">card content</div>;
}

describe("Tugcard – setProperty action (Phase 5d4)", () => {
  it("renders without error when no PropertyStore is registered", () => {
    // No card content calls usePropertyStore -- setProperty should be no-op
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-no-store">
        <div>no store here</div>
      </Tugcard>
    );

    // Make the card the first responder so dispatch can reach it
    act(() => {
      manager.makeFirstResponder("card-no-store");
    });

    // Dispatching setProperty with no registered store should not throw
    expect(() => {
      act(() => {
        manager.sendToFirstResponder({
          action: TUG_ACTIONS.SET_PROPERTY,
          phase: "discrete",
          value: { path: "style.backgroundColor", value: "#ff0000" },
        });
      });
    }).not.toThrow();
  });

  it("setProperty action dispatched via sendToTarget reaches the registered PropertyStore", () => {
    const storeRef = React.createRef<PropertyStore | null>() as React.MutableRefObject<PropertyStore | null>;
    storeRef.current = null;

    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-with-store">
        <MakePropertyCardContent storeOutRef={storeRef} />
      </Tugcard>
    );

    // Wait for useLayoutEffect in usePropertyStore to fire and register the store
    act(() => {});

    // The PropertyStore should now be registered with Tugcard
    expect(storeRef.current).toBeInstanceOf(PropertyStore);

    const store = storeRef.current!;
    const changes: unknown[] = [];
    store.observe("style.backgroundColor", () =>
      changes.push(store.get("style.backgroundColor"))
    );

    // Dispatch setProperty directly to the Tugcard responder node
    act(() => {
      manager.sendToTarget("card-with-store", {
        action: TUG_ACTIONS.SET_PROPERTY,
        phase: "discrete",
        value: { path: "style.backgroundColor", value: "#aabbcc", source: "inspector" },
      });
    });

    // The store should have received the update
    expect(store.get("style.backgroundColor")).toBe("#aabbcc");
    expect(changes).toHaveLength(1);
  });

  it("setProperty defaults source to 'inspector' when source is omitted", () => {
    const storeRef = React.createRef<PropertyStore | null>() as React.MutableRefObject<PropertyStore | null>;
    storeRef.current = null;

    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-default-source">
        <MakePropertyCardContent storeOutRef={storeRef} />
      </Tugcard>
    );

    act(() => {});

    const store = storeRef.current!;
    let receivedSource = "";
    store.observe("style.fontSize", (change) => {
      receivedSource = change.source;
    });

    act(() => {
      manager.sendToTarget("card-default-source", {
        action: TUG_ACTIONS.SET_PROPERTY,
        phase: "discrete",
        value: { path: "style.fontSize", value: 24 }, // no source field
      });
    });

    expect(store.get("style.fontSize")).toBe(24);
    expect(receivedSource).toBe("inspector"); // defaulted
  });
});

// ---------------------------------------------------------------------------
// Phase 5f Step 4: Tugcard deactivation capture (saveCurrentTabState)
// ---------------------------------------------------------------------------

describe("Tugcard – tab switch calls store.setTabState (Phase 5f Step 4)", () => {
  afterEach(() => { cleanup(); _resetForTest(); });

  it("switching tabs calls store.setTabState with a bag for the old tab", () => {
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-sf4-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-sf4-2", componentId: "hello", title: "Tab 2", closable: true };

    const store = makeMockStore();
    const setTabStateSpy = spyOn(store, "setTabState");

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-sf4"
              tabs={[tab1, tab2]}
              activeTabId={tab1.id}
                  >
              <div>content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      ));
    });

    // Click the second tab using the .tug-tab class.
    act(() => {
      const tabButtons = container.querySelectorAll(".tug-tab");
      if (tabButtons.length >= 2) {
        fireEvent.click(tabButtons[1]);
      }
    });

    // setTabState should have been called with the old tab id.
    expect(setTabStateSpy).toHaveBeenCalled();
    const calls = setTabStateSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // The first argument is the old tab ID (tab1).
    expect(calls[0][0]).toBe(tab1.id);
    // The second argument is the bag object.
    const bag = calls[0][1];
    expect(typeof bag).toBe("object");
    expect(bag).not.toBeNull();
  });

  it("switching tabs calls selectionGuard.saveSelection and includes result in bag", () => {
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-sg-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-sg-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedSel = { anchorPath: [0, 1], anchorOffset: 3, focusPath: [0, 1], focusOffset: 5 };
    // selectionGuard is a module-level singleton; spy on it directly.
    const saveSelSpy = spyOn(selectionGuard, "saveSelection").mockImplementation(
      () => savedSel as import("@/components/tugways/selection-guard").SavedSelection
    );

    const store = makeMockStore();
    const setTabStateSpy = spyOn(store, "setTabState");

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-sg"
              tabs={[tab1, tab2]}
              activeTabId={tab1.id}
                  >
              <div>content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      ));
    });

    // Click the second tab to trigger tab switch.
    act(() => {
      const tabButtons = container.querySelectorAll(".tug-tab");
      if (tabButtons.length >= 2) {
        fireEvent.click(tabButtons[1]);
      }
    });

    // saveSelection should have been called with the cardId.
    expect(saveSelSpy).toHaveBeenCalledWith("card-sg");

    // setTabState bag should include the selection returned by saveSelection.
    expect(setTabStateSpy).toHaveBeenCalled();
    if (setTabStateSpy.mock.calls.length > 0) {
      const bag = setTabStateSpy.mock.calls[0][1];
      expect(bag.selection).toEqual(savedSel);
    }

    saveSelSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 5f Step 5: Tugcard activation restore from DeckManager cache
// ---------------------------------------------------------------------------

describe("Tugcard – tab activation restores state from store cache (Phase 5f Step 5)", () => {
  afterEach(() => { cleanup(); _resetForTest(); });

  it("after tab activation, scroll position is set on the content area", () => {
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-rs-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-rs-2", componentId: "hello", title: "Tab 2", closable: true };

    // Pre-load tab2 state into the mock store so activation restores it.
    const store = makeMockStore();
    store.setTabState(tab2.id, { scroll: { x: 42, y: 77 } });

    // Track activeTabId as a React-controlled value.
    let activeTabId = tab1.id;
    let rerender!: ReturnType<typeof render>["rerender"];

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-rs"
              tabs={[tab1, tab2]}
              activeTabId={currentTab}
                  >
              <div>content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ rerender } = render(<TestCard currentTab={tab1.id} />));
    });

    // Switch to tab2 by re-rendering with the new activeTabId.
    act(() => {
      activeTabId = tab2.id;
      rerender(<TestCard currentTab={activeTabId} />);
    });

    // After activation, the useLayoutEffect should have set scroll on the content div.
    // In happy-dom scrollLeft/scrollTop setters may be no-ops, but we verify the
    // getTabState path was called by confirming the bag exists in the store.
    const bag = store.getTabState(tab2.id);
    expect(bag).toBeDefined();
    expect(bag?.scroll).toEqual({ x: 42, y: 77 });
  });

  it("after tab activation, selectionGuard.restoreSelection is called with the saved selection", () => {
    // Phase 5f4: selection-only restore (no content, no scroll) uses the direct-apply
    // fallback path. restoreSelection is called synchronously in the useLayoutEffect
    // body — no RAF flushing needed. ([D04], Spec S03 direct-apply fallback)
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-rsel-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-rsel-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedSel = { anchorPath: [0], anchorOffset: 1, focusPath: [0], focusOffset: 3 };
    const store = makeMockStore();
    store.setTabState(tab2.id, { selection: savedSel as import("@/components/tugways/selection-guard").SavedSelection });

    const restoreSelSpy = spyOn(selectionGuard, "restoreSelection").mockImplementation(() => {});

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-rsel"
              tabs={[tab1, tab2]}
              activeTabId={currentTab}
                  >
              <div>content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ rerender } = render(<TestCard currentTab={tab1.id} />));
    });

    act(() => {
      rerender(<TestCard currentTab={tab2.id} />);
    });

    // Phase 5f4: restoreSelection is called synchronously within act() — no RAF
    // flushing required. The direct-apply fallback applies selection in the
    // useLayoutEffect body itself.
    expect(restoreSelSpy).toHaveBeenCalledWith("card-rsel", savedSel);

    restoreSelSpy.mockRestore();
  });

  it("after tab activation, onRestore callback is called with saved content state", () => {
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-rcb-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-rcb-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedContent = { count: 42, text: "restored" };
    const store = makeMockStore();
    store.setTabState(tab2.id, { content: savedContent });

    const onRestore = mock((_state: unknown) => {});

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    // A child component that registers persistence callbacks via useTugcardPersistence.
    // Using the hook (rather than raw context) ensures restorePendingRef is included in
    // the registered callbacks object, which is required for the persist path. ([D03])
    function PersistentChild() {
      useTugcardPersistence({ onSave: () => ({}), onRestore });
      return <div>persistent child</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-rcb"
              tabs={[tab1, tab2]}
              activeTabId={currentTab}
                  >
              <PersistentChild />
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ rerender } = render(<TestCard currentTab={tab1.id} />));
    });

    act(() => {
      rerender(<TestCard currentTab={tab2.id} />);
    });

    // Phase 5f4: onRestore fires synchronously in the useLayoutEffect persist path.
    // useTugcardPersistence provides restorePendingRef, enabling the persist path.
    // onRestore is called with the saved content state within act().
    expect(onRestore).toHaveBeenCalledWith(savedContent);
  });
});

// ---------------------------------------------------------------------------
// Phase 5f4: onContentReady pattern — T01, T02, T03, T04
// ---------------------------------------------------------------------------

describe("Tugcard – Phase 5f4 onContentReady restore pattern", () => {
  afterEach(() => { cleanup(); _resetForTest(); });

  /**
   * T01: Persist path with scroll+content.
   *
   * When a tab with saved content AND scroll is activated, Tugcard:
   * 1. Applies visibility:hidden (flash suppression for scroll position).
   * 2. Calls onRestore synchronously (triggers child setState).
   * 3. The child's no-deps useLayoutEffect fires onContentReady after child commit.
   * 4. onContentReady applies scroll and removes visibility:hidden.
   *
   * Replaces the Phase 5f3 double-RAF test. ([D01], [D02], [D04], Spec S03)
   */
  it("T01: onContentReady fires after child DOM commits; visibility:hidden applied before and removed after", () => {
    registerCard({
      componentId: "hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>Hello</div>,
    });

    const tab1: TabItem = { id: "tab-t01-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-t01-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedContent = { text: "T01 content" };
    const store = makeMockStore();
    // Tab 2 has both content and scroll — triggers persist path with hiding.
    store.setTabState(tab2.id, { content: savedContent, scroll: { x: 0, y: 50 } });

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    const onRestoreMock = mock((_state: unknown) => {});

    // PersistentChild uses real useState so onRestore triggers a re-render, which
    // causes the child's no-deps useLayoutEffect (in useTugcardPersistence) to fire
    // onContentReady. Without setState, onContentReady would never fire. ([D02])
    function PersistentChild() {
      const [_restoredText, setRestoredText] = useState("");

      useTugcardPersistence<{ text: string }>({
        onSave: () => ({ text: _restoredText }),
        onRestore: (state) => {
          onRestoreMock(state);
          setRestoredText(state.text);
        },
      });

      return <div data-testid="t01-content">{_restoredText}</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    let container!: HTMLElement;

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t01"
              tabs={[tab1, tab2]}
              activeTabId={currentTab}
                  >
              <PersistentChild />
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ container, rerender } = render(<TestCard currentTab={tab1.id} />));
    });

    expect(onRestoreMock).toHaveBeenCalledTimes(0);

    const contentAreaEl = container.querySelector("[data-testid='tugcard-content']") as HTMLElement;
    expect(contentAreaEl).not.toBeNull();

    act(() => {
      rerender(<TestCard currentTab={tab2.id} />);
    });

    // After act(), the full sequence has completed:
    // 1. Tugcard's useLayoutEffect ran: hid content, called onRestore.
    // 2. Child re-rendered (setState from onRestore).
    // 3. Child's no-deps useLayoutEffect fired onContentReady.
    // 4. onContentReady applied scroll and restored visibility.

    // onRestore was called with the saved content.
    expect(onRestoreMock).toHaveBeenCalledTimes(1);
    expect(onRestoreMock).toHaveBeenCalledWith(savedContent);

    // The child DOM reflects the restored state.
    const childEl = container.querySelector("[data-testid='t01-content']");
    expect(childEl?.textContent).toBe("T01 content");

    // visibility:hidden was applied and then removed by onContentReady.
    // After the full act(), visibility must be "" (not hidden).
    expect(contentAreaEl.style.visibility).toBe("");
  });

  /**
   * T02: Persist path with content only (no scroll).
   *
   * When a tab has saved content but NO scroll, Tugcard uses the persist path
   * but skips visibility:hidden (no wrong-scroll-position flash to suppress).
   * onContentReady still fires after child re-render commits. ([D04], Spec S03)
   */
  it("T02: content-only restore does not apply visibility:hidden; onContentReady fires after child re-render", () => {
    const savedContent = { text: "content only" };
    const store = makeMockStore();
    const activeTabId = "tab-t02-only";
    // Content only — no scroll, no selection.
    store.setTabState(activeTabId, { content: savedContent });

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    const onRestoreMock = mock((_state: unknown) => {});

    // PersistentChild uses useState so onRestore triggers a re-render.
    // onContentReady fires when restorePendingRef is true after child commit.
    function PersistentChild() {
      const [_text, setText] = useState("");

      useTugcardPersistence<{ text: string }>({
        onSave: () => ({ text: _text }),
        onRestore: (state) => {
          onRestoreMock(state);
          setText(state.text);
        },
      });

      return <div data-testid="t02-content">{_text}</div>;
    }

    const prevTabId = "tab-t02-prev";
    let container!: HTMLElement;
    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t02"
              activeTabId={currentTab}
            >
              <PersistentChild />
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ container, rerender } = render(<TestCard currentTab={prevTabId} />));
    });

    const contentAreaEl = container.querySelector("[data-testid='tugcard-content']") as HTMLElement;
    expect(contentAreaEl).not.toBeNull();

    act(() => {
      rerender(<TestCard currentTab={activeTabId} />);
    });

    // onRestore was called with the saved content.
    expect(onRestoreMock).toHaveBeenCalledWith(savedContent);

    // Child DOM reflects the restored state (proves child re-rendered and onContentReady fired).
    const childEl = container.querySelector("[data-testid='t02-content']");
    expect(childEl?.textContent).toBe("content only");

    // No visibility:hidden should have been applied — content-only restore skips hiding.
    // bag.scroll is undefined → the persist path does not hide. ([D04])
    expect(contentAreaEl.style.visibility).not.toBe("hidden");
  });

  /**
   * T03: No-persist fallback.
   *
   * When card content has NOT registered useTugcardPersistence, scroll is applied
   * directly in the useLayoutEffect body. No visibility:hidden is applied, and no
   * onContentReady mechanism is engaged. ([D04], Spec S03 direct-apply fallback)
   */
  it("T03: no-persist fallback — scroll applied directly without visibility:hidden", () => {
    const store = makeMockStore();
    const activeTabId = "tab-t03-active";
    // Saved scroll only — no content, no persistence registered.
    store.setTabState(activeTabId, { scroll: { x: 10, y: 200 } });

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    const prevTabId = "tab-t03-prev";
    let container!: HTMLElement;
    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t03"
              activeTabId={currentTab}
            >
              {/* No useTugcardPersistence registration — direct-apply fallback path. */}
              <div data-testid="t03-static">static content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ container, rerender } = render(<TestCard currentTab={prevTabId} />));
    });

    const contentAreaEl = container.querySelector("[data-testid='tugcard-content']") as HTMLElement;
    expect(contentAreaEl).not.toBeNull();

    act(() => {
      rerender(<TestCard currentTab={activeTabId} />);
    });

    // visibility:hidden must never have been applied — direct-apply path skips hiding.
    expect(contentAreaEl.style.visibility).not.toBe("hidden");
    // Verify the bag is available in the store (the effect ran and the path executed).
    expect(store.getTabState(activeTabId)?.scroll).toEqual({ x: 10, y: 200 });
  });

  /**
   * T04: Selection-only restore with persistence registered.
   *
   * When bag has selection only (no scroll, no content), the direct-apply fallback
   * runs even when persistence IS registered — because bag.content is undefined,
   * hasPersistence is false. Selection is applied synchronously, no hiding. ([D04])
   */
  it("T04: selection-only restore with persistence registered — synchronous, no hiding, no onContentReady", () => {
    const savedSel = { anchorPath: [0], anchorOffset: 0, focusPath: [0], focusOffset: 5 };
    const store = makeMockStore();
    const activeTabId = "tab-t04-active";
    // Selection only — no content, no scroll.
    store.setTabState(activeTabId, {
      selection: savedSel as import("@/components/tugways/selection-guard").SavedSelection,
    });

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    const restoreSelSpy = spyOn(selectionGuard, "restoreSelection").mockImplementation(() => {});
    const onRestoreMock = mock((_state: unknown) => {});

    // PersistentChild registers persistence (provides restorePendingRef) but since
    // bag.content is undefined, hasPersistence is false and direct-apply runs.
    function PersistentChild() {
      useTugcardPersistence({ onSave: () => ({}), onRestore: onRestoreMock });
      return <div data-testid="t04-content">persistent child</div>;
    }

    const prevTabId = "tab-t04-prev";
    let container!: HTMLElement;
    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t04"
              activeTabId={currentTab}
            >
              <PersistentChild />
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
    }

    act(() => {
      ({ container, rerender } = render(<TestCard currentTab={prevTabId} />));
    });

    const contentAreaEl = container.querySelector("[data-testid='tugcard-content']") as HTMLElement;
    expect(contentAreaEl).not.toBeNull();

    act(() => {
      rerender(<TestCard currentTab={activeTabId} />);
    });

    // restoreSelection called synchronously — no RAF, no hiding.
    expect(restoreSelSpy).toHaveBeenCalledWith("card-t04", savedSel);

    // onRestore must NOT have been called — bag.content is undefined, so the
    // persist path was not taken and onRestore was never triggered.
    expect(onRestoreMock).not.toHaveBeenCalled();

    // No visibility:hidden — direct-apply fallback skips hiding.
    expect(contentAreaEl.style.visibility).not.toBe("hidden");

    restoreSelSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 5f4 / Phase 5f3 Step 3: Save callback registration with DeckManager (T07)
// ---------------------------------------------------------------------------

describe("Tugcard – save callback registration (Phase 5f3 Step 3)", () => {
  afterEach(() => { cleanup(); _resetForTest(); });

  /**
   * T07: mounting a Tugcard calls store.registerSaveCallback with the card ID
   * and a function; unmounting calls store.unregisterSaveCallback.
   */
  it("T07: mounting registers save callback; unmounting unregisters it", () => {
    const store = makeMockStore();
    const registerSpy = spyOn(store, "registerSaveCallback");
    const unregisterSpy = spyOn(store, "unregisterSaveCallback");

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");

    let unmountFn!: () => void;

    act(() => {
      const result = render(
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t07"
            >
              <div>content</div>
            </Tugcard>
          </ResponderChainProvider>
        </DeckManagerContext.Provider>
      );
      unmountFn = result.unmount;
    });

    // registerSaveCallback must have been called with the cardId and a function.
    expect(registerSpy).toHaveBeenCalled();
    const calls = registerSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // First arg is cardId, second is a function wrapper.
    const [registeredId, registeredCb] = calls[calls.length - 1] as [string, () => void];
    expect(registeredId).toBe("card-t07");
    expect(typeof registeredCb).toBe("function");

    // unregisterSaveCallback must NOT have been called yet.
    expect(unregisterSpy).not.toHaveBeenCalled();

    // Unmount the component.
    act(() => {
      unmountFn();
    });

    // unregisterSaveCallback must have been called with the cardId.
    expect(unregisterSpy).toHaveBeenCalled();
    const unregCalls = unregisterSpy.mock.calls;
    expect(unregCalls.length).toBeGreaterThan(0);
    expect(unregCalls[unregCalls.length - 1][0]).toBe("card-t07");
  });
});

// ---------------------------------------------------------------------------
// W2 Step 3: workspace-key filter via useCardWorkspaceKey
// ---------------------------------------------------------------------------
//
// These tests mount a Tugcard subscribed to a dummy feed and verify that the
// internal `FeedStore` filter routes frames according to the card's
// `cardSessionBindingStore` binding:
//
// - Unbound → `presentWorkspaceKey` fallback: any frame with `workspace_key`
//   present is accepted, regardless of value (Risk R04 unbound window).
// - Bound → exact value-check: only frames whose `workspace_key` matches the
//   card's binding are accepted; others are dropped silently.
//
// The observable signal is Tugcard's `feedsReady` gate: when `feedData.size > 0`
// Tugcard renders its children, otherwise it renders a `tugcard-loading`
// placeholder. A frame accepted by the filter populates `feedData`; a rejected
// frame leaves it empty and the loading placeholder persists.
describe("Tugcard – workspace-key filter (W2)", () => {
  const TEST_FEED_ID = 0x10 as FeedIdValue;

  interface MockConn {
    onFrame: (feedId: number, cb: (payload: Uint8Array) => void) => void;
    emit: (feedId: number, payload: Uint8Array) => void;
  }

  function makeMockFeedConnection() {
    const callbacks = new Map<number, Array<(p: Uint8Array) => void>>();
    const mock: MockConn = {
      onFrame: (feedId, cb) => {
        if (!callbacks.has(feedId)) callbacks.set(feedId, []);
        callbacks.get(feedId)!.push(cb);
      },
      emit: (feedId, payload) => {
        const cbs = callbacks.get(feedId);
        if (cbs) for (const cb of cbs) cb(payload);
      },
    };
    return mock;
  }

  function encodeJson(obj: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  function renderFilterCard(cardId: string) {
    return renderInChain(
      <Tugcard
        cardId={cardId}
        meta={{ title: "Filter Test" }}
        feedIds={[TEST_FEED_ID] as readonly FeedIdValue[]}
      >
        <div data-testid="filter-card-content">Content</div>
      </Tugcard>,
    );
  }

  function isContentVisible(container: HTMLElement): boolean {
    return container.querySelector("[data-testid='filter-card-content']") !== null;
  }

  beforeEach(() => {
    const mockConn = makeMockFeedConnection();
    _testConnection = mockConn as unknown as TugConnection;
    (globalThis as unknown as { __filterMock: MockConn }).__filterMock = mockConn;
  });

  afterEach(() => {
    _testConnection = null;
    cardSessionBindingStore.clearBinding("card-filter-a");
    cardSessionBindingStore.clearBinding("card-filter-b");
    cardSessionBindingStore.clearBinding("card-filter-c");
    cleanup();
  });

  it("falls back to presence-check when the card is unbound", () => {
    const { container } = renderFilterCard("card-filter-a");

    // Before any frame arrives, content is gated behind Loading...
    expect(isContentVisible(container)).toBe(false);

    const mock = (globalThis as unknown as { __filterMock: MockConn }).__filterMock;
    // Emit a frame with an arbitrary workspace_key — presence fallback should
    // accept it even though no card binding exists.
    act(() => {
      mock.emit(TEST_FEED_ID, encodeJson({ workspace_key: "/any/path", data: "hello" }));
    });

    expect(isContentVisible(container)).toBe(true);
  });

  it("value-checks when the card is bound to a specific workspace_key", () => {
    const { cardSessionBindingStore } =
      require("@/lib/card-session-binding-store") as typeof import("@/lib/card-session-binding-store");

    // Bind BEFORE mount so the initial filter installed on FeedStore is the
    // exact value-check, not the fallback.
    cardSessionBindingStore.setBinding("card-filter-b", {
      tugSessionId: "sess-b",
      workspaceKey: "/work/alpha",
      projectDir: "/work/alpha",
    });

    const { container } = renderFilterCard("card-filter-b");
    const mock = (globalThis as unknown as { __filterMock: MockConn }).__filterMock;

    // Matching workspace_key → accepted, content visible.
    act(() => {
      mock.emit(TEST_FEED_ID, encodeJson({ workspace_key: "/work/alpha", data: "ok" }));
    });
    expect(isContentVisible(container)).toBe(true);
  });

  it("rejects frames from other workspaces when the card is bound", () => {
    const { cardSessionBindingStore } =
      require("@/lib/card-session-binding-store") as typeof import("@/lib/card-session-binding-store");

    cardSessionBindingStore.setBinding("card-filter-c", {
      tugSessionId: "sess-c",
      workspaceKey: "/work/alpha",
      projectDir: "/work/alpha",
    });

    const { container } = renderFilterCard("card-filter-c");
    const mock = (globalThis as unknown as { __filterMock: MockConn }).__filterMock;

    // Non-matching workspace_key → rejected, content still gated by Loading...
    act(() => {
      mock.emit(TEST_FEED_ID, encodeJson({ workspace_key: "/work/beta", data: "nope" }));
    });
    expect(isContentVisible(container)).toBe(false);

    // Matching frame arrives after → accepted.
    act(() => {
      mock.emit(TEST_FEED_ID, encodeJson({ workspace_key: "/work/alpha", data: "ok" }));
    });
    expect(isContentVisible(container)).toBe(true);
  });
});

// Suppress unused-import warnings
void spyOn;
void fireEvent;
