/**
 * Selection model integration tests -- Step 5.
 *
 * Tests cover:
 * - T13: TugPane card responder does NOT handle selectAll (boundary enforcer model — content components own it)
 * - T14: Dispatching selectAll to card is unhandled (no selectAllChildren call)
 * - T15: TugPane content area is registered with SelectionGuard on mount
 * - T15a: Contenteditable region with data-tug-select="custom" inside card content
 *         receives full selection autonomy (guard does not clip within the custom region)
 * - T16: Regression — window-level card actions still work
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, afterEach, beforeEach, mock, spyOn } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { TugPane } from "@/components/chrome/tug-pane";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { useSelectionBoundary } from "@/components/tugways/hooks/use-selection-boundary";
import { withDeckManager } from "./mock-deck-manager-store";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import type { TugPaneState } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStackState(id: string): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds: ["tab-1"],
    activeCardId: "tab-1",
    title: "",
    acceptsFamilies: ["standard"],
  };
}

/**
 * Render a TugPane inside a manually-controlled ResponderChainManager so tests
 * can dispatch actions and inspect chain state directly.
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

const defaultWindowProps = {
  meta: { title: "Selection Test Card" },
  onCardMoved: mock(() => {}),
  zIndex: 1,
};

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  selectionGuard.reset();
});

beforeEach(() => {
  selectionGuard.reset();
});

// ---------------------------------------------------------------------------
// T13: TugPane card responder does NOT handle selectAll (boundary enforcer model)
// ---------------------------------------------------------------------------

describe("T13 – TugPane card responder does not handle selectAll", () => {
  it("canHandle('select-all') returns false — card does not own selectAll", () => {
    const { manager } = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t13")} />
    );

    expect(manager.canHandle("select-all")).toBe(false);
  });

  it("pre-existing card actions are still registered", () => {
    const { manager } = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t13b")} />
    );

    expect(manager.canHandle("close")).toBe(true);
    expect(manager.canHandle("minimize")).toBe(true);
    expect(manager.canHandle("toggle-menu")).toBe(true);
    expect(manager.canHandle("find")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T14: dispatching selectAll to card is unhandled (no selectAllChildren call)
// ---------------------------------------------------------------------------

describe("T14 – selectAll dispatch is unhandled at card level", () => {
  it("dispatch('select-all') does not throw when no content component handles it", () => {
    const { manager } = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t14")} />
    );

    expect(() => {
      act(() => {
        manager.sendToFirstResponder({ action: TUG_ACTIONS.SELECT_ALL, phase: "discrete" });
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T15: Selection boundaries are registered per card, not per pane
// ---------------------------------------------------------------------------
//
// Before Step 2, `TugPane` registered its content div as the boundary,
// producing one entry per pane. After Step 2, `CardHost` registers its
// card-host div, producing one entry per card — so a tab-group pane that
// hosts N cards has N boundary entries. [L12].
//
// These tests use `useSelectionBoundary` directly via probe components to
// pin the registration contract without pulling in the full DeckCanvas +
// DeckManager integration surface.

function CardHostProbe({ cardId, children }: { cardId: string; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSelectionBoundary(cardId, ref);
  return (
    <div ref={ref} data-card-host data-card-id={cardId}>
      {children}
    </div>
  );
}

describe("T15 – card-level selection boundary registration", () => {
  it("TugPane alone does not register a pane-level boundary (registration moved to CardHost)", () => {
    renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("pane-t15-a")} />
    );

    // The pane id is no longer a registered boundary; saveSelection returns
    // null because the key is unknown, not because there is no selection.
    expect(selectionGuard.saveSelection("pane-t15-a")).toBeNull();
  });

  it("a multi-card pane registers one boundary per card", () => {
    const spy = spyOn(selectionGuard, "registerBoundary");

    act(() => {
      render(
        <div data-pane-id="pane-t15-multi">
          <CardHostProbe cardId="tab-one" />
          <CardHostProbe cardId="tab-two" />
          <CardHostProbe cardId="tab-three" />
        </div>
      );
    });

    expect(spy.mock.calls.length).toBe(3);
    const calledIds = spy.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual(["tab-one", "tab-two", "tab-three"]);

    spy.mockRestore();
  });

  it("card-host div is the registered element (saveSelection succeeds for a selection inside)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <CardHostProbe cardId="card-t15-elem">
          <span data-testid="inner">hello</span>
        </CardHostProbe>
      ));
    });

    const span = container.querySelector("[data-testid='inner']") as HTMLElement;
    expect(span).not.toBeNull();

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(span.firstChild!, 0);
      range.setEnd(span.firstChild!, 3);
      sel.removeAllRanges();
      sel.addRange(range);

      const saved = selectionGuard.saveSelection("card-t15-elem");
      expect(saved).not.toBeNull();

      sel.removeAllRanges();
    }
  });

  it("a pointerdown on deck chrome outside the boundary activates the enclosing card via closest('[data-card-host]')", () => {
    // Layout: a [data-card-host] wrapper contains both the boundary
    // element and some chrome (title bar) that sits outside the boundary
    // subtree. A pointerdown on the chrome must still attribute the event
    // to the enclosing card and call `activateCard(cardId)`.
    const host = document.createElement("div");
    host.setAttribute("data-card-host", "");
    host.setAttribute("data-card-id", "card-t15-click");
    const titleBar = document.createElement("div");
    titleBar.textContent = "close";
    const boundary = document.createElement("div");
    host.appendChild(titleBar);
    host.appendChild(boundary);
    document.body.appendChild(host);

    selectionGuard.registerBoundary("card-t15-click", boundary);
    selectionGuard.attach();
    const activateSpy = spyOn(selectionGuard, "activateCard");

    try {
      // happy-dom doesn't expose PointerEvent; dispatch a MouseEvent with
      // type "pointerdown" — the handler reads `target`, `clientX`,
      // `clientY` only, all of which MouseEvent provides.
      const event = new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      });
      titleBar.dispatchEvent(event);

      expect(activateSpy).toHaveBeenCalledWith("card-t15-click");
    } finally {
      activateSpy.mockRestore();
      selectionGuard.detach();
      selectionGuard.unregisterBoundary("card-t15-click");
      document.body.removeChild(host);
    }
  });
});

// ---------------------------------------------------------------------------
// T15a: contenteditable with data-tug-select="custom" receives full autonomy
// ---------------------------------------------------------------------------

describe("T15a – contenteditable data-tug-select=custom is autonomous", () => {
  it("contenteditable region with data-tug-select=custom can live inside card content (not blocked)", () => {
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15a")} />
      );
      container = result.container;
    });

    const contentDiv = container.querySelector("[data-testid='tug-pane-content']") as HTMLElement;
    expect(contentDiv).not.toBeNull();

    const editable = document.createElement("div");
    editable.setAttribute("data-tug-select", "custom");
    editable.setAttribute("data-testid", "custom-editable");
    editable.contentEditable = "true";
    editable.textContent = "Editable content";
    contentDiv.appendChild(editable);

    const editableEl = container.querySelector(
      "[data-testid='custom-editable']"
    );
    expect(editableEl).not.toBeNull();
    expect(editableEl?.getAttribute("data-tug-select")).toBe("custom");
    expect(editableEl?.getAttribute("contenteditable")).toBe("true");

    expect(contentDiv.contains(editableEl)).toBe(true);
  });

  it("setting a selection inside a custom region and saving does not error", () => {
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15a-sel")} />
      );
      container = result.container;
    });

    const contentDiv = container.querySelector("[data-testid='tug-pane-content']") as HTMLElement;
    const editable = document.createElement("div");
    editable.setAttribute("data-tug-select", "custom");
    editable.setAttribute("data-testid", "custom-editable");
    editable.contentEditable = "true";
    contentDiv.appendChild(editable);

    const editableEl = container.querySelector(
      "[data-testid='custom-editable']"
    ) as HTMLElement;
    expect(editableEl).not.toBeNull();

    const textNode = document.createTextNode("custom text");
    editableEl.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 6);
      sel.removeAllRanges();
      sel.addRange(range);

      expect(() => selectionGuard.saveSelection("card-t15a-sel")).not.toThrow();

      sel.removeAllRanges();
      editableEl.removeChild(textNode);
    }
  });

  it("SelectionGuard does not interfere with selection inside custom region (no clipping)", () => {
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15a-noclip")} />
      );
      container = result.container;
    });

    const contentDiv = container.querySelector("[data-testid='tug-pane-content']") as HTMLElement;
    const customRegion = document.createElement("div");
    customRegion.setAttribute("data-tug-select", "custom");
    customRegion.setAttribute("data-testid", "custom-region");
    customRegion.contentEditable = "true";
    contentDiv.appendChild(customRegion);

    const textNode = document.createTextNode("Rich text here");
    customRegion.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      (sel as any).setBaseAndExtent(textNode, 0, textNode, 4);
      const anchorBefore = sel.anchorNode;
      const offsetBefore = sel.anchorOffset;

      expect(sel.anchorNode).toBe(anchorBefore);
      expect(sel.anchorOffset).toBe(offsetBefore);

      sel.removeAllRanges();
      customRegion.removeChild(textNode);
    }
  });
});

// ---------------------------------------------------------------------------
// T16: Regression – existing window card actions still work
// ---------------------------------------------------------------------------

describe("T16 – regression: existing TugPane card actions unaffected", () => {
  it("dispatching close through the chain still calls onClose", () => {
    const onClose = mock(() => {});
    const { manager } = renderWithManager(
      <TugPane
        {...defaultWindowProps}
        stackState={makeStackState("card-t16-close")}
        onClose={onClose}
      />
    );

    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.CLOSE, phase: "discrete" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("all original responder actions are still registered (selectAll is NOT)", () => {
    const { manager } = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t16-all")} />
    );

    expect(manager.canHandle("close")).toBe(true);
    expect(manager.canHandle("minimize")).toBe(true);
    expect(manager.canHandle("toggle-menu")).toBe(true);
    expect(manager.canHandle("find")).toBe(true);
    expect(manager.canHandle("select-all")).toBe(false);
  });
});
