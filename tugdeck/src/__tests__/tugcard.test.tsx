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
import { registerCard, _resetForTest } from "@/card-registry";
import type { TabItem } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a Tugcard inside a ResponderChainProvider.
 * Tugcard calls useResponder which requires a chain context.
 */
function renderInChain(ui: React.ReactElement) {
  return render(
    <ResponderChainProvider>{ui}</ResponderChainProvider>
  );
}

/**
 * Render a Tugcard inside a manually-controlled ResponderChainManager.
 * Lets tests inspect the manager directly after render.
 */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>
  );
  return { ...result, manager };
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

    manager.dispatch("close");
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
      manager.dispatch("nextTab");
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
      manager.dispatch("previousTab");
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
      manager.dispatch("nextTab");
      manager.dispatch("previousTab");
    });

    expect(selectedIds.length).toBe(0);
  });
});

// Suppress unused-import warnings
void spyOn;
void fireEvent;
