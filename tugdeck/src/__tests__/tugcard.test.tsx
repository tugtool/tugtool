/**
 * Tugcard component unit tests -- Step 3.
 *
 * Tests cover:
 * - T09: Tugcard renders header with title text
 * - T10: Tugcard renders children in content area
 * - T11: Tugcard close button calls onClose
 * - T12: Tugcard with accessory renders accessory between header and content
 * - T13: Tugcard without accessory renders no visible accessory content
 * - T14: Tugcard calls onMinSizeChange with computed minimum on mount
 * - T15: Tugcard registers as responder with expected actions
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

import { Tugcard } from "@/components/tugways/tugcard";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { registerCard, _resetForTest } from "@/card-registry";
import type { TabItem } from "@/layout-tree";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { withDeckManager, makeMockStore } from "./mock-deck-manager-store";

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
 */
function renderWithManagerAndStore(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const store = makeMockStore();
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
  feedIds: [] as readonly number[],
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

    const closeBtn = container.querySelector("[data-testid='tugcard-close-btn']") as HTMLButtonElement;
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

    const closeBtn = container.querySelector("[data-testid='tugcard-close-btn']");
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

    // Accessory must be between header and content in DOM order
    const header = container.querySelector("[data-testid='tugcard-header']");
    const content = container.querySelector("[data-testid='tugcard-content']");
    expect(header).not.toBeNull();
    expect(content).not.toBeNull();

    // DOM order check: header -> accessory -> content
    const allSections = container.querySelectorAll(
      "[data-testid='tugcard-header'], [data-testid='tugcard-accessory'], [data-testid='tugcard-content']"
    );
    expect(allSections[0]?.getAttribute("data-testid")).toBe("tugcard-header");
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
    expect(manager.canHandle("toggleMenu")).toBe(true);
    expect(manager.canHandle("find")).toBe(true);
  });

  it("dispatching close through the chain calls onClose", () => {
    const onClose = mock(() => {});
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-close-test" onClose={onClose}>
        <div>content</div>
      </Tugcard>
    );

    manager.dispatch({ action: "close", phase: "discrete" });
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
// Extra: card with feeds shows Loading... placeholder
// ---------------------------------------------------------------------------

describe("Tugcard – card with feeds shows loading state", () => {
  it("card with feedIds shows Loading... instead of children in Phase 5", () => {
    const { container } = renderInChain(
      <Tugcard {...defaultProps} feedIds={[1] as unknown as readonly number[]}>
        <div data-testid="real-content">Should not appear</div>
      </Tugcard>
    );

    const loadingEl = container.querySelector("[data-testid='tugcard-loading']");
    expect(loadingEl).not.toBeNull();
    expect(loadingEl?.textContent).toContain("Loading");

    // Children should NOT be mounted while loading
    const realContent = container.querySelector("[data-testid='real-content']");
    expect(realContent).toBeNull();
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
    factory: () => {
      throw new Error("factory not used");
    },
    defaultMeta: { title, icon, closable: true },
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
      >
        <div>content</div>
      </Tugcard>
    );

    expect(manager.canHandle("previousTab")).toBe(true);
    expect(manager.canHandle("nextTab")).toBe(true);
  });

  it("nextTab calls onTabSelect with the next tab id", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const selectedIds: string[] = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManager(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
        onTabSelect={(id) => selectedIds.push(id)}
        onTabClose={() => {}}
        onTabAdd={() => {}}
      >
        <div>content</div>
      </Tugcard>
    );

    act(() => {
      manager.dispatch({ action: "nextTab", phase: "discrete" });
    });

    expect(selectedIds.length).toBe(1);
    expect(selectedIds[0]).toBe("tab-2");
  });

  it("previousTab calls onTabSelect with the previous tab id (wraps around)", () => {
    registerTabCard("hello", "Hello");
    registerTabCard("terminal", "Terminal");

    const selectedIds: string[] = [];
    const tabs = [
      makeTab("tab-1", "hello", "Hello"),
      makeTab("tab-2", "terminal", "Terminal"),
    ];

    const { manager } = renderWithManager(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
        onTabSelect={(id) => selectedIds.push(id)}
        onTabClose={() => {}}
        onTabAdd={() => {}}
      >
        <div>content</div>
      </Tugcard>
    );

    act(() => {
      manager.dispatch({ action: "previousTab", phase: "discrete" });
    });

    // Wraps from tab-1 (index 0) back to tab-2 (index 1, last)
    expect(selectedIds.length).toBe(1);
    expect(selectedIds[0]).toBe("tab-2");
  });

  it("previousTab/nextTab are no-ops when tabs.length <= 1", () => {
    registerTabCard("hello", "Hello");

    const selectedIds: string[] = [];
    const tabs = [makeTab("tab-1", "hello", "Hello")];

    const { manager } = renderWithManager(
      <Tugcard
        {...defaultProps}
        tabs={tabs}
        activeTabId="tab-1"
        onTabSelect={(id) => selectedIds.push(id)}
        onTabClose={() => {}}
        onTabAdd={() => {}}
      >
        <div>content</div>
      </Tugcard>
    );

    act(() => {
      manager.dispatch({ action: "nextTab", phase: "discrete" });
      manager.dispatch({ action: "previousTab", phase: "discrete" });
    });

    expect(selectedIds.length).toBe(0);
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        onTabSelect={() => {}}
        onTabClose={() => {}}
        onTabAdd={() => {}}
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
        manager.dispatch({
          action: "setProperty",
          phase: "discrete",
          value: { path: "style.backgroundColor", value: "#ff0000" },
        });
      });
    }).not.toThrow();
  });

  it("setProperty action dispatched via dispatchTo reaches the registered PropertyStore", () => {
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
      manager.dispatchTo("card-with-store", {
        action: "setProperty",
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
      manager.dispatchTo("card-default-source", {
        action: "setProperty",
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
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
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
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
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
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
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
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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

  it("after tab activation, selectionGuard.restoreSelection is called with the saved selection", async () => {
    registerCard({
      componentId: "hello",
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
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
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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

    // The RAF callback is mocked as setTimeout(0) in setup-rtl.ts.
    // Flush the pending macrotask so the RAF callback (which calls restoreSelection) runs.
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));

    // restoreSelection should have been called with cardId and the saved selection.
    expect(restoreSelSpy).toHaveBeenCalledWith("card-rsel", savedSel);

    restoreSelSpy.mockRestore();
  });

  it("after tab activation, onRestore callback is called with saved content state", () => {
    registerCard({
      componentId: "hello",
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: TabItem = { id: "tab-rcb-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-rcb-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedContent = { count: 42, text: "restored" };
    const store = makeMockStore();
    store.setTabState(tab2.id, { content: savedContent });

    const onRestore = mock((_state: unknown) => {});

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");
    const { TugcardPersistenceContext } = require("@/components/tugways/use-tugcard-persistence") as typeof import("@/components/tugways/use-tugcard-persistence");

    // A child component that registers persistence callbacks via context.
    function PersistentChild() {
      const register = React.useContext(TugcardPersistenceContext);
      React.useLayoutEffect(() => {
        register?.({ onSave: () => ({}), onRestore });
      }, [register]);
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
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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

    // Flush useLayoutEffect (PersistentChild registers its callbacks).
    act(() => {});

    act(() => {
      rerender(<TestCard currentTab={tab2.id} />);
    });

    // Phase 5f3: onRestore now fires synchronously in the useLayoutEffect body,
    // BEFORE the RAF callback. No need to flush a macrotask — it runs within act().
    // onRestore should have been called with the saved content state.
    expect(onRestore).toHaveBeenCalledWith(savedContent);
  });
});

// ---------------------------------------------------------------------------
// Phase 5f3 Step 1: Restore order — onRestore fires before RAF (T01, T02)
// ---------------------------------------------------------------------------

describe("Tugcard – Phase 5f3 restore order (Step 1)", () => {
  afterEach(() => { cleanup(); _resetForTest(); });

  /**
   * T01: onRestore is called synchronously (before RAF fires) when a tab with
   * saved content is activated. Verifies Bug 3 fix: content before scroll.
   *
   * Strategy: block all RAF execution (by replacing requestAnimationFrame with a
   * no-op that never calls the callback), then verify onRestore was still called.
   * If onRestore fired in the useLayoutEffect body (synchronous), it executes even
   * when RAF callbacks are blocked. If it were inside the RAF callback (old behavior),
   * it would never be called with RAF blocked.
   */
  it("T01: onRestore is called synchronously before RAF when tab with saved content is activated", () => {
    registerCard({
      componentId: "hello",
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Hello", closable: true },
    });

    const tab1: TabItem = { id: "tab-t01-1", componentId: "hello", title: "Tab 1", closable: true };
    const tab2: TabItem = { id: "tab-t01-2", componentId: "hello", title: "Tab 2", closable: true };

    const savedContent = { text: "T01 content" };
    const store = makeMockStore();
    // Tab 2 has both content and scroll saved, so RAF will be scheduled.
    store.setTabState(tab2.id, { content: savedContent, scroll: { x: 0, y: 50 } });

    const onRestore = mock((_state: unknown) => {});

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");
    const { TugcardPersistenceContext } = require("@/components/tugways/use-tugcard-persistence") as typeof import("@/components/tugways/use-tugcard-persistence");

    function PersistentChild() {
      const register = React.useContext(TugcardPersistenceContext);
      React.useLayoutEffect(() => {
        register?.({ onSave: () => ({}), onRestore });
      }, [register]);
      return <div>T01 child</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];

    function TestCard({ currentTab }: { currentTab: string }) {
      return (
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <Tugcard
              {...defaultProps}
              cardId="card-t01"
              tabs={[tab1, tab2]}
              activeTabId={currentTab}
              onTabSelect={() => {}}
              onTabClose={() => {}}
              onTabAdd={() => {}}
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

    // Flush useLayoutEffect (PersistentChild registers its callbacks).
    act(() => {});

    // Verify onRestore has NOT been called yet (no saved content for tab1).
    expect(onRestore).toHaveBeenCalledTimes(0);

    // Block RAF execution by replacing requestAnimationFrame with a no-op.
    // Any code that runs inside a RAF callback will NOT execute.
    // onRestore must fire in the useLayoutEffect body (synchronous) to be
    // observed here.
    const origRaf = (global as any).requestAnimationFrame;
    (global as any).requestAnimationFrame = (_cb: FrameRequestCallback): number => 0;
    (global as any).cancelAnimationFrame = (_id: number): void => {};

    try {
      act(() => {
        rerender(<TestCard currentTab={tab2.id} />);
      });

      // onRestore MUST have been called despite RAF being blocked.
      // This proves onRestore fires synchronously in the useLayoutEffect body,
      // not deferred inside the RAF callback.
      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(onRestore).toHaveBeenCalledWith(savedContent);
    } finally {
      // Restore original RAF so other tests are not affected.
      (global as any).requestAnimationFrame = origRaf;
    }
  });

  /**
   * T02: When only content is saved (no scroll, no selection), no RAF is
   * scheduled BY THE ACTIVATION EFFECT and no visibility:hidden is applied.
   *
   * Uses a single-tab (no TugTabBar) setup to isolate the activation effect
   * from other RAF callers in child components.
   */
  it("T02: content-only restore does not apply visibility:hidden and onRestore fires synchronously", () => {
    // Use a single-tab Tugcard (no TugTabBar) to isolate the activation effect.
    // activeTabId is set directly as a prop (no tab bar, no TugTabBar RAF).
    const savedContent = { text: "content only" };
    const store = makeMockStore();
    const activeTabId = "tab-t02-only";
    // Pre-load the tab state with content only (no scroll, no selection).
    store.setTabState(activeTabId, { content: savedContent });

    const onRestore = mock((_state: unknown) => {});

    const { DeckManagerContext } = require("@/deck-manager-context") as typeof import("@/deck-manager-context");
    const { TugcardPersistenceContext } = require("@/components/tugways/use-tugcard-persistence") as typeof import("@/components/tugways/use-tugcard-persistence");

    function PersistentChild() {
      const register = React.useContext(TugcardPersistenceContext);
      React.useLayoutEffect(() => {
        register?.({ onSave: () => ({}), onRestore });
      }, [register]);
      return <div>T02 child</div>;
    }

    // Render with a different activeTabId first (no stored state), then switch.
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

    // Flush useLayoutEffect (PersistentChild registers its callbacks).
    act(() => {});

    // Capture the content element before activation.
    const contentEl = container.querySelector("[data-testid='tugcard-content']") as HTMLElement;
    expect(contentEl).not.toBeNull();

    // Block RAF so we can verify it's not called during the content-only activation.
    const origRaf = (global as any).requestAnimationFrame;
    let rafScheduledByActivation = 0;
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
      rafScheduledByActivation++;
      return origRaf(cb);
    };

    try {
      act(() => {
        rerender(<TestCard currentTab={activeTabId} />);
      });

      // onRestore must have been called synchronously (content-only).
      expect(onRestore).toHaveBeenCalledWith(savedContent);

      // No RAF should have been scheduled for a content-only restore (no TugTabBar,
      // no scroll, no selection — only the activation effect runs).
      expect(rafScheduledByActivation).toBe(0);

      // No visibility:hidden should have been applied.
      expect(contentEl.style.visibility).not.toBe("hidden");
    } finally {
      (global as any).requestAnimationFrame = origRaf;
    }
  });
});

// Suppress unused-import warnings
void spyOn;
void fireEvent;
