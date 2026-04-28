/**
 * tug-edit/selection-adapter — `createCMSelectionAdapter` coverage.
 *
 * Coverage:
 *   1. Pure selection queries (`hasRangedSelection`, `getSelectedText`)
 *      and selection mutations (`selectAll`, `expandToWord`,
 *      `selectWordAtPoint`) — drive directly against a mounted
 *      `EditorView`. happy-dom serves CM6's state machinery (doc,
 *      selection, transactions, `wordAt`) faithfully; layout-free is
 *      fine for these.
 *   2. `classifyRightClick` — exercises the geometry hit-test branches
 *      ("near-caret" / "within-range" / "elsewhere"). happy-dom does
 *      not run a layout pipeline so `view.coordsAtPos` returns no
 *      useful rects on its own. The tests stub `coordsAtPos` and
 *      `posAtCoords` on the live view instance with controlled
 *      values per case so the classifier's logic can be asserted
 *      independent of layout.
 *
 * Stubbing strategy: we replace the instance methods directly on the
 * mounted view (CM6 exposes them as instance methods, not closures
 * over private state). Each case pushes a stub for the duration of
 * the assertion; the harness restores the originals in afterEach.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL
 * test files; pulls in the canvas shim used by atom-rendering paths).
 */
import "../../../__tests__/setup-rtl";

import React, { useLayoutEffect, useRef } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate } from "@/components/tugways/tug-edit";
import { createCMSelectionAdapter } from "@/components/tugways/tug-edit/selection-adapter";

// ---------------------------------------------------------------------------
// Canvas 2D shim — atom rendering measures glyph widths via a 2D
// context; happy-dom doesn't implement one. Mirrors `tug-edit.test.tsx`.
// ---------------------------------------------------------------------------

interface MinimalCtx2D {
  font: string;
  measureText(text: string): { width: number };
}

(() => {
  const probe = document.createElement("canvas");
  const proto = Object.getPrototypeOf(probe) as {
    getContext?: (type: string) => unknown;
  };
  const ctx: MinimalCtx2D = {
    font: "",
    measureText(text: string) {
      return { width: text.length * 7 };
    },
  };
  proto.getContext = function getContext(type: string): unknown {
    if (type === "2d") return ctx;
    return null;
  };
})();

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mountHarness(initialDoc: string = ""): {
  view: EditorView;
  unmount: () => void;
} {
  const delegateRef: { current: TugEditDelegate | null } = { current: null };
  function H(): React.ReactElement {
    const ref = useRef<TugEditDelegate>(null);
    useLayoutEffect(() => {
      delegateRef.current = ref.current;
    }, []);
    return React.createElement(TugEdit, { ref, preserveState: false });
  }
  const result = render(React.createElement(H));
  const view = delegateRef.current!.view()!;
  if (initialDoc.length > 0) {
    view.dispatch({
      changes: { from: 0, to: 0, insert: initialDoc },
      selection: EditorSelection.cursor(0),
    });
  }
  return { view, unmount: result.unmount };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Geometry-stub helpers
// ---------------------------------------------------------------------------

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Replace `view.coordsAtPos` with a function that maps each requested
 * position to a rect from the supplied table. Positions not in the
 * table return `null`. Returns a restore callback.
 */
function stubCoordsAtPos(
  view: EditorView,
  table: Record<number, Rect>,
): () => void {
  const original = view.coordsAtPos.bind(view);
  view.coordsAtPos = ((pos: number, _side?: -1 | 1): Rect | null => {
    return Object.prototype.hasOwnProperty.call(table, pos)
      ? table[pos]!
      : null;
  }) as EditorView["coordsAtPos"];
  return () => {
    view.coordsAtPos = original;
  };
}

/**
 * Replace `view.posAtCoords` with a function that maps each (x, y)
 * pair to a position via the supplied table (key: `${x},${y}`).
 * Pairs not in the table return `null`. Returns a restore callback.
 */
function stubPosAtCoords(
  view: EditorView,
  table: Record<string, number>,
): () => void {
  const original = view.posAtCoords.bind(view) as (
    coords: { x: number; y: number },
  ) => number | null;
  view.posAtCoords = ((coords: { x: number; y: number }): number | null => {
    const key = `${coords.x},${coords.y}`;
    return Object.prototype.hasOwnProperty.call(table, key)
      ? table[key]!
      : null;
  }) as EditorView["posAtCoords"];
  return () => {
    view.posAtCoords = original as EditorView["posAtCoords"];
  };
}

// ---------------------------------------------------------------------------
// Pure selection queries
// ---------------------------------------------------------------------------

describe("createCMSelectionAdapter — selection queries", () => {
  it("hasRangedSelection() is false for a collapsed caret", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(3) });
      const adapter = createCMSelectionAdapter(view);
      expect(adapter.hasRangedSelection()).toBe(false);
    } finally {
      unmount();
    }
  });

  it("hasRangedSelection() is true for a non-empty range", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.range(0, 5) });
      const adapter = createCMSelectionAdapter(view);
      expect(adapter.hasRangedSelection()).toBe(true);
    } finally {
      unmount();
    }
  });

  it("getSelectedText() returns the sliced range text", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.range(6, 11) });
      const adapter = createCMSelectionAdapter(view);
      expect(adapter.getSelectedText()).toBe("world");
    } finally {
      unmount();
    }
  });

  it("getSelectedText() returns '' when collapsed", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(3) });
      const adapter = createCMSelectionAdapter(view);
      expect(adapter.getSelectedText()).toBe("");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Selection mutations
// ---------------------------------------------------------------------------

describe("createCMSelectionAdapter — selection mutations", () => {
  it("selectAll() expands the selection to the full document", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(3) });
      const adapter = createCMSelectionAdapter(view);
      adapter.selectAll();
      const sel = view.state.selection.main;
      expect(sel.from).toBe(0);
      expect(sel.to).toBe(view.state.doc.length);
    } finally {
      unmount();
    }
  });

  it("expandToWord() expands a caret on a word to its boundaries", () => {
    const { view, unmount } = mountHarness("the quick brown fox");
    try {
      // Caret inside "quick" (offset 6).
      view.dispatch({ selection: EditorSelection.cursor(6) });
      const adapter = createCMSelectionAdapter(view);
      adapter.expandToWord();
      const sel = view.state.selection.main;
      expect(view.state.sliceDoc(sel.from, sel.to)).toBe("quick");
    } finally {
      unmount();
    }
  });

  it("expandToWord() is a no-op when the caret sits between whitespace on both sides", () => {
    // Two adjacent spaces so position 4 has no word character on
    // either side — `state.wordAt` returns null and the adapter
    // leaves the caret in place.
    const { view, unmount } = mountHarness("the  quick");
    try {
      view.dispatch({ selection: EditorSelection.cursor(4) });
      const adapter = createCMSelectionAdapter(view);
      adapter.expandToWord();
      const sel = view.state.selection.main;
      expect(sel.from).toBe(4);
      expect(sel.to).toBe(4);
    } finally {
      unmount();
    }
  });

  it("expandToWord() is a no-op when a range is already selected", () => {
    const { view, unmount } = mountHarness("the quick brown");
    try {
      view.dispatch({ selection: EditorSelection.range(0, 9) });
      const adapter = createCMSelectionAdapter(view);
      adapter.expandToWord();
      const sel = view.state.selection.main;
      // Range preserved verbatim — adapter does not collapse + reselect.
      expect(sel.from).toBe(0);
      expect(sel.to).toBe(9);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// classifyRightClick
// ---------------------------------------------------------------------------

describe("createCMSelectionAdapter — classifyRightClick", () => {
  it("returns 'within-range' when the click falls inside the selection rect", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.range(6, 11) });
      // Stub coords for the selected range [6, 11). Single line:
      // pos 6 maps to (left=60, …); pos 11 maps to (right=110, …).
      const restore = stubCoordsAtPos(view, {
        6: { left: 60, right: 60, top: 10, bottom: 30 },
        11: { left: 110, right: 110, top: 10, bottom: 30 },
      });
      try {
        const adapter = createCMSelectionAdapter(view);
        // Click inside the rect (x between 60 and 110, y between 10 and 30).
        expect(adapter.classifyRightClick(80, 20)).toBe("within-range");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("returns 'elsewhere' when the click misses a ranged selection", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.range(6, 11) });
      const restore = stubCoordsAtPos(view, {
        6: { left: 60, right: 60, top: 10, bottom: 30 },
        11: { left: 110, right: 110, top: 10, bottom: 30 },
      });
      try {
        const adapter = createCMSelectionAdapter(view);
        // Click below the rect.
        expect(adapter.classifyRightClick(80, 100)).toBe("elsewhere");
        // Click left of the rect.
        expect(adapter.classifyRightClick(20, 20)).toBe("elsewhere");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("returns 'near-caret' when collapsed and click hits the caret's word rect", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      // Caret inside "world" (offset 8). state.wordAt should yield {6, 11}.
      view.dispatch({ selection: EditorSelection.cursor(8) });
      const restore = stubCoordsAtPos(view, {
        6: { left: 60, right: 60, top: 10, bottom: 30 },
        11: { left: 110, right: 110, top: 10, bottom: 30 },
      });
      try {
        const adapter = createCMSelectionAdapter(view);
        expect(adapter.classifyRightClick(80, 20)).toBe("near-caret");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("returns 'elsewhere' when collapsed and click misses the caret's word rect", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(8) });
      const restore = stubCoordsAtPos(view, {
        6: { left: 60, right: 60, top: 10, bottom: 30 },
        11: { left: 110, right: 110, top: 10, bottom: 30 },
      });
      try {
        const adapter = createCMSelectionAdapter(view);
        // Click far below the word's rect.
        expect(adapter.classifyRightClick(80, 200)).toBe("elsewhere");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("returns 'elsewhere' when the caret sits between whitespace on both sides (no word)", () => {
    // Two adjacent spaces so position 6 has no word character on
    // either side — `state.wordAt(6)` returns null and the
    // classifier short-circuits to "elsewhere".
    const { view, unmount } = mountHarness("hello  world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(6) });
      // No coordsAtPos calls expected; provide an empty stub anyway.
      const restore = stubCoordsAtPos(view, {});
      try {
        const adapter = createCMSelectionAdapter(view);
        expect(adapter.classifyRightClick(80, 20)).toBe("elsewhere");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// selectWordAtPoint
// ---------------------------------------------------------------------------

describe("createCMSelectionAdapter — selectWordAtPoint", () => {
  it("selects the word under the click point", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      // Click resolves to position 8 — middle of "world" — wordAt(8) → {6, 11}.
      const restore = stubPosAtCoords(view, { "100,20": 8 });
      try {
        const adapter = createCMSelectionAdapter(view);
        adapter.selectWordAtPoint(100, 20);
        const sel = view.state.selection.main;
        expect(view.state.sliceDoc(sel.from, sel.to)).toBe("world");
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("collapses the caret at the click point when no word is there", () => {
    // Two adjacent spaces so position 6 has no word character on
    // either side — `state.wordAt(6)` returns null and the
    // adapter collapses the caret at the click position.
    const { view, unmount } = mountHarness("hello  world");
    try {
      const restore = stubPosAtCoords(view, { "100,20": 6 });
      try {
        const adapter = createCMSelectionAdapter(view);
        adapter.selectWordAtPoint(100, 20);
        const sel = view.state.selection.main;
        expect(sel.from).toBe(6);
        expect(sel.to).toBe(6);
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });

  it("is a no-op when the click resolves outside any rendered position", () => {
    const { view, unmount } = mountHarness("hello world");
    try {
      view.dispatch({ selection: EditorSelection.cursor(3) });
      const restore = stubPosAtCoords(view, {}); // nothing maps
      try {
        const adapter = createCMSelectionAdapter(view);
        adapter.selectWordAtPoint(999, 999);
        const sel = view.state.selection.main;
        expect(sel.from).toBe(3);
        expect(sel.to).toBe(3);
      } finally {
        restore();
      }
    } finally {
      unmount();
    }
  });
});
