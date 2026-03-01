/**
 * TabBar React component RTL tests — Step 7.
 *
 * Tests cover:
 * - Renders tabs with correct labels and active state
 * - Click on inactive tab fires onTabActivate
 * - Click on close button fires onTabClose with correct tab id
 * - Drag threshold: small movement does not trigger reorder, fires onTabActivate instead
 * - closable=false tabs do not render close button
 * - Re-rendering with new props updates active state (prop-based, no imperative handle)
 *
 * Spec S04
 * [D02] React synthetic events
 * [D04] Unified single React root — forwardRef/useImperativeHandle removed
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { TabBar } from "@/components/chrome/tab-bar";
import type { TabBarCallbacks } from "@/components/chrome/tab-bar";
import type { TabItem } from "@/layout-tree";

// ---- Setup ----

// Provide PointerEvent stub for happy-dom environments
if (typeof (global as Record<string, unknown>)["PointerEvent"] === "undefined") {
  (global as Record<string, unknown>)["PointerEvent"] = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
      this.pointerId = (init as { pointerId?: number })?.pointerId ?? 1;
    }
  };
}

const proto = Element.prototype as Record<string, unknown>;
if (!proto["hasPointerCapture"]) proto["hasPointerCapture"] = () => false;
if (!proto["setPointerCapture"]) proto["setPointerCapture"] = () => {};
if (!proto["releasePointerCapture"]) proto["releasePointerCapture"] = () => {};

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---- Helpers ----

function makeTab(index: number, overrides: Partial<TabItem> = {}): TabItem {
  return {
    id: `tab-id-${index}`,
    componentId: `component-${index}`,
    title: `Tab ${index}`,
    closable: true,
    ...overrides,
  };
}

function makeTabs(count: number): TabItem[] {
  return Array.from({ length: count }, (_, i) => makeTab(i));
}

function makeCallbacks(
  overrides: Partial<TabBarCallbacks> = {}
): {
  callbacks: TabBarCallbacks;
  onTabActivate: ReturnType<typeof mock>;
  onTabClose: ReturnType<typeof mock>;
  onTabReorder: ReturnType<typeof mock>;
} {
  const onTabActivate = mock((_tabIndex: number) => {});
  const onTabClose = mock((_tabId: string) => {});
  const onTabReorder = mock((_from: number, _to: number) => {});
  const callbacks: TabBarCallbacks = {
    onTabActivate,
    onTabClose,
    onTabReorder,
    ...overrides,
  };
  return { callbacks, onTabActivate, onTabClose, onTabReorder };
}

function renderTabBar(tabs: TabItem[], activeTabIndex: number, callbacks: TabBarCallbacks) {
  return render(
    <TabBar tabs={tabs} activeTabIndex={activeTabIndex} callbacks={callbacks} />
  );
}

// ---- Tests ----

describe("TabBar – DOM structure", () => {
  it("renders .card-tab-bar root element", () => {
    const { callbacks } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    expect(container.querySelector(".card-tab-bar")).not.toBeNull();
  });

  it("renders one .card-tab per TabItem", () => {
    const { callbacks } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    expect(container.querySelectorAll(".card-tab").length).toBe(3);
  });

  it("active tab has card-tab-active class; inactive tabs do not", () => {
    const { callbacks } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 1, callbacks);
    const tabs = container.querySelectorAll(".card-tab");
    expect(tabs[0].classList.contains("card-tab-active")).toBe(false);
    expect(tabs[1].classList.contains("card-tab-active")).toBe(true);
    expect(tabs[2].classList.contains("card-tab-active")).toBe(false);
  });

  it("renders tab labels matching TabItem.title", () => {
    const { callbacks } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    const labels = container.querySelectorAll(".card-tab-label");
    expect((labels[0] as HTMLElement).textContent).toBe("Tab 0");
    expect((labels[1] as HTMLElement).textContent).toBe("Tab 1");
  });

  it("each closable tab renders a close button", () => {
    const { callbacks } = makeCallbacks();
    const tabs = makeTabs(2);
    const { container } = renderTabBar(tabs, 0, callbacks);
    expect(container.querySelectorAll(".card-tab-close").length).toBe(2);
  });

  it("closable=false tabs do not render a close button", () => {
    const { callbacks } = makeCallbacks();
    const tabs = [
      makeTab(0, { closable: false }),
      makeTab(1, { closable: true }),
    ];
    const { container } = renderTabBar(tabs, 0, callbacks);
    const closeButtons = container.querySelectorAll(".card-tab-close");
    expect(closeButtons.length).toBe(1);
  });
});

describe("TabBar – click-to-switch", () => {
  it("pointerdown on inactive tab fires onTabActivate with correct index", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");
    fireEvent.pointerDown(tabs[2], { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(tabs[2], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(2);
  });

  it("pointerdown on active tab still fires onTabActivate", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");
    fireEvent.pointerDown(tabs[0], { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(tabs[0], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(0);
  });

  it("pointerdown with non-primary button does not fire onTabActivate", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");
    fireEvent.pointerDown(tabs[1], { pointerId: 1, clientX: 0, clientY: 0, button: 2 });
    fireEvent.pointerUp(tabs[1], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onTabActivate).not.toHaveBeenCalled();
  });
});

describe("TabBar – close button", () => {
  it("click on close button fires onTabClose with correct tab id", () => {
    const { callbacks, onTabClose, onTabActivate } = makeCallbacks();
    const tabs = makeTabs(2);
    const { container } = renderTabBar(tabs, 0, callbacks);
    const closeButtons = container.querySelectorAll<HTMLElement>(".card-tab-close");
    fireEvent.click(closeButtons[1]);
    expect(onTabClose).toHaveBeenCalledTimes(1);
    expect((onTabClose.mock.calls[0] as [string])[0]).toBe("tab-id-1");
    expect(onTabActivate).not.toHaveBeenCalled();
  });

  it("pointerdown on close button does not start a tab drag", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const tabs = makeTabs(2);
    const { container } = renderTabBar(tabs, 0, callbacks);
    const closeButton = container.querySelector<HTMLElement>(".card-tab-close")!;
    fireEvent.pointerDown(closeButton, {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    fireEvent.pointerMove(closeButton, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerUp(closeButton, { pointerId: 1, clientX: 100, clientY: 0 });
    expect(onTabActivate).not.toHaveBeenCalled();
  });
});

describe("TabBar – drag reorder threshold", () => {
  it("small movement (< 5px threshold) does not trigger reorder, fires onTabActivate", () => {
    const { callbacks, onTabActivate, onTabReorder } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");

    fireEvent.pointerDown(tabs[1], { pointerId: 1, clientX: 100, clientY: 0, button: 0 });
    fireEvent.pointerMove(tabs[1], { pointerId: 1, clientX: 103, clientY: 0 });
    fireEvent.pointerUp(tabs[1], { pointerId: 1, clientX: 103, clientY: 0 });

    expect(onTabReorder).not.toHaveBeenCalled();
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(1);
  });

  it("movement at threshold (> 5px) does not trigger activate", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");

    tabs[0].getBoundingClientRect = () => ({
      left: 0, right: 100, top: 0, bottom: 30,
      width: 100, height: 30, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    tabs[1].getBoundingClientRect = () => ({
      left: 100, right: 200, top: 0, bottom: 30,
      width: 100, height: 30, x: 100, y: 0, toJSON: () => ({}),
    } as DOMRect);
    tabs[2].getBoundingClientRect = () => ({
      left: 200, right: 300, top: 0, bottom: 30,
      width: 100, height: 30, x: 200, y: 0, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(tabs[1], { pointerId: 1, clientX: 150, clientY: 0, button: 0 });
    fireEvent.pointerMove(tabs[1], { pointerId: 1, clientX: 156, clientY: 0 });
    fireEvent.pointerUp(tabs[1], { pointerId: 1, clientX: 156, clientY: 0 });

    expect(onTabActivate).not.toHaveBeenCalled();
  });
});

describe("TabBar – prop-based updates (replaces imperative handle)", () => {
  it("re-rendering with new activeTabIndex updates active tab class", async () => {
    const { callbacks } = makeCallbacks();
    const tabs = makeTabs(3);

    const { container, rerender } = render(
      <TabBar tabs={tabs} activeTabIndex={0} callbacks={callbacks} />
    );
    await act(async () => {});

    let tabEls = container.querySelectorAll(".card-tab");
    expect(tabEls[0].classList.contains("card-tab-active")).toBe(true);
    expect(tabEls[2].classList.contains("card-tab-active")).toBe(false);

    // Re-render with tab 2 active (DeckCanvas passes new props on state change)
    await act(async () => {
      rerender(<TabBar tabs={tabs} activeTabIndex={2} callbacks={callbacks} />);
    });

    tabEls = container.querySelectorAll(".card-tab");
    expect(tabEls[0].classList.contains("card-tab-active")).toBe(false);
    expect(tabEls[2].classList.contains("card-tab-active")).toBe(true);
  });

  it("re-rendering with updated tab list shows new tabs", async () => {
    const { callbacks } = makeCallbacks();
    const tabs = makeTabs(2);

    const { container, rerender } = render(
      <TabBar tabs={tabs} activeTabIndex={0} callbacks={callbacks} />
    );
    await act(async () => {});
    expect(container.querySelectorAll(".card-tab").length).toBe(2);

    const newTabs = [...tabs, makeTab(2)];
    await act(async () => {
      rerender(<TabBar tabs={newTabs} activeTabIndex={0} callbacks={callbacks} />);
    });

    expect(container.querySelectorAll(".card-tab").length).toBe(3);
  });
});
