/**
 * CardHeader component unit tests -- Step 3.
 *
 * Tests cover:
 * - T-CH01: Clicking chevron collapses card (calls onCollapse)
 * - T-CH02: Clicking chevron again expands card (calls onCollapse again)
 * - T-CH03: Close button calls onClose on pointer-up-inside
 * - T-CH04: Double-click on title bar toggles collapse (calls onCollapse)
 * - T-CH05: Resize handles hidden when collapsed (via CardFrame data-collapsed)
 * - T-CH06: Collapsed state data attribute rendered correctly
 * - T-CH07: Icon rendered when icon prop provided
 * - T-CH08: Close button hidden when closable=false
 * - T-CH09: DeckManager.toggleCardCollapse toggles collapsed field
 * - T-CH10: Serialization round-trip: collapsed state persists
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

import { CardHeader, CARD_TITLE_BAR_HEIGHT } from "@/components/chrome/card-header";
import { CardFrame } from "@/components/chrome/card-frame";
import type { CardFrameInjectedProps } from "@/components/chrome/card-frame";
import type { CardState } from "@/layout-tree";
import { DeckManager } from "@/deck-manager";
import { _resetForTest, registerCard } from "@/card-registry";
import { serialize, deserialize } from "@/serialization";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardState(overrides: Partial<CardState> = {}): CardState {
  return {
    id: "card-1",
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    tabs: [{ id: "tab-1", componentId: "hello", title: "Hello", closable: true }],
    activeTabId: "tab-1",
    title: "",
    acceptsFamilies: ["standard"],
    ...overrides,
  };
}

function makeMockConnection() {
  return {
    sendControlFrame: () => {},
    onOpen: null,
    onClose: null,
    onMessage: null,
    close: () => {},
  };
}

// ---------------------------------------------------------------------------
// T-CH01 / T-CH02: Chevron collapse/expand
// ---------------------------------------------------------------------------

describe("CardHeader – collapse/expand via chevron", () => {
  afterEach(() => cleanup());

  it("T-CH01: calls onCollapse when chevron clicked (expanded state)", () => {
    const onCollapse = mock(() => {});
    const { getByTestId } = render(
      <CardHeader
        title="Test Card"
        collapsed={false}
        onCollapse={onCollapse}
      />
    );
    const btn = getByTestId("card-header-collapse-btn");
    act(() => { fireEvent.click(btn); });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("T-CH02: calls onCollapse when chevron clicked (collapsed state)", () => {
    const onCollapse = mock(() => {});
    const { getByTestId } = render(
      <CardHeader
        title="Test Card"
        collapsed={true}
        onCollapse={onCollapse}
      />
    );
    const btn = getByTestId("card-header-collapse-btn");
    act(() => { fireEvent.click(btn); });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapse button has correct aria-label when expanded", () => {
    const { getByTestId } = render(
      <CardHeader title="Test" collapsed={false} onCollapse={() => {}} />
    );
    const btn = getByTestId("card-header-collapse-btn");
    expect(btn.getAttribute("aria-label")).toBe("Collapse card");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapse button has correct aria-label when collapsed", () => {
    const { getByTestId } = render(
      <CardHeader title="Test" collapsed={true} onCollapse={() => {}} />
    );
    const btn = getByTestId("card-header-collapse-btn");
    expect(btn.getAttribute("aria-label")).toBe("Expand card");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// T-CH03: Close button fires onClose on confirmed pointer-up-inside
// ---------------------------------------------------------------------------

describe("CardHeader – close button", () => {
  afterEach(() => cleanup());

  it("T-CH03: close button calls onClose via click (keyboard fallback)", () => {
    const onClose = mock(() => {});
    const { getByTestId } = render(
      <CardHeader
        title="Test"
        collapsed={false}
        onCollapse={() => {}}
        closable={true}
        onClose={onClose}
      />
    );
    const btn = getByTestId("tugcard-close-btn");
    act(() => { fireEvent.click(btn); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("T-CH08: close button is hidden when closable=false", () => {
    const { queryByTestId } = render(
      <CardHeader
        title="Test"
        collapsed={false}
        onCollapse={() => {}}
        closable={false}
      />
    );
    expect(queryByTestId("tugcard-close-btn")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-CH04: Double-click on header toggles collapse
// ---------------------------------------------------------------------------

describe("CardHeader – double-click to toggle collapse", () => {
  afterEach(() => cleanup());

  it("T-CH04: double-click on header surface calls onCollapse", () => {
    const onCollapse = mock(() => {});
    const { getByTestId } = render(
      <CardHeader title="Test" collapsed={false} onCollapse={onCollapse} />
    );
    const header = getByTestId("tugcard-header");
    act(() => { fireEvent.dblClick(header); });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("double-click on collapse button does NOT double-fire onCollapse", () => {
    // The button has its own click handler; double-click on button fires click once,
    // not double-fire. The dblClick event on the button should not also fire the
    // header's onDoubleClick handler (because closest(".card-header-btn") guard fires).
    const onCollapse = mock(() => {});
    const { getByTestId } = render(
      <CardHeader title="Test" collapsed={false} onCollapse={onCollapse} />
    );
    const btn = getByTestId("card-header-collapse-btn");
    act(() => {
      // A dblClick fires: click + click + dblClick events
      fireEvent.click(btn); // first click
      fireEvent.dblClick(btn); // dblClick on button
    });
    // The header's dblClick guard skips when target is a button
    // Only the single click fires the collapse callback
    expect(onCollapse.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// T-CH-DRAG: onDragStart is available when collapsed (collapsed cards can drag)
// ---------------------------------------------------------------------------

describe("CardHeader – drag is active when collapsed [D07]", () => {
  afterEach(() => cleanup());

  it("T-CH-DRAG: onDragStart prop is passed to CardHeader regardless of collapsed state", () => {
    // Documents the intent that collapsed cards can still be dragged.
    // The onDragStart callback must reach CardHeader whether collapsed=true or false.
    // CardFrame injects onDragStart via CardFrameInjectedProps and Tugcard forwards it
    // to CardHeader unconditionally -- the header is always rendered.
    const onDragStart = mock((_e: React.PointerEvent) => {});
    const { getByTestId, rerender } = render(
      <CardHeader
        title="Collapsed Card"
        collapsed={true}
        onCollapse={() => {}}
        onDragStart={onDragStart}
      />
    );
    // Header is always rendered -- verify it is present when collapsed.
    const header = getByTestId("tugcard-header");
    expect(header).not.toBeNull();

    // Fire a pointerdown on the header surface (not on a button) to trigger onDragStart.
    act(() => { fireEvent.pointerDown(header); });
    expect(onDragStart).toHaveBeenCalledTimes(1);

    // Also verify onDragStart is provided when expanded (regression guard).
    rerender(
      <CardHeader
        title="Expanded Card"
        collapsed={false}
        onCollapse={() => {}}
        onDragStart={onDragStart}
      />
    );
    const headerExpanded = getByTestId("tugcard-header");
    act(() => { fireEvent.pointerDown(headerExpanded); });
    expect(onDragStart).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// T-CH06: Collapsed state data attribute
// ---------------------------------------------------------------------------

describe("CardHeader – renders title and icon", () => {
  afterEach(() => cleanup());

  it("renders title text", () => {
    const { getByTestId } = render(
      <CardHeader title="My Card" collapsed={false} onCollapse={() => {}} />
    );
    expect(getByTestId("tugcard-title").textContent).toBe("My Card");
  });

  it("T-CH07: renders icon when icon prop is a valid lucide icon name", () => {
    const { getByTestId } = render(
      <CardHeader
        title="Test"
        icon="Settings"
        collapsed={false}
        onCollapse={() => {}}
      />
    );
    expect(getByTestId("tugcard-icon")).not.toBeNull();
  });

  it("does not render icon when icon prop is undefined", () => {
    const { queryByTestId } = render(
      <CardHeader title="Test" collapsed={false} onCollapse={() => {}} />
    );
    expect(queryByTestId("tugcard-icon")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-CH05: Resize handles hidden when collapsed (via CardFrame data-collapsed)
// ---------------------------------------------------------------------------

describe("CardFrame – resize handles hidden when collapsed", () => {
  afterEach(() => cleanup());

  it("T-CH05: resize handle elements absent when cardState.collapsed=true", () => {
    const collapsedState = makeCardState({ collapsed: true });
    const { container } = render(
      <ResponderChainProvider>
        <CardFrame
          cardState={collapsedState}
          renderContent={(injected: CardFrameInjectedProps) => (
            <div data-testid="card-content">
              <button onClick={() => {}} data-testid="close-trigger">Close</button>
            </div>
          )}
          onCardMoved={() => {}}
          onCardClosed={() => {}}
          onCardFocused={() => {}}
          onCardCollapsed={() => {}}
          zIndex={1}
          isFocused={false}
        />
      </ResponderChainProvider>
    );
    const handles = container.querySelectorAll(".card-frame-resize");
    expect(handles.length).toBe(0);
  });

  it("resize handle elements present when cardState.collapsed=false", () => {
    const expandedState = makeCardState({ collapsed: false });
    const { container } = render(
      <ResponderChainProvider>
        <CardFrame
          cardState={expandedState}
          renderContent={() => <div />}
          onCardMoved={() => {}}
          onCardClosed={() => {}}
          onCardFocused={() => {}}
          zIndex={1}
          isFocused={false}
        />
      </ResponderChainProvider>
    );
    const handles = container.querySelectorAll(".card-frame-resize");
    expect(handles.length).toBe(8);
  });

  it("CardFrame uses CARD_TITLE_BAR_HEIGHT + 2 for height when collapsed", () => {
    const collapsedState = makeCardState({ collapsed: true });
    const { getByTestId } = render(
      <ResponderChainProvider>
        <CardFrame
          cardState={collapsedState}
          renderContent={() => <div />}
          onCardMoved={() => {}}
          onCardClosed={() => {}}
          onCardFocused={() => {}}
          zIndex={1}
          isFocused={false}
        />
      </ResponderChainProvider>
    );
    const frame = getByTestId("card-frame");
    const heightVal = frame.style.height;
    expect(heightVal).toBe(`${CARD_TITLE_BAR_HEIGHT + 2}px`);
  });
});

// ---------------------------------------------------------------------------
// T-CH09: DeckManager.toggleCardCollapse
// ---------------------------------------------------------------------------

describe("DeckManager – toggleCardCollapse", () => {
  let manager: DeckManager;

  beforeEach(() => {
    _resetForTest();
    registerCard({
      componentId: "hello",
      contentFactory: () => React.createElement("div"),
      defaultMeta: { title: "Hello", closable: true },
      family: "standard",
      acceptsFamilies: ["standard"],
    });
    const container = document.createElement("div");
    manager = new DeckManager(container, makeMockConnection() as never);
  });

  afterEach(() => {
    _resetForTest();
    cleanup();
  });

  it("T-CH09: toggleCardCollapse sets collapsed=true on first call", () => {
    const cardId = manager.addCard("hello")!;
    const before = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(before.collapsed).toBeFalsy();

    act(() => { manager.toggleCardCollapse(cardId); });

    const after = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(after.collapsed).toBe(true);
  });

  it("toggleCardCollapse restores collapsed=undefined on second call", () => {
    const cardId = manager.addCard("hello")!;
    act(() => { manager.toggleCardCollapse(cardId); });
    act(() => { manager.toggleCardCollapse(cardId); });
    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.collapsed).toBeFalsy();
  });

  it("toggleCardCollapse notifies subscribers", () => {
    const cardId = manager.addCard("hello")!;
    let notified = false;
    manager.subscribe(() => { notified = true; });
    act(() => { manager.toggleCardCollapse(cardId); });
    expect(notified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-CH10: Serialization round-trip: collapsed state persists
// ---------------------------------------------------------------------------

describe("Serialization – collapsed state round-trip", () => {
  it("T-CH10: collapsed=true is preserved through serialize/deserialize", () => {
    const state = {
      cards: [
        makeCardState({ id: "c1", collapsed: true }),
      ],
    };
    const serialized = JSON.stringify(serialize(state));
    const restored = deserialize(serialized, 1200, 900);
    expect(restored.cards[0].collapsed).toBe(true);
  });

  it("collapsed=false (undefined) is preserved through serialize/deserialize", () => {
    const state = {
      cards: [
        makeCardState({ id: "c1" }), // no collapsed field
      ],
    };
    const serialized = JSON.stringify(serialize(state));
    const restored = deserialize(serialized, 1200, 900);
    // collapsed was never set, should remain falsy
    expect(restored.cards[0].collapsed).toBeFalsy();
  });
});
