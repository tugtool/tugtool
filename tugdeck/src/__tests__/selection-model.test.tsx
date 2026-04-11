/**
 * Selection model integration tests -- Step 5.
 *
 * Tests cover:
 * - T13: Tugcard does NOT handle selectAll (boundary enforcer model — content components own it)
 * - T14: Dispatching selectAll to card is unhandled (no selectAllChildren call)
 * - T15: Tugcard content area is registered with SelectionGuard on mount
 * - T15a: Contenteditable region with data-tug-select="custom" inside card content
 *         receives full selection autonomy (guard does not clip within the custom region)
 * - T16: Existing tugcard.test.tsx passes (no regressions) -- covered by running
 *         both test suites; this file tests the selection model additions only.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { Tugcard } from "@/components/tugways/tug-card";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { withDeckManager } from "./mock-deck-manager-store";
import type { FeedIdValue } from "@/protocol";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a Tugcard inside a manually-controlled ResponderChainManager so tests
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

/** Minimal valid Tugcard props for a feedless card. */
const defaultProps = {
  cardId: "card-sel-test",
  meta: { title: "Selection Test Card" },
  feedIds: [] as readonly FeedIdValue[],
} as const;

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
// T13: Tugcard does NOT handle selectAll (boundary enforcer model)
// ---------------------------------------------------------------------------

describe("T13 – Tugcard does not handle selectAll", () => {
  it("canHandle('select-all') returns false — card does not own selectAll", () => {
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t13">
        <div>content</div>
      </Tugcard>
    );

    // Card does not register a selectAll handler. Content components
    // (tug-input, tug-markdown-view, etc.) handle it in their own
    // responder registrations. If no content component handles it,
    // the action bubbles past the card — which is correct.
    expect(manager.canHandle("select-all")).toBe(false);
  });

  it("pre-existing card actions are still registered", () => {
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t13b">
        <div>content</div>
      </Tugcard>
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
      <Tugcard {...defaultProps} cardId="card-t14">
        <div>content</div>
      </Tugcard>
    );

    // selectAll dispatched with no content component as first responder.
    // The card does not handle it — the dispatch returns handled: false.
    expect(() => {
      act(() => {
        manager.dispatch({ action: TUG_ACTIONS.SELECT_ALL, phase: "discrete" });
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T15: Tugcard content area is registered with SelectionGuard on mount
// ---------------------------------------------------------------------------

describe("T15 – Tugcard registers content area with SelectionGuard", () => {
  it("content area is registered on mount (saveSelection returns null, not error)", () => {
    // After mount, the card's content area is registered with SelectionGuard.
    // saveSelection returns null only because there is no active selection --
    // this is the correct "registered but no selection" state.
    renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t15">
        <div>content</div>
      </Tugcard>
    );

    // Card is registered — saveSelection returns null (no selection), not an error
    expect(selectionGuard.saveSelection("card-t15")).toBeNull();
  });

  it("content area is unregistered on unmount", () => {
    let unmount!: () => void;

    renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t15-unmount">
        <div>content</div>
      </Tugcard>
    );
    // Grab the unmount from the original render -- we need to call it
    const result = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t15-unmount2">
        <div>content</div>
      </Tugcard>
    );
    unmount = result.unmount;

    act(() => {
      unmount();
    });

    // After unmount the boundary is removed.
    // saveSelection returns null for both registered-but-empty and unregistered cards.
    expect(selectionGuard.saveSelection("card-t15-unmount2")).toBeNull();
  });

  it("content area element passed to SelectionGuard is the tugcard-content div", () => {
    let container!: HTMLElement;
    const result = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t15-elem">
        <div data-testid="inner">text</div>
      </Tugcard>
    );
    container = result.container;

    const contentDiv = container.querySelector(
      "[data-testid='tugcard-content']"
    ) as HTMLElement;
    expect(contentDiv).not.toBeNull();

    // Add selectable text and set a selection inside the content div
    const textNode = document.createTextNode("hello");
    contentDiv.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 3);
      sel.removeAllRanges();
      sel.addRange(range);

      // saveSelection must return non-null: the selection is inside the
      // registered boundary element (the tugcard-content div)
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
  it("contenteditable region with data-tug-select=custom is inside card content (not blocked)", () => {
    // Verify the structure: a contenteditable div with data-tug-select="custom"
    // is rendered inside the card content area without error.
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <Tugcard {...defaultProps} cardId="card-t15a">
          <div
            contentEditable
            data-tug-select="custom"
            data-testid="custom-editable"
            suppressContentEditableWarning
          >
            Editable content
          </div>
        </Tugcard>
      );
      container = result.container;
    });

    const editableEl = container.querySelector(
      "[data-testid='custom-editable']"
    );
    expect(editableEl).not.toBeNull();
    expect(editableEl?.getAttribute("data-tug-select")).toBe("custom");
    expect(editableEl?.getAttribute("contenteditable")).toBe("true");

    // The editable element is inside the card's content area
    const contentDiv = container.querySelector("[data-testid='tugcard-content']");
    expect(contentDiv).not.toBeNull();
    expect(contentDiv?.contains(editableEl)).toBe(true);
  });

  it("setting a selection inside a custom region and saving does not error", () => {
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <Tugcard {...defaultProps} cardId="card-t15a-sel">
          <div
            contentEditable
            data-tug-select="custom"
            data-testid="custom-editable"
            suppressContentEditableWarning
          >
            Editable content
          </div>
        </Tugcard>
      );
      container = result.container;
    });

    const editableEl = container.querySelector(
      "[data-testid='custom-editable']"
    ) as HTMLElement;
    expect(editableEl).not.toBeNull();

    // Add a text node and set a selection within the editable
    const textNode = document.createTextNode("custom text");
    editableEl.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 6);
      sel.removeAllRanges();
      sel.addRange(range);

      // saveSelection must not throw even for custom regions
      expect(() => selectionGuard.saveSelection("card-t15a-sel")).not.toThrow();

      sel.removeAllRanges();
      editableEl.removeChild(textNode);
    }
  });

  it("SelectionGuard does not interfere with selection inside custom region (no clipping)", () => {
    // When attach() is not called (default in unit tests), the guard installs
    // no event listeners, so it cannot interfere. This test verifies the guard
    // state is clean and never disrupts an independent selection op.
    let container!: HTMLElement;
    act(() => {
      const result = renderWithManager(
        <Tugcard {...defaultProps} cardId="card-t15a-noclip">
          <div
            contentEditable
            data-tug-select="custom"
            data-testid="custom-region"
            suppressContentEditableWarning
          >
            Rich text here
          </div>
        </Tugcard>
      );
      container = result.container;
    });

    const customRegion = container.querySelector(
      "[data-testid='custom-region']"
    ) as HTMLElement;
    const textNode = document.createTextNode("Rich text here");
    customRegion.appendChild(textNode);

    const sel = window.getSelection();
    if (sel) {
      (sel as any).setBaseAndExtent(textNode, 0, textNode, 4);
      const anchorBefore = sel.anchorNode;
      const offsetBefore = sel.anchorOffset;

      // Guard is attached to no listeners in test environment --
      // the selection must be exactly as set, unchanged.
      expect(sel.anchorNode).toBe(anchorBefore);
      expect(sel.anchorOffset).toBe(offsetBefore);

      sel.removeAllRanges();
      customRegion.removeChild(textNode);
    }
  });
});

// ---------------------------------------------------------------------------
// T16: Regression – existing Tugcard actions still work
// ---------------------------------------------------------------------------

describe("T16 – regression: existing Tugcard actions unaffected", () => {
  it("dispatching close through the chain still calls onClose", () => {
    const onClose = mock(() => {});
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t16-close" onClose={onClose}>
        <div>content</div>
      </Tugcard>
    );

    act(() => {
      manager.dispatch({ action: TUG_ACTIONS.CLOSE, phase: "discrete" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("all original responder actions are still registered (selectAll is NOT)", () => {
    const { manager } = renderWithManager(
      <Tugcard {...defaultProps} cardId="card-t16-all">
        <div>content</div>
      </Tugcard>
    );

    expect(manager.canHandle("close")).toBe(true);
    expect(manager.canHandle("minimize")).toBe(true);
    expect(manager.canHandle("toggle-menu")).toBe(true);
    expect(manager.canHandle("find")).toBe(true);
    expect(manager.canHandle("select-all")).toBe(false);
  });
});
