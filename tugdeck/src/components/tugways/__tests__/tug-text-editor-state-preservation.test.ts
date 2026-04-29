/**
 * tug-text-editor/state-preservation — capture / restore / paint primitives.
 *
 * Covers the substrate-level state-preservation contract:
 *   1. `captureEditState` reads doc + atoms + selection + scrollTop
 *      from the live `EditorView`.
 *   2. `restoreEditState` round-trips the captured payload back into
 *      a view (doc, atoms, selection, scrollTop) without claiming
 *      focus.
 *   3. `paintMirrorAsInactive` builds a `Range` from the live or
 *      supplied selection and routes it through the caller's
 *      `publish` callback. A null-selection input publishes `null`.
 *   4. `paintMirrorAsActive` dispatches a selection transaction
 *      when state is supplied, so the post-paint
 *      `view.state.selection` matches the bag.
 *   5. The deactivate → activate sequence routes through both paint
 *      channels in order: deactivate publishes a Range; activate
 *      then asserts the bag's selection on the view.
 *
 * Scope: pure-logic / view-state level only. The hook itself
 * (`useTextEditorStatePreservation`) crosses React renders, document-level
 * capture-phase listeners, and CardHost protocol — none of which
 * happy-dom models faithfully. The project's test-scoping rule
 * reserves that interaction for `just app-test` and the gallery card
 * walk-through; we test the substrate primitives the hook composes
 * over, which is where the [L23] correctness lives.
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

import { TugTextEditor } from "@/components/tugways/tug-text-editor";
import type { TugTextEditorDelegate } from "@/components/tugways/tug-text-editor";
import { getAtomsInState } from "@/components/tugways/tug-text-editor/atom-decoration";
import { captureEditState } from "@/components/tugways/tug-text-editor/keymap";
import {
  paintMirrorAsActive,
  paintMirrorAsInactive,
  restoreEditState,
} from "@/components/tugways/tug-text-editor/state-preservation";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";
import type { TugTextEditingState } from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Canvas 2D shim — atom rendering measures glyph widths via a 2D context;
// happy-dom doesn't implement one. Mirrors `tug-text-editor.test.tsx`.
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

/**
 * Mount a stand-alone `TugTextEditor` (no `CardHost`) and capture the
 * live delegate. `preserveState={false}` keeps the registration hook
 * out of the way — these tests drive the substrate primitives
 * directly. Returns the view, the delegate, and an `unmount` for
 * deterministic teardown.
 */
function mountHarness(): {
  view: EditorView;
  delegate: TugTextEditorDelegate;
  unmount: () => void;
} {
  const delegateRef: { current: TugTextEditorDelegate | null } = { current: null };

  function H(): React.ReactElement {
    const ref = useRef<TugTextEditorDelegate>(null);
    useLayoutEffect(() => {
      delegateRef.current = ref.current;
    }, []);
    return React.createElement(TugTextEditor, {
      ref,
      preserveState: false,
    });
  }

  const result = render(React.createElement(H));
  const delegate = delegateRef.current!;
  const view = delegate.view()!;
  return { view, delegate, unmount: result.unmount };
}

afterEach(() => {
  cleanup();
});

// Sample atom used across the suite.
const FILE_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "main.ts",
  value: "/main.ts",
};

// ---------------------------------------------------------------------------
// captureEditState
// ---------------------------------------------------------------------------

describe("captureEditState", () => {
  it("includes scrollTop and scrollLeft alongside doc + atoms + selection", () => {
    const { view, delegate, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      view.dispatch({ changes: { from: 3, insert: "cd" } });
      view.dispatch({ selection: { anchor: 4 } });

      const captured = captureEditState(view);
      expect(captured.text).toBe(`ab${TUG_ATOM_CHAR}cd`);
      expect(captured.atoms).toHaveLength(1);
      expect(captured.atoms[0]).toEqual({
        position: 2,
        type: FILE_ATOM.type,
        label: FILE_ATOM.label,
        value: FILE_ATOM.value,
      });
      expect(captured.selection).toEqual({ start: 4, end: 4 });
      // happy-dom returns 0 for scroll offsets on un-laid-out
      // elements; the contract is that both axes are numbers, not
      // the specific values (real WebKit verifies the values).
      expect(typeof captured.scrollTop).toBe("number");
      expect(typeof captured.scrollLeft).toBe("number");
    } finally {
      unmount();
    }
  });

  it("reports scrollTop and scrollLeft verbatim from `view.scrollDOM`", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "x".repeat(200) } });
      // Force non-zero scroll offsets on both axes so the capture
      // has distinguishing values. happy-dom honors direct
      // assignment; real layout would clamp to
      // scroll{Height,Width} - client{Height,Width}.
      view.scrollDOM.scrollTop = 42;
      view.scrollDOM.scrollLeft = 17;
      const captured = captureEditState(view);
      expect(captured.scrollTop).toBe(42);
      expect(captured.scrollLeft).toBe(17);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// restoreEditState
// ---------------------------------------------------------------------------

describe("restoreEditState", () => {
  it("replaces doc, atoms, and selection in one transaction", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "stale" } });

      const target: TugTextEditingState = {
        text: `pre ${TUG_ATOM_CHAR} post`,
        atoms: [
          {
            position: 4,
            type: FILE_ATOM.type,
            label: FILE_ATOM.label,
            value: FILE_ATOM.value,
          },
        ],
        selection: { start: 5, end: 5 },
      };
      restoreEditState(view, target);

      expect(view.state.doc.toString()).toBe(target.text);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(4);
      const sel = view.state.selection.main;
      expect(sel.from).toBe(5);
      expect(sel.to).toBe(5);
    } finally {
      unmount();
    }
  });

  it("writes scrollTop from the supplied state", () => {
    const { view, unmount } = mountHarness();
    try {
      view.scrollDOM.scrollTop = 0;
      const state: TugTextEditingState = {
        text: "x".repeat(50),
        atoms: [],
        selection: { start: 0, end: 0 },
        scrollTop: 17,
      };
      restoreEditState(view, state);
      expect(view.scrollDOM.scrollTop).toBe(17);
    } finally {
      unmount();
    }
  });

  it("writes scrollLeft from the supplied state", () => {
    const { view, unmount } = mountHarness();
    try {
      view.scrollDOM.scrollLeft = 0;
      const state: TugTextEditingState = {
        text: "x".repeat(200),
        atoms: [],
        selection: { start: 0, end: 0 },
        scrollLeft: 24,
      };
      restoreEditState(view, state);
      expect(view.scrollDOM.scrollLeft).toBe(24);
    } finally {
      unmount();
    }
  });

  it("leaves scrollTop / scrollLeft untouched when state has null on those axes", () => {
    const { view, unmount } = mountHarness();
    try {
      view.scrollDOM.scrollTop = 25;
      view.scrollDOM.scrollLeft = 13;
      const state: TugTextEditingState = {
        text: "hello",
        atoms: [],
        selection: { start: 0, end: 0 },
        scrollTop: null,
        scrollLeft: null,
      };
      restoreEditState(view, state);
      // happy-dom leaves scroll offsets at their prior values; the
      // function intentionally does not write when the bag has null
      // — the per-axis check applies independently.
      expect(view.scrollDOM.scrollTop).toBe(25);
      expect(view.scrollDOM.scrollLeft).toBe(13);
    } finally {
      unmount();
    }
  });

  it("writes scrollTop without touching scrollLeft when scrollLeft is null", () => {
    const { view, unmount } = mountHarness();
    try {
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 13;
      const state: TugTextEditingState = {
        text: "hello",
        atoms: [],
        selection: { start: 0, end: 0 },
        scrollTop: 7,
        // scrollLeft omitted — covers legacy on-disk bags.
      };
      restoreEditState(view, state);
      expect(view.scrollDOM.scrollTop).toBe(7);
      expect(view.scrollDOM.scrollLeft).toBe(13);
    } finally {
      unmount();
    }
  });

  it("captureEditState → restoreEditState round-trips identically", () => {
    const { view, delegate, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "xy" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      view.dispatch({ changes: { from: 3, insert: "zw" } });
      view.dispatch({ selection: { anchor: 1 } });
      view.scrollDOM.scrollTop = 99;
      view.scrollDOM.scrollLeft = 31;
      const snapshot = captureEditState(view);

      // Mutate.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "noise" },
      });
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;

      // Restore.
      restoreEditState(view, snapshot);

      expect(view.state.doc.toString()).toBe(snapshot.text);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(2);
      const sel = view.state.selection.main;
      expect(sel.from).toBe(snapshot.selection!.start);
      expect(sel.to).toBe(snapshot.selection!.end);
      expect(view.scrollDOM.scrollTop).toBe(99);
      expect(view.scrollDOM.scrollLeft).toBe(31);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// paintMirrorAsInactive
// ---------------------------------------------------------------------------

describe("paintMirrorAsInactive", () => {
  it("publishes a Range built from the live view selection when no state is supplied", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "hello" } });
      view.dispatch({ selection: EditorSelection.range(1, 4) });

      let published: Range | null | undefined;
      paintMirrorAsInactive(view, (r) => {
        published = r;
      });

      expect(published).toBeInstanceOf(Range);
      // The published Range anchors inside `view.contentDOM`.
      const r = published as Range;
      expect(view.contentDOM.contains(r.startContainer)).toBe(true);
      expect(view.contentDOM.contains(r.endContainer)).toBe(true);
    } finally {
      unmount();
    }
  });

  it("publishes a Range from the supplied state's selection", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abcdef" } });
      view.dispatch({ selection: { anchor: 0 } });

      let published: Range | null | undefined;
      const state: TugTextEditingState = {
        text: "abcdef",
        atoms: [],
        selection: { start: 1, end: 5 },
      };
      paintMirrorAsInactive(
        view,
        (r) => {
          published = r;
        },
        state,
      );

      expect(published).toBeInstanceOf(Range);
      const r = published as Range;
      expect(view.contentDOM.contains(r.startContainer)).toBe(true);
      expect(view.contentDOM.contains(r.endContainer)).toBe(true);
    } finally {
      unmount();
    }
  });

  it("publishes null when supplied state has a null selection", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "hi" } });
      view.dispatch({ selection: { anchor: 1 } });

      let published: Range | null | undefined = undefined;
      let calls = 0;
      paintMirrorAsInactive(
        view,
        (r) => {
          published = r;
          calls += 1;
        },
        { text: "hi", atoms: [], selection: null },
      );

      expect(calls).toBe(1);
      expect(published).toBeNull();
    } finally {
      unmount();
    }
  });

  it("does NOT call view.focus()", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abc" } });
      view.dispatch({ selection: EditorSelection.range(0, 3) });

      // Ensure contentDOM is not the active element before the call.
      view.contentDOM.blur();
      const activeBefore = document.activeElement;

      paintMirrorAsInactive(view, () => {});

      // contentDOM did not steal focus.
      expect(document.activeElement).toBe(activeBefore);
    } finally {
      unmount();
    }
  });

  it("writes scroll axes only when state supplies numbers", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "x".repeat(50) } });
      view.scrollDOM.scrollTop = 8;
      view.scrollDOM.scrollLeft = 4;

      // No state — leaves both axes alone.
      paintMirrorAsInactive(view, () => {});
      expect(view.scrollDOM.scrollTop).toBe(8);
      expect(view.scrollDOM.scrollLeft).toBe(4);

      // State with both axes — writes both.
      paintMirrorAsInactive(
        view,
        () => {},
        {
          text: "x".repeat(50),
          atoms: [],
          selection: null,
          scrollTop: 33,
          scrollLeft: 21,
        },
      );
      expect(view.scrollDOM.scrollTop).toBe(33);
      expect(view.scrollDOM.scrollLeft).toBe(21);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// paintMirrorAsActive
// ---------------------------------------------------------------------------

describe("paintMirrorAsActive", () => {
  it("dispatches selection from the supplied state onto the view", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abcdef" } });
      view.dispatch({ selection: { anchor: 0 } });

      paintMirrorAsActive(view, {
        text: "abcdef",
        atoms: [],
        selection: { start: 2, end: 5 },
      });

      const sel = view.state.selection.main;
      expect(sel.from).toBe(2);
      expect(sel.to).toBe(5);
    } finally {
      unmount();
    }
  });

  it("leaves view.state.selection untouched when state is omitted", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abcdef" } });
      view.dispatch({ selection: EditorSelection.range(1, 4) });
      const before = view.state.selection.main;

      paintMirrorAsActive(view);

      const after = view.state.selection.main;
      expect(after.from).toBe(before.from);
      expect(after.to).toBe(before.to);
    } finally {
      unmount();
    }
  });

  it("writes both scroll axes from the supplied state", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "x".repeat(50) } });
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;

      paintMirrorAsActive(view, {
        text: "x".repeat(50),
        atoms: [],
        selection: { start: 0, end: 0 },
        scrollTop: 11,
        scrollLeft: 22,
      });

      expect(view.scrollDOM.scrollTop).toBe(11);
      expect(view.scrollDOM.scrollLeft).toBe(22);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Deactivate → activate sequence
// ---------------------------------------------------------------------------

describe("deactivate → activate sequence", () => {
  it("publishes a Range on deactivate and asserts the bag's selection on activate", () => {
    const { view, unmount } = mountHarness();
    try {
      // Set up a non-empty selection.
      view.dispatch({ changes: { from: 0, insert: "hello world" } });
      view.dispatch({ selection: EditorSelection.range(2, 7) });

      // 1. Deactivate: paintMirrorAsInactive publishes a Range.
      let published: Range | null = null;
      paintMirrorAsInactive(view, (r) => {
        published = r;
      });
      expect(published).toBeInstanceOf(Range);

      // The deactivated card's selection in `view.state` is unchanged
      // — the Range was published to the caller's channel
      // (selectionGuard in production), not via a transaction.
      const afterDeactivate = view.state.selection.main;
      expect(afterDeactivate.from).toBe(2);
      expect(afterDeactivate.to).toBe(7);

      // 2. Activate: a different bag asserts a different selection on
      //    the view via paintMirrorAsActive(state). This simulates a
      //    cold-mount restore where the saved selection differs from
      //    whatever happened to be on the view before the paint.
      paintMirrorAsActive(view, {
        text: "hello world",
        atoms: [],
        selection: { start: 0, end: 5 },
      });

      const afterActivate = view.state.selection.main;
      expect(afterActivate.from).toBe(0);
      expect(afterActivate.to).toBe(5);
    } finally {
      unmount();
    }
  });
});
