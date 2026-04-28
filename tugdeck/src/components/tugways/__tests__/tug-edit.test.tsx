/**
 * TugEdit — substrate bootstrap tests.
 *
 * Verifies that the CodeMirror 6-backed `TugEdit` component:
 *   1. Mounts and constructs an `EditorView` accessible via the
 *      imperative delegate.
 *   2. Renders the editor's DOM tree into the host wrapper.
 *   3. Disposes the `EditorView` cleanly on unmount, and a subsequent
 *      mount produces a fresh, distinct `EditorView` instance —
 *      validating the StrictMode-safe lifecycle pattern documented
 *      in the `tug-edit.tsx` module docstring.
 *   4. Pure-logic helpers (`resolveEnterAction`, `captureEditState`,
 *      `applyEditState`) round-trip cleanly — these are pure
 *      functions over CM6 view state, so happy-dom is the right
 *      environment.
 *
 * Scope: structural mount / unmount and pure-logic substrate
 * helpers only. Focus, selection, keyboard events, and the
 * keymap-vs-responder-chain interaction are deliberately NOT
 * covered here — those interactions cross React renders,
 * document-level capture-phase listeners, native browser focus,
 * and the contentEditable selection model, none of which happy-dom
 * models faithfully. The project's test-scoping rule reserves them
 * for `just app-test` (real WebKit) and the gallery card. Adding
 * synthetic `KeyboardEvent` dispatches here would produce green
 * tests for behaviors that are broken in the real browser.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "../../../__tests__/setup-rtl";

import React, { useRef, useLayoutEffect } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteCharBackward, deleteCharForward } from "@codemirror/commands";

import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate } from "@/components/tugways/tug-edit";
import {
  atomDecorationField,
  AtomWidget,
  getAtomsInState,
  regenerateAtomsEffect,
} from "@/components/tugways/tug-edit/atom-decoration";
import {
  applyEditState,
  captureEditState,
  resolveEnterAction,
} from "@/components/tugways/tug-edit/keymap";
import type { TugEditKeymapConfig } from "@/components/tugways/tug-edit/keymap";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";
import type { TugTextEditingState } from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Canvas 2D shim
// ---------------------------------------------------------------------------
//
// happy-dom does not implement `HTMLCanvasElement.getContext("2d")`. The
// atom-rendering path (`tug-atom-img.ts`) creates a measurement canvas
// to compute label widths during SVG generation; without a context,
// every atom insertion throws `null is not an object (evaluating
// 'ctx.font = font')` mid-dispatch. The shim returns a minimal 2D
// context object that supplies just the surface area atom rendering
// touches: a writable `font` string and a `measureText` that returns
// a plausible width. Installed once at module load — every atom test
// in this file relies on it.

interface MinimalCtx2D {
  font: string;
  measureText(text: string): { width: number };
}

(() => {
  // Probe the live canvas prototype rather than reaching for a global
  // `HTMLCanvasElement` class — happy-dom's setup-rtl does not bind
  // `HTMLCanvasElement` on `global`, but `document.createElement` does
  // produce real instances whose prototype is reachable.
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
// Test harness
// ---------------------------------------------------------------------------

/**
 * Test harness that mounts a `TugEdit` and writes the live delegate
 * into a caller-supplied ref via `useLayoutEffect` so the test can
 * read it after `render` returns. Using `useLayoutEffect` rather than
 * `useEffect` ensures the delegate is observable in the same tick as
 * the render, mirroring how production consumers (TugPromptEntry,
 * tide-card) read the handle.
 */
function Harness({
  delegateRef,
}: {
  delegateRef: { current: TugEditDelegate | null };
}) {
  const ref = useRef<TugEditDelegate>(null);
  useLayoutEffect(() => {
    delegateRef.current = ref.current;
    return () => {
      delegateRef.current = null;
    };
  }, [delegateRef]);
  return <TugEdit ref={ref} data-testid="harness-edit" />;
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TugEdit — bootstrap", () => {
  it("mounts and exposes an EditorView through the delegate", () => {
    const delegateRef: { current: TugEditDelegate | null } = { current: null };
    const { container } = render(<Harness delegateRef={delegateRef} />);

    // The delegate is exposed via `useImperativeHandle`.
    expect(delegateRef.current).not.toBeNull();
    const view = delegateRef.current!.view();
    expect(view).toBeInstanceOf(EditorView);

    // The CodeMirror DOM tree is mounted inside the host wrapper.
    const host = container.querySelector<HTMLElement>('[data-testid="harness-edit"]');
    expect(host).not.toBeNull();
    const cmEditor = host!.querySelector<HTMLElement>(".cm-editor");
    expect(cmEditor).not.toBeNull();

    // The view's DOM property points at the same `.cm-editor` node
    // the wrapper renders — proving the host parent contract.
    expect(view!.dom).toBe(cmEditor!);
  });

  it("disposes the EditorView on unmount and produces a fresh view on re-mount", () => {
    const delegateRef: { current: TugEditDelegate | null } = { current: null };

    // First mount.
    const first = render(<Harness delegateRef={delegateRef} />);
    const firstView = delegateRef.current!.view();
    expect(firstView).toBeInstanceOf(EditorView);

    // Unmount — cleanup destroys the view and clears the delegate
    // ref. The delegate is unreachable through the harness ref after
    // unmount; we read directly from the captured `firstView`.
    first.unmount();
    expect(delegateRef.current).toBeNull();

    // Second mount — a fresh, distinct EditorView is constructed.
    render(<Harness delegateRef={delegateRef} />);
    const secondView = delegateRef.current!.view();
    expect(secondView).toBeInstanceOf(EditorView);
    expect(secondView).not.toBe(firstView);
  });

  it("clears the delegate's view between unmount and re-mount", () => {
    const delegateRef: { current: TugEditDelegate | null } = { current: null };

    const { unmount } = render(<Harness delegateRef={delegateRef} />);
    const captured = delegateRef.current;
    expect(captured).not.toBeNull();
    expect(captured!.view()).not.toBeNull();

    unmount();

    // After unmount the harness clears `delegateRef`, so we read the
    // captured handle. The cleanup in `tug-edit.tsx` zeroes
    // `viewRef.current`, so `view()` returns null.
    expect(captured!.view()).toBeNull();
  });
});

describe("TugEdit — theme and host-state wiring", () => {
  it("applies the focusStyle prop as data-focus-style on the host", () => {
    const { container, rerender } = render(
      <TugEdit data-testid="theme-edit" focusStyle="background" />,
    );
    const host = container.querySelector<HTMLElement>('[data-testid="theme-edit"]')!;
    expect(host.getAttribute("data-focus-style")).toBe("background");

    rerender(<TugEdit data-testid="theme-edit" focusStyle="ring" />);
    expect(host.getAttribute("data-focus-style")).toBe("ring");
  });

  it("applies data-borderless only when borderless is true", () => {
    const { container, rerender } = render(
      <TugEdit data-testid="theme-edit" borderless={false} />,
    );
    const host = container.querySelector<HTMLElement>('[data-testid="theme-edit"]')!;
    expect(host.hasAttribute("data-borderless")).toBe(false);

    rerender(<TugEdit data-testid="theme-edit" borderless={true} />);
    expect(host.hasAttribute("data-borderless")).toBe(true);
    expect(host.getAttribute("data-borderless")).toBe("");
  });

  it("attaches a CodeMirror theme class to the editor root", () => {
    const { container } = render(<TugEdit data-testid="theme-edit" />);
    const cmEditor = container.querySelector<HTMLElement>(".cm-editor");
    expect(cmEditor).not.toBeNull();

    // CM6 emits an auto-generated theme class (looks like `ͼ{n}` —
    // a U+023C tail-style character followed by a base-26 ordinal)
    // for every `EditorView.theme(...)` extension. The presence of
    // that class proves the tugTheme extension is loaded.
    const classes = Array.from(cmEditor!.classList);
    const hasCmGeneratedClass = classes.some((c) => /^ͼ/.test(c));
    expect(hasCmGeneratedClass).toBe(true);
  });

  it("renders an editable `.cm-content` surface inside the host", () => {
    const { container } = render(<TugEdit data-testid="theme-edit" />);
    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();
    expect(content!.getAttribute("contenteditable")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Atom integration
// ---------------------------------------------------------------------------

const FILE_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "main.ts",
  value: "/main.ts",
};

/**
 * Helper: render TugEdit, capture the live delegate, type some text
 * via `view.dispatch`, and return the view + delegate for the test
 * to drive. Uses dispatch (not simulated keypresses) so the tests
 * stay independent of happy-dom's beforeinput/keydown handling —
 * everything here runs at the EditorView state level.
 */
function mountAtomHarness(): {
  view: EditorView;
  delegate: TugEditDelegate;
  unmount: () => void;
} {
  const delegateRef: { current: TugEditDelegate | null } = { current: null };

  function H(): React.ReactElement {
    const ref = useRef<TugEditDelegate>(null);
    useLayoutEffect(() => {
      delegateRef.current = ref.current;
    }, []);
    return <TugEdit ref={ref} data-testid="atom-harness" />;
  }

  const result = render(<H />);
  const delegate = delegateRef.current!;
  const view = delegate.view()!;
  return {
    view,
    delegate,
    unmount: result.unmount,
  };
}

describe("TugEdit — atom integration", () => {
  it("insertAtom places U+FFFC and a matching widget decoration at the caret", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      // Pre-fill some text: "abXcd" with cursor at position 2.
      view.dispatch({ changes: { from: 0, insert: "abcd" } });
      view.dispatch({ selection: { anchor: 2 } });

      delegate.insertAtom(FILE_ATOM);

      // Document gained one U+FFFC at offset 2.
      expect(view.state.doc.toString()).toBe(`ab${TUG_ATOM_CHAR}cd`);
      expect(view.state.doc.length).toBe(5);

      // Caret lands immediately after the new atom.
      expect(view.state.selection.main.head).toBe(3);

      // The decoration field carries one AtomWidget over [2, 3).
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(2);
      expect(atoms[0]!.segment).toEqual(FILE_ATOM);
    } finally {
      unmount();
    }
  });

  it("right-arrow advances by one across an atom (atomicRanges respected)", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // After insertAtom: doc is "ab￼", caret at 3. Insert
      // trailing text then move caret back to just before the atom.
      view.dispatch({ changes: { from: 3, insert: "cd" } });
      view.dispatch({ selection: { anchor: 2 } });

      const start = view.state.selection.main;
      const next = view.moveByChar(start, true);
      // The atom is one document character (one U+FFFC), so a single
      // moveByChar step lands the caret immediately after it.
      expect(next.head).toBe(3);
      expect(next.empty).toBe(true);
    } finally {
      unmount();
    }
  });

  it("left-arrow steps back across an atom in one step", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // Caret is at 3 (right after the atom).
      const next = view.moveByChar(view.state.selection.main, false);
      expect(next.head).toBe(2);
      expect(next.empty).toBe(true);
    } finally {
      unmount();
    }
  });

  it("shift+right extends the selection across an atom in one step", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // Place a collapsed caret immediately before the atom.
      view.dispatch({ selection: EditorSelection.cursor(2) });

      // Build an extending range using moveByChar with extend.
      const range = view.state.selection.main;
      const moved = view.moveByChar(range, true);
      // A non-extending move with the same call would have anchor=head;
      // the atomicRanges behavior we care about is whether the extended
      // form lands at 3 (after-atom). Replicate the extend by holding
      // the anchor fixed.
      const extended = EditorSelection.range(range.anchor, moved.head);

      expect(extended.from).toBe(2);
      expect(extended.to).toBe(3);
      expect(extended.empty).toBe(false);
    } finally {
      unmount();
    }
  });

  it("backspace immediately after an atom deletes the whole atom and clears the decoration", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // Caret at 3 (after the atom).
      expect(view.state.doc.length).toBe(3);

      const handled = deleteCharBackward(view);
      expect(handled).toBe(true);

      // U+FFFC is gone; the decoration set is empty.
      expect(view.state.doc.toString()).toBe("ab");
      expect(getAtomsInState(view.state)).toHaveLength(0);

      // The decoration field's range set is also empty (the deletion
      // dropped the [2, 3) widget along with the character).
      const decoSet = view.state.field(atomDecorationField);
      expect(decoSet.size).toBe(0);
    } finally {
      unmount();
    }
  });

  it("forward-delete immediately before an atom deletes the whole atom", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "ab" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // Move caret back to immediately before the atom.
      view.dispatch({ selection: EditorSelection.cursor(2) });

      const handled = deleteCharForward(view);
      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("ab");
      expect(getAtomsInState(view.state)).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it("atomDecorationField widgets carry the original AtomSegment identity", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      delegate.insertAtom(FILE_ATOM);
      const cursor = view.state.field(atomDecorationField).iter();
      expect(cursor.value).not.toBeNull();
      const widget = (cursor.value!.spec as { widget?: unknown }).widget;
      expect(widget).toBeInstanceOf(AtomWidget);
      expect((widget as AtomWidget).segment).toEqual(FILE_ATOM);
    } finally {
      unmount();
    }
  });

  it("regenerateAtomsEffect produces widgets that compare !eq to the prior generation", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      delegate.insertAtom(FILE_ATOM);

      const before = view.state.field(atomDecorationField).iter();
      expect(before.value).not.toBeNull();
      const oldWidget = (before.value!.spec as { widget?: unknown }).widget as AtomWidget;
      expect(oldWidget).toBeInstanceOf(AtomWidget);
      const oldToken = oldWidget.regenToken;

      view.dispatch({ effects: regenerateAtomsEffect.of(null) });

      const after = view.state.field(atomDecorationField).iter();
      const newWidget = (after.value!.spec as { widget?: unknown }).widget as AtomWidget;
      expect(newWidget).toBeInstanceOf(AtomWidget);

      // Same segment data — but token bumped, so `eq` is false and
      // CM6 will rebuild the DOM with freshly resolved theme colors.
      expect(newWidget.segment).toEqual(oldWidget.segment);
      expect(newWidget.regenToken).toBeGreaterThan(oldToken);
      expect(newWidget.eq(oldWidget)).toBe(false);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Keymap — pure policy
// ---------------------------------------------------------------------------

const SUBMIT_CONFIG: TugEditKeymapConfig = {
  returnAction: "submit",
  numpadEnterAction: "submit",
  onSubmit: () => {},
  historyProvider: null,
};

const NEWLINE_CONFIG: TugEditKeymapConfig = {
  returnAction: "newline",
  numpadEnterAction: "newline",
  onSubmit: () => {},
  historyProvider: null,
};

describe("TugEdit — resolveEnterAction", () => {
  it("returns the configured returnAction for plain Enter", () => {
    expect(resolveEnterAction(SUBMIT_CONFIG, false, false)).toBe("submit");
    expect(resolveEnterAction(NEWLINE_CONFIG, false, false)).toBe("newline");
  });

  it("flips the action when Shift is held", () => {
    expect(resolveEnterAction(SUBMIT_CONFIG, false, true)).toBe("newline");
    expect(resolveEnterAction(NEWLINE_CONFIG, false, true)).toBe("submit");
  });

  it("uses numpadEnterAction when isNumpad is true", () => {
    const mixed: TugEditKeymapConfig = {
      ...SUBMIT_CONFIG,
      returnAction: "newline",
      numpadEnterAction: "submit",
    };
    expect(resolveEnterAction(mixed, false, false)).toBe("newline");
    expect(resolveEnterAction(mixed, true, false)).toBe("submit");
  });

  it("flips the numpad action under Shift", () => {
    const mixed: TugEditKeymapConfig = {
      ...SUBMIT_CONFIG,
      numpadEnterAction: "newline",
    };
    expect(resolveEnterAction(mixed, true, false)).toBe("newline");
    expect(resolveEnterAction(mixed, true, true)).toBe("submit");
  });
});

// ---------------------------------------------------------------------------
// Keymap — state capture and restore
// ---------------------------------------------------------------------------

describe("TugEdit — captureEditState / applyEditState", () => {
  it("captureEditState reflects text + atoms + selection from the live view", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abcd" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      // Doc is now "ab￼cd" (length 5), caret at 3.
      const captured = captureEditState(view);
      expect(captured.text).toBe(`ab${TUG_ATOM_CHAR}cd`);
      expect(captured.atoms).toHaveLength(1);
      expect(captured.atoms[0]).toEqual({
        position: 2,
        type: FILE_ATOM.type,
        label: FILE_ATOM.label,
        value: FILE_ATOM.value,
      });
      expect(captured.selection).toEqual({ start: 3, end: 3 });
    } finally {
      unmount();
    }
  });

  it("applyEditState replaces document, atoms, and selection in one transaction", () => {
    const { view, unmount } = mountAtomHarness();
    try {
      // Seed with some content the caller will replace.
      view.dispatch({ changes: { from: 0, insert: "stale" } });

      const target: TugTextEditingState = {
        text: `hello ${TUG_ATOM_CHAR} world`,
        atoms: [
          { position: 6, type: FILE_ATOM.type, label: FILE_ATOM.label, value: FILE_ATOM.value },
        ],
        selection: { start: 7, end: 7 },
      };
      applyEditState(view, target);

      expect(view.state.doc.toString()).toBe(target.text);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(6);
      expect(atoms[0]!.segment.type).toBe(FILE_ATOM.type);
      expect(atoms[0]!.segment.label).toBe(FILE_ATOM.label);
      expect(atoms[0]!.segment.value).toBe(FILE_ATOM.value);
      const sel = view.state.selection.main;
      expect(sel.from).toBe(7);
      expect(sel.to).toBe(7);
    } finally {
      unmount();
    }
  });

  it("captureEditState then applyEditState round-trips identically", () => {
    const { view, delegate, unmount } = mountAtomHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "xy" } });
      view.dispatch({ selection: { anchor: 2 } });
      delegate.insertAtom(FILE_ATOM);
      view.dispatch({ changes: { from: 3, insert: "zw" } });
      view.dispatch({ selection: { anchor: 1 } });
      const snapshot = captureEditState(view);

      // Mutate then restore.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "noise" } });
      applyEditState(view, snapshot);

      expect(view.state.doc.toString()).toBe(snapshot.text);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(2);
      const sel = view.state.selection.main;
      expect(sel.from).toBe(snapshot.selection!.start);
      expect(sel.to).toBe(snapshot.selection!.end);
    } finally {
      unmount();
    }
  });
});

