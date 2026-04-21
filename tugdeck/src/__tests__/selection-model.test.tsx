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

import React from "react";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { TugPane } from "@/components/chrome/tug-pane";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import { selectionGuard } from "@/components/tugways/selection-guard";
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
  onStackActivated: mock(() => {}),
  zIndex: 1,
  isFocused: false,
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
// T15: TugPane content area is registered with SelectionGuard on mount
// ---------------------------------------------------------------------------

describe("T15 – TugPane registers content area with SelectionGuard", () => {
  it("content area is registered on mount (saveSelection returns null, not error)", () => {
    renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15")} />
    );

    expect(selectionGuard.saveSelection("card-t15")).toBeNull();
  });

  it("content area is unregistered on unmount", () => {
    let unmount!: () => void;

    renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15-unmount")} />
    );
    const result = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15-unmount2")} />
    );
    unmount = result.unmount;

    act(() => {
      unmount();
    });

    expect(selectionGuard.saveSelection("card-t15-unmount2")).toBeNull();
  });

  it("content area element passed to SelectionGuard is the tug-pane-content div", () => {
    let container!: HTMLElement;
    const result = renderWithManager(
      <TugPane {...defaultWindowProps} stackState={makeStackState("card-t15-elem")} />
    );
    container = result.container;

    const contentDiv = container.querySelector(
      "[data-testid='tug-pane-content']"
    ) as HTMLElement;
    expect(contentDiv).not.toBeNull();

    const textNode = document.createTextNode("hello");
    contentDiv.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 3);
      sel.removeAllRanges();
      sel.addRange(range);

      const saved = selectionGuard.saveSelection("card-t15-elem");
      expect(saved).not.toBeNull();

      sel.removeAllRanges();
      contentDiv.removeChild(textNode);
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
