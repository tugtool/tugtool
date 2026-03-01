/**
 * DeckCanvas RTL tests — Step 7.
 *
 * Tests cover:
 * - DeckCanvas renders CardFrame for each panel in deckState
 * - DeckCanvas renders TabBar for multi-tab panels
 * - DeckCanvas renders Dock
 * - Card content renders via card config component
 * - useCardMeta updates flow to CardHeader via props (no CustomEvent)
 * - panelDockedCorners prop applies correct border-radius to CardFrame
 * - panelPositionOffsets prop applies correct position offset to CardFrame
 *
 * [D04] Unified single React root with DeckCanvas
 * Spec S05
 */
import "./setup-rtl";

import React, { createRef } from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, act } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import type { DeckCanvasHandle, CardConfig, CanvasCallbacks } from "@/components/chrome/deck-canvas";
import type { CardState } from "@/layout-tree";
import type { TugCardMeta } from "@/cards/card";
import { FeedId } from "@/protocol";
import { useCardMeta } from "@/hooks/use-card-meta";

// ---- Helpers ----

function makeTabId() {
  return `tab-${Math.random().toString(36).slice(2)}`;
}

function makePanelId() {
  return `panel-${Math.random().toString(36).slice(2)}`;
}

function makePanel(overrides: Partial<CardState> = {}): CardState {
  const tabId = makeTabId();
  return {
    id: makePanelId(),
    position: { x: 100, y: 100 },
    size: { width: 400, height: 300 },
    tabs: [{ id: tabId, componentId: "test-card", title: "Test Card", closable: true }],
    activeTabId: tabId,
    ...overrides,
  };
}

function makeMultiTabPanel(): CardState {
  const tab1 = makeTabId();
  const tab2 = makeTabId();
  return {
    id: makePanelId(),
    position: { x: 100, y: 100 },
    size: { width: 400, height: 300 },
    tabs: [
      { id: tab1, componentId: "test-card", title: "Tab One", closable: true },
      { id: tab2, componentId: "test-card", title: "Tab Two", closable: true },
    ],
    activeTabId: tab1,
  };
}

function makeMeta(overrides: Partial<TugCardMeta> = {}): TugCardMeta {
  return {
    title: "Test Card",
    icon: "Box",
    closable: true,
    menuItems: [],
    ...overrides,
  };
}

function makeCanvasEl(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "1280px";
  el.style.height = "800px";
  el.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: 1280, bottom: 800,
      width: 1280, height: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  document.body.appendChild(el);
  return el;
}

function makeCallbacks(): CanvasCallbacks {
  return {
    onMoveEnd: mock((_panelId: string, _x: number, _y: number) => {}),
    onResizeEnd: mock((_panelId: string, _x: number, _y: number, _w: number, _h: number) => {}),
    onFocus: mock((_panelId: string, _opts?: { suppressZOrder?: boolean }) => {}),
    onClose: mock((_panelId: string) => {}),
    onMoving: mock((_panelId: string, x: number, y: number) => ({ x, y })),
    onResizing: mock((_panelId: string, x: number, y: number, width: number, height: number) => ({ x, y, width, height })),
    onTabActivate: mock((_panelId: string, _tabIndex: number) => {}),
    onTabClose: mock((_tabId: string) => {}),
    onTabReorder: mock((_panelId: string, _fromIndex: number, _toIndex: number) => {}),
    onMetaUpdate: mock((_tabId: string, _meta: TugCardMeta) => {}),
    dock: {
      onShowCard: mock((_cardType: string) => {}),
      onResetLayout: mock(() => {}),
      onRestartServer: mock(() => {}),
      onResetEverything: mock(() => {}),
      onReloadFrontend: mock(() => {}),
    },
  };
}

function SimpleCard() {
  return <div data-testid="simple-card-content">card content</div>;
}

function MetaCard() {
  useCardMeta({ title: "Meta Card", icon: "Info", closable: true, menuItems: [] });
  return <div data-testid="meta-card-content">meta card content</div>;
}

function makeCardConfig(overrides: Partial<CardConfig> = {}): CardConfig {
  return {
    component: SimpleCard,
    feedIds: [FeedId.GIT],
    initialMeta: makeMeta(),
    ...overrides,
  };
}

interface RenderDeckCanvasOptions {
  panels?: CardState[];
  cardConfigs?: Map<string, CardConfig>;
  cardMetas?: Map<string, TugCardMeta>;
  keyPanelId?: string | null;
  canvasEl?: HTMLElement;
  callbacks?: CanvasCallbacks;
  ref?: React.RefObject<DeckCanvasHandle | null>;
  panelDockedCorners?: Map<string, [boolean, boolean, boolean, boolean]>;
  panelPositionOffsets?: Map<string, { dx: number; dy: number }>;
}

function renderDeckCanvas(options: RenderDeckCanvasOptions = {}) {
  const panels = options.panels ?? [];
  const cardConfigs = options.cardConfigs ?? new Map([["test-card", makeCardConfig()]]);
  const cardMetas = options.cardMetas ?? new Map();
  const keyPanelId = options.keyPanelId ?? null;
  const canvasEl = options.canvasEl ?? makeCanvasEl();
  const callbacks = options.callbacks ?? makeCallbacks();
  const ref = options.ref ?? createRef<DeckCanvasHandle | null>();

  const result = render(
    <DeckCanvas
      ref={ref}
      panels={panels}
      cardConfigs={cardConfigs}
      cardMetas={cardMetas}
      keyPanelId={keyPanelId}
      canvasEl={canvasEl}
      callbacks={callbacks}
      connection={null}
      dragState={null}
      panelDockedCorners={options.panelDockedCorners}
      panelPositionOffsets={options.panelPositionOffsets}
    />
  );

  return { ...result, panels, cardConfigs, cardMetas, canvasEl, callbacks, ref };
}

// ---- Tests ----

describe("DeckCanvas – panel rendering", () => {
  it("renders no card frames when panels is empty", () => {
    const { container } = renderDeckCanvas({ panels: [] });
    const frames = container.querySelectorAll(".card-frame");
    expect(frames.length).toBe(0);
  });

  it("renders one CardFrame for a single panel", () => {
    const panel = makePanel();
    const { container } = renderDeckCanvas({ panels: [panel] });
    const frames = container.querySelectorAll(".card-frame");
    expect(frames.length).toBe(1);
  });

  it("renders CardFrame for each panel in deckState", () => {
    const panels = [makePanel(), makePanel(), makePanel()];
    const { container } = renderDeckCanvas({ panels });
    const frames = container.querySelectorAll(".card-frame");
    expect(frames.length).toBe(3);
  });

  it("CardFrame has correct initial position from panel state", () => {
    const panel = makePanel({ position: { x: 150, y: 200 } });
    const { container } = renderDeckCanvas({ panels: [panel] });
    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("150px");
    expect(frame?.style.top).toBe("200px");
  });

  it("CardFrame has correct initial size from panel state", () => {
    const panel = makePanel({ size: { width: 500, height: 350 } });
    const { container } = renderDeckCanvas({ panels: [panel] });
    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.width).toBe("500px");
    expect(frame?.style.height).toBe("350px");
  });
});

describe("DeckCanvas – TabBar rendering", () => {
  it("does NOT render TabBar for single-tab panels", () => {
    const panel = makePanel();
    const { container } = renderDeckCanvas({ panels: [panel] });
    expect(container.querySelector(".card-tab-bar")).toBeNull();
  });

  it("renders TabBar for multi-tab panels", () => {
    const panel = makeMultiTabPanel();
    const { container } = renderDeckCanvas({ panels: [panel] });
    const tabBar = container.querySelector(".card-tab-bar");
    expect(tabBar).not.toBeNull();
  });

  it("TabBar shows correct tab count for multi-tab panel", () => {
    const panel = makeMultiTabPanel();
    const { container } = renderDeckCanvas({ panels: [panel] });
    const tabs = container.querySelectorAll(".card-tab");
    expect(tabs.length).toBe(2);
  });
});

describe("DeckCanvas – Dock rendering", () => {
  it("renders the Dock component", () => {
    const { container } = renderDeckCanvas({ panels: [] });
    const dock = container.querySelector(".dock");
    expect(dock).not.toBeNull();
  });

  it("renders Dock regardless of panel count", () => {
    const panels = [makePanel(), makePanel()];
    const { container } = renderDeckCanvas({ panels });
    const dock = container.querySelector(".dock");
    expect(dock).not.toBeNull();
  });
});

describe("DeckCanvas – card content rendering", () => {
  it("renders card content component from cardConfigs", async () => {
    const panel = makePanel();
    const cardConfigs = new Map([["test-card", makeCardConfig({ component: SimpleCard })]]);
    const { container } = renderDeckCanvas({ panels: [panel], cardConfigs });
    await act(async () => {});
    const cardContent = container.querySelector("[data-testid='simple-card-content']");
    expect(cardContent).not.toBeNull();
  });

  it("does not render card content when no config for componentId", () => {
    const panel = makePanel({
      tabs: [{ id: makeTabId(), componentId: "unknown-card", title: "Unknown", closable: true }],
    });
    panel.activeTabId = panel.tabs[0].id;
    const { container } = renderDeckCanvas({
      panels: [panel],
      cardConfigs: new Map(),
    });
    const cardContent = container.querySelector("[data-testid='simple-card-content']");
    expect(cardContent).toBeNull();
  });

  it("renders card content for each panel", async () => {
    const panels = [makePanel(), makePanel()];
    const cardConfigs = new Map([["test-card", makeCardConfig({ component: SimpleCard })]]);
    const { container } = renderDeckCanvas({ panels, cardConfigs });
    await act(async () => {});
    const cardContents = container.querySelectorAll("[data-testid='simple-card-content']");
    expect(cardContents.length).toBe(2);
  });
});

describe("DeckCanvas – DeckCanvasHandle", () => {
  it("onFrame ref is available after render", async () => {
    const ref = createRef<DeckCanvasHandle | null>();
    renderDeckCanvas({ ref });
    await act(async () => {});
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.onFrame).toBe("function");
  });

  it("updatePanelPosition via handle mutates DOM style", async () => {
    const panel = makePanel({ position: { x: 100, y: 100 } });
    const ref = createRef<DeckCanvasHandle | null>();
    const { container } = renderDeckCanvas({ panels: [panel], ref });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("100px");

    act(() => {
      ref.current?.updatePanelPosition(panel.id, 250, 300);
    });
    expect(frame?.style.left).toBe("250px");
    expect(frame?.style.top).toBe("300px");
  });

  it("updatePanelSize via handle mutates DOM style", async () => {
    const panel = makePanel({ size: { width: 400, height: 300 } });
    const ref = createRef<DeckCanvasHandle | null>();
    const { container } = renderDeckCanvas({ panels: [panel], ref });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.width).toBe("400px");

    act(() => {
      ref.current?.updatePanelSize(panel.id, 600, 450);
    });
    expect(frame?.style.width).toBe("600px");
    expect(frame?.style.height).toBe("450px");
  });

  it("updatePanelZIndex via handle mutates DOM style", async () => {
    const panel = makePanel();
    const ref = createRef<DeckCanvasHandle | null>();
    const { container } = renderDeckCanvas({ panels: [panel], ref });
    await act(async () => {});

    act(() => {
      ref.current?.updatePanelZIndex(panel.id, 200);
    });
    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.zIndex).toBe("200");
  });

  it("getPanelElement returns the panel root element", async () => {
    const panel = makePanel();
    const ref = createRef<DeckCanvasHandle | null>();
    const { container } = renderDeckCanvas({ panels: [panel], ref });
    await act(async () => {});

    const el = ref.current?.getPanelElement(panel.id);
    expect(el).not.toBeNull();
    expect(el?.classList.contains("card-frame")).toBe(true);

    // Verify it's the same element as found in the DOM
    const frameInDom = container.querySelector(".card-frame");
    expect(el).toBe(frameInDom);
  });

  it("getPanelElement returns null for unknown panelId", async () => {
    const ref = createRef<DeckCanvasHandle | null>();
    renderDeckCanvas({ panels: [], ref });
    await act(async () => {});

    const el = ref.current?.getPanelElement("nonexistent-id");
    expect(el).toBeNull();
  });
});

describe("DeckCanvas – useCardMeta updates flow to CardHeader (no CustomEvent)", () => {
  it("card component calling useCardMeta triggers onMetaUpdate callback", async () => {
    const panel = makePanel();
    const callbacks = makeCallbacks();
    const cardConfigs = new Map([
      ["test-card", makeCardConfig({ component: MetaCard, initialMeta: makeMeta({ title: "Initial" }) })],
    ]);

    renderDeckCanvas({ panels: [panel], cardConfigs, callbacks });
    await act(async () => {});

    // onMetaUpdate should be called when MetaCard's useCardMeta fires
    expect((callbacks.onMetaUpdate as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  it("no card-meta-update CustomEvent is dispatched", async () => {
    const panel = makePanel();
    const received: Event[] = [];
    document.addEventListener("card-meta-update", (e) => received.push(e));

    const cardConfigs = new Map([
      ["test-card", makeCardConfig({ component: MetaCard })],
    ]);

    renderDeckCanvas({ panels: [panel], cardConfigs });
    await act(async () => {});

    expect(received.length).toBe(0);
    document.removeEventListener("card-meta-update", (e) => received.push(e));
  });
});

describe("DeckCanvas – cardMetas override initial meta in CardHeader", () => {
  it("cardMetas prop overrides initialMeta for the active tab", async () => {
    const panel = makePanel();
    const activeTabId = panel.activeTabId;
    const updatedMeta: TugCardMeta = {
      title: "Updated Title",
      icon: "Settings",
      closable: true,
      menuItems: [],
    };
    const cardMetas = new Map([[activeTabId, updatedMeta]]);

    const { container } = renderDeckCanvas({
      panels: [panel],
      cardMetas,
    });
    await act(async () => {});

    const header = container.querySelector(".card-header-title");
    expect(header?.textContent).toBe("Updated Title");
  });
});

describe("DeckCanvas – panelDockedCorners prop (declarative docked styling)", () => {
  // Helper to normalize borderRadius for comparison, since browsers may
  // compact "6px 6px 6px 6px" → "6px" or render "0" → "0px".
  function normalizeRadius(r: string | undefined): string {
    if (!r) return "";
    // Split, normalize each part (trim "px" where value is 0)
    return r
      .split(" ")
      .map((part) => {
        const n = parseFloat(part);
        return n === 0 ? "0" : part;
      })
      .join(" ");
  }

  it("no dockedCorners prop: CardFrame has all-rounded border-radius", async () => {
    const panel = makePanel();
    const { container } = renderDeckCanvas({ panels: [panel] });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    // All corners rounded → "6px" (shorthand) or "6px 6px 6px 6px"
    expect(radius === "6px" || radius === "6px 6px 6px 6px").toBe(true);
  });

  it("all-true dockedCorners: CardFrame has all-rounded border-radius", async () => {
    const panel = makePanel();
    const panelDockedCorners = new Map([[panel.id, [true, true, true, true] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelDockedCorners });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    expect(radius === "6px" || radius === "6px 6px 6px 6px").toBe(true);
  });

  it("bottom corners false (horizontal dock above): CardFrame has square bottom corners", async () => {
    const panel = makePanel();
    // Panel A in a horizontal dock: BR and BL are square (false)
    const panelDockedCorners = new Map([[panel.id, [true, true, false, false] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelDockedCorners });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    expect(radius).toBe("6px 6px 0 0");
  });

  it("top corners false (horizontal dock below): CardFrame has square top corners", async () => {
    const panel = makePanel();
    // Panel B docked below A: TL and TR are square (false)
    const panelDockedCorners = new Map([[panel.id, [false, false, true, true] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelDockedCorners });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    expect(radius).toBe("0 0 6px 6px");
  });

  it("right corners false (vertical dock to right): CardFrame has square right corners", async () => {
    const panel = makePanel();
    // Panel A in vertical dock: TR and BR are square (false)
    const panelDockedCorners = new Map([[panel.id, [true, false, false, true] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelDockedCorners });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    expect(radius).toBe("6px 0 0 6px");
  });

  it("all-false dockedCorners: CardFrame has zero border-radius on all corners", async () => {
    const panel = makePanel();
    const panelDockedCorners = new Map([[panel.id, [false, false, false, false] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelDockedCorners });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    const radius = normalizeRadius(frame?.style.borderRadius);
    // "0" (shorthand) or "0 0 0 0"
    expect(radius === "0" || radius === "0 0 0 0").toBe(true);
  });

  it("dockedCorners only applies to the matching panel", async () => {
    const panel1 = makePanel({ position: { x: 100, y: 100 } });
    const panel2 = makePanel({ position: { x: 200, y: 200 } });
    // Only panel1 gets docked corners (square bottom)
    const panelDockedCorners = new Map([[panel1.id, [true, true, false, false] as [boolean, boolean, boolean, boolean]]]);
    const { container } = renderDeckCanvas({ panels: [panel1, panel2], panelDockedCorners });
    await act(async () => {});

    const frames = container.querySelectorAll<HTMLElement>(".card-frame");
    expect(frames.length).toBe(2);
    // panel1: square bottom corners
    const radius1 = normalizeRadius(frames[0].style.borderRadius);
    expect(radius1).toBe("6px 6px 0 0");
    // panel2 (no dockedCorners entry): all-rounded
    const radius2 = normalizeRadius(frames[1].style.borderRadius);
    expect(radius2 === "6px" || radius2 === "6px 6px 6px 6px").toBe(true);
  });
});

describe("DeckCanvas – panelPositionOffsets prop (declarative 1px overlap)", () => {
  it("no positionOffset: CardFrame position matches panel state exactly", async () => {
    const panel = makePanel({ position: { x: 100, y: 150 } });
    const { container } = renderDeckCanvas({ panels: [panel] });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("100px");
    expect(frame?.style.top).toBe("150px");
  });

  it("dy=-1 positionOffset: CardFrame top is 1px less than panel position", async () => {
    const panel = makePanel({ position: { x: 100, y: 150 } });
    const panelPositionOffsets = new Map([[panel.id, { dx: 0, dy: -1 }]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelPositionOffsets });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("100px");
    expect(frame?.style.top).toBe("149px");
  });

  it("dx=-1 positionOffset: CardFrame left is 1px less than panel position", async () => {
    const panel = makePanel({ position: { x: 200, y: 100 } });
    const panelPositionOffsets = new Map([[panel.id, { dx: -1, dy: 0 }]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelPositionOffsets });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("199px");
    expect(frame?.style.top).toBe("100px");
  });

  it("zero offset: CardFrame position unchanged", async () => {
    const panel = makePanel({ position: { x: 300, y: 200 } });
    const panelPositionOffsets = new Map([[panel.id, { dx: 0, dy: 0 }]]);
    const { container } = renderDeckCanvas({ panels: [panel], panelPositionOffsets });
    await act(async () => {});

    const frame = container.querySelector<HTMLElement>(".card-frame");
    expect(frame?.style.left).toBe("300px");
    expect(frame?.style.top).toBe("200px");
  });
});
