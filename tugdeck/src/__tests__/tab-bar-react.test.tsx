/**
 * TabBar React component RTL tests.
 *
 * Tests cover:
 * - Renders tabs with correct labels and active state
 * - Click on inactive tab fires onTabActivate
 * - Click on close button fires onTabClose with correct tab id
 * - Drag threshold: small movement does not trigger reorder, fires onTabActivate instead
 * - closable=false tabs do not render close button
 * - Imperative handle: ref.current.getElement() returns .card-tab-bar
 * - Imperative handle: ref.current.update(node) re-renders with new state
 * - Imperative handle: ref.current.destroy() is a no-op (cleanup via React root)
 *
 * Spec S04, Spec S04a
 * [D02] React synthetic events
 * [D08] useImperativeHandle transition
 */
import "./setup-rtl";

import React, { createRef } from "react";
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import { TabBar } from "@/components/chrome/tab-bar";
import type { TabBarHandle, TabBarCallbacks } from "@/components/chrome/tab-bar";
import type { TabItem, TabNode } from "@/layout-tree";

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

function makeTab(
  index: number,
  overrides: Partial<TabItem> = {}
): TabItem {
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

function renderTabBar(
  tabs: TabItem[],
  activeTabIndex: number,
  callbacks: TabBarCallbacks,
  ref?: React.Ref<TabBarHandle>
) {
  return render(
    <TabBar
      ref={ref}
      tabs={tabs}
      activeTabIndex={activeTabIndex}
      callbacks={callbacks}
    />
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
    // Click on tab index 2 (inactive)
    fireEvent.pointerDown(tabs[2], { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(tabs[2], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(2);
  });

  it("pointerdown on active tab still fires onTabActivate", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");
    // Click on already-active tab
    fireEvent.pointerDown(tabs[0], { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(tabs[0], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(0);
  });

  it("pointerdown with non-primary button does not fire onTabActivate", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(2), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");
    // Right-click (button=2)
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
    // Click close button for tab at index 1
    fireEvent.click(closeButtons[1]);
    expect(onTabClose).toHaveBeenCalledTimes(1);
    expect((onTabClose.mock.calls[0] as [string])[0]).toBe("tab-id-1");
    // onTabActivate should NOT have been called (stopPropagation)
    expect(onTabActivate).not.toHaveBeenCalled();
  });

  it("pointerdown on close button does not start a tab drag", () => {
    const { callbacks, onTabActivate } = makeCallbacks();
    const tabs = makeTabs(2);
    const { container } = renderTabBar(tabs, 0, callbacks);
    const closeButton = container.querySelector<HTMLElement>(".card-tab-close")!;
    // Simulate pointerdown on close button
    fireEvent.pointerDown(closeButton, {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    // Move beyond threshold
    fireEvent.pointerMove(closeButton, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerUp(closeButton, { pointerId: 1, clientX: 100, clientY: 0 });
    // No activate should fire (close button intercepted pointerdown in Tab handler)
    expect(onTabActivate).not.toHaveBeenCalled();
  });
});

describe("TabBar – drag reorder threshold", () => {
  it("small movement (< 5px threshold) does not trigger reorder, fires onTabActivate", () => {
    const { callbacks, onTabActivate, onTabReorder } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");

    // Move only 3px (below 5px threshold)
    fireEvent.pointerDown(tabs[1], { pointerId: 1, clientX: 100, clientY: 0, button: 0 });
    fireEvent.pointerMove(tabs[1], { pointerId: 1, clientX: 103, clientY: 0 });
    fireEvent.pointerUp(tabs[1], { pointerId: 1, clientX: 103, clientY: 0 });

    expect(onTabReorder).not.toHaveBeenCalled();
    expect(onTabActivate).toHaveBeenCalledTimes(1);
    expect((onTabActivate.mock.calls[0] as [number])[0]).toBe(1);
  });

  it("movement exactly at threshold (5px) does not trigger activate", () => {
    const { callbacks, onTabActivate, onTabReorder } = makeCallbacks();
    const { container } = renderTabBar(makeTabs(3), 0, callbacks);
    const tabs = container.querySelectorAll<HTMLElement>(".card-tab");

    // Mock getBoundingClientRect for reorder detection (return different tab)
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

    // Move exactly 6px (above 5px threshold) — dragging starts
    fireEvent.pointerDown(tabs[1], { pointerId: 1, clientX: 150, clientY: 0, button: 0 });
    fireEvent.pointerMove(tabs[1], { pointerId: 1, clientX: 156, clientY: 0 });
    fireEvent.pointerUp(tabs[1], { pointerId: 1, clientX: 156, clientY: 0 });

    // Since dragging happened, onTabActivate should NOT be called
    expect(onTabActivate).not.toHaveBeenCalled();
  });
});

describe("TabBar – imperative handle", () => {
  it("ref.current.getElement() returns the .card-tab-bar element", async () => {
    const ref = createRef<TabBarHandle>();
    const { callbacks } = makeCallbacks();
    const { container } = render(
      <TabBar
        ref={ref}
        tabs={makeTabs(2)}
        activeTabIndex={0}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    const root = container.querySelector<HTMLElement>(".card-tab-bar")!;
    expect(ref.current!.getElement()).toBe(root);
  });

  it("ref.current.update(node) re-renders tabs with new active state", async () => {
    const ref = createRef<TabBarHandle>();
    const { callbacks } = makeCallbacks();
    const tabs = makeTabs(3);
    const { container } = render(
      <TabBar
        ref={ref}
        tabs={tabs}
        activeTabIndex={0}
        callbacks={callbacks}
      />
    );
    await act(async () => {});

    // Initially tab 0 is active
    let tabEls = container.querySelectorAll(".card-tab");
    expect(tabEls[0].classList.contains("card-tab-active")).toBe(true);
    expect(tabEls[2].classList.contains("card-tab-active")).toBe(false);

    // Update to make tab 2 active
    const updatedNode: TabNode = {
      type: "tab",
      id: "node-1",
      tabs,
      activeTabIndex: 2,
    };

    await act(async () => {
      ref.current!.update(updatedNode);
    });

    tabEls = container.querySelectorAll(".card-tab");
    expect(tabEls[0].classList.contains("card-tab-active")).toBe(false);
    expect(tabEls[2].classList.contains("card-tab-active")).toBe(true);
  });

  it("ref.current.update(node) re-renders with updated tab list", async () => {
    const ref = createRef<TabBarHandle>();
    const { callbacks } = makeCallbacks();
    const tabs = makeTabs(2);
    const { container } = render(
      <TabBar
        ref={ref}
        tabs={tabs}
        activeTabIndex={0}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    expect(container.querySelectorAll(".card-tab").length).toBe(2);

    // Update with a new tab added
    const newTabs = [...tabs, makeTab(2)];
    const updatedNode: TabNode = {
      type: "tab",
      id: "node-1",
      tabs: newTabs,
      activeTabIndex: 0,
    };

    await act(async () => {
      ref.current!.update(updatedNode);
    });

    expect(container.querySelectorAll(".card-tab").length).toBe(3);
  });

  it("ref.current.destroy() does not throw", async () => {
    const ref = createRef<TabBarHandle>();
    const { callbacks } = makeCallbacks();
    render(
      <TabBar
        ref={ref}
        tabs={makeTabs(2)}
        activeTabIndex={0}
        callbacks={callbacks}
      />
    );
    await act(async () => {});
    expect(() => ref.current!.destroy()).not.toThrow();
  });
});
