/**
 * tug-text-editor/drop-extension — file-drop atom insertion + drop caret.
 *
 * Coverage:
 *   1. Pure helpers (`insertAtomsAt`, `dropOffsetAtCoords`) — drive
 *      directly without synthetic `DragEvent`s. Full assertion
 *      surface for the "transaction shape and selection placement"
 *      contract.
 *   2. DOM event integration — happy-dom doesn't expose
 *      `DataTransfer` / `DragEvent` constructors, so the tests
 *      synthesize a plain `Event` and attach a mocked
 *      `dataTransfer` shaped after the surface the extension reads
 *      (`types`, `files`, `dropEffect`). `clientX` / `clientY` are
 *      attached too. This bypasses constructor differences while
 *      still exercising the production handler.
 *
 * What's not covered here: the visual drop caret. happy-dom doesn't
 * run a layout pipeline, so `view.coordsAtPos` returns viewport-
 * less rectangles and `view.posAtCoords` always returns `null`. The
 * caret element creation / removal lifecycle IS exercisable (it
 * gates on the StateField, not on layout); pixel-perfect positioning
 * is reserved for the manual gallery walk-through.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL
 * test files; pulls in the canvas shim used by atom-rendering paths).
 */
import "../../../__tests__/setup-rtl";

import React, { useLayoutEffect, useRef } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";

import { TugTextEditor } from "@/components/tugways/tug-text-editor";
import type { TugTextEditorDelegate } from "@/components/tugways/tug-text-editor";
import { getAtomsInState } from "@/components/tugways/tug-text-editor/atom-decoration";
import {
  dropOffsetAtCoords,
  insertAtomsAt,
} from "@/components/tugways/tug-text-editor/drop-extension";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";

// ---------------------------------------------------------------------------
// Canvas 2D shim — atom rendering measures glyph widths via a 2D
// context; happy-dom doesn't implement one. Mirrors `tug-text-editor.test.tsx`.
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

function mountHarness(props?: {
  dropHandler?: (files: FileList) => AtomSegment[];
}): {
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
      dropHandler: props?.dropHandler,
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

const FILE_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "main.ts",
  value: "main.ts",
};

const IMAGE_ATOM: AtomSegment = {
  kind: "atom",
  type: "image",
  label: "shot.png",
  value: "shot.png",
};

// ---------------------------------------------------------------------------
// Synthetic drag-event helpers
// ---------------------------------------------------------------------------

/**
 * Mocked `DataTransfer` shaped after the surface the drop extension
 * reads. happy-dom doesn't expose `DataTransfer` on `globalThis`, so
 * we hand-roll one. The extension reads only:
 *   - `types` (`Array.includes("Files")`)
 *   - `files` (`FileList`-like with `length` + index access)
 *   - `dropEffect` (settable; ignore failures via try/catch in
 *     production code)
 */
interface MockDataTransfer {
  types: readonly string[];
  files: FileList;
  dropEffect: string;
}

/**
 * Build a `FileList`-like out of a plain array. `FileList` is
 * declared on happy-dom but its constructor isn't reachable; this
 * tagged duck-typed shape passes the structural checks the
 * extension performs.
 */
function makeFileList(files: File[]): FileList {
  const list = files as unknown as FileList & { length: number; item: (i: number) => File | null };
  list.length = files.length;
  list.item = (i: number): File | null => files[i] ?? null;
  return list;
}

/**
 * Synthesize a drag-shape Event of the given type, attaching
 * `dataTransfer`, `clientX`, and `clientY` so the extension's
 * handlers see what they need. Dispatched on a target via
 * `target.dispatchEvent`.
 */
function makeDragEvent(
  type: string,
  opts: {
    files?: File[];
    types?: readonly string[];
    clientX?: number;
    clientY?: number;
    relatedTarget?: EventTarget | null;
  } = {},
): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  const fileList = makeFileList(opts.files ?? []);
  const types = opts.types ?? (fileList.length > 0 ? ["Files"] : []);
  const dataTransfer: MockDataTransfer = {
    types,
    files: fileList,
    dropEffect: "none",
  };
  // Plain property assignment so happy-dom's enumerable lookup
  // finds the property; `defineProperty` with default descriptor
  // sets `enumerable: false`, which some property lookups skip.
  // The cast bypasses TS's strict Event typing — at runtime the
  // shape is what the extension reads.
  (evt as unknown as { dataTransfer: MockDataTransfer }).dataTransfer = dataTransfer;
  (evt as unknown as { clientX: number }).clientX = opts.clientX ?? 0;
  (evt as unknown as { clientY: number }).clientY = opts.clientY ?? 0;
  (evt as unknown as { relatedTarget: EventTarget | null }).relatedTarget =
    opts.relatedTarget ?? null;
  return evt;
}

// ---------------------------------------------------------------------------
// Pure-helper tests
// ---------------------------------------------------------------------------

describe("insertAtomsAt", () => {
  it("inserts a single atom at the requested position in one transaction", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abcd" } });
      view.dispatch({ selection: { anchor: 0 } });

      insertAtomsAt(view, 2, [FILE_ATOM]);

      expect(view.state.doc.toString()).toBe(`ab${TUG_ATOM_CHAR}cd`);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.position).toBe(2);
      expect(atoms[0]!.segment).toEqual(FILE_ATOM);
      // Selection lands immediately after the inserted atom.
      expect(view.state.selection.main.head).toBe(3);
    } finally {
      unmount();
    }
  });

  it("inserts multiple atoms at consecutive positions in one transaction", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "xy" } });
      view.dispatch({ selection: { anchor: 0 } });

      insertAtomsAt(view, 1, [FILE_ATOM, IMAGE_ATOM]);

      expect(view.state.doc.toString()).toBe(
        `x${TUG_ATOM_CHAR}${TUG_ATOM_CHAR}y`,
      );
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(2);
      expect(atoms[0]!.position).toBe(1);
      expect(atoms[0]!.segment).toEqual(FILE_ATOM);
      expect(atoms[1]!.position).toBe(2);
      expect(atoms[1]!.segment).toEqual(IMAGE_ATOM);
      expect(view.state.selection.main.head).toBe(3);
    } finally {
      unmount();
    }
  });

  it("is a no-op for an empty atom list", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abc" } });
      view.dispatch({ selection: { anchor: 1 } });
      const docBefore = view.state.doc.toString();
      const headBefore = view.state.selection.main.head;

      insertAtomsAt(view, 1, []);

      expect(view.state.doc.toString()).toBe(docBefore);
      expect(view.state.selection.main.head).toBe(headBefore);
    } finally {
      unmount();
    }
  });
});

describe("dropOffsetAtCoords", () => {
  it("returns null when the resolver can't anchor the bias-adjusted point", () => {
    // happy-dom doesn't run layout, so `view.posAtCoords` returns
    // `null` for any non-trivial coordinate. This exercises the
    // fall-through path the drop handler uses (insert at end of
    // doc) without depending on the bias math.
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "hello" } });
      const out = dropOffsetAtCoords(view, 0, 0);
      expect(out).toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DragEvent integration
// ---------------------------------------------------------------------------

describe("drop event handling", () => {
  it("a `drop` event with files inserts atoms at end-of-doc when posAtCoords returns null", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "abc" } });

      const file = new File(["x"], "dropped.ts", { type: "text/plain" });
      const evt = makeDragEvent("drop", {
        files: [file],
        clientX: 10,
        clientY: 10,
      });
      view.contentDOM.dispatchEvent(evt);

      // Atom landed at end of doc (position 3 after "abc").
      expect(view.state.doc.toString()).toBe(`abc${TUG_ATOM_CHAR}`);
      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.segment.label).toBe("dropped.ts");
      expect(atoms[0]!.segment.type).toBe("file");
      // Selection lands after the inserted atom.
      expect(view.state.selection.main.head).toBe(4);
    } finally {
      unmount();
    }
  });

  it("a `drop` event without files leaves the document unchanged", () => {
    const { view, unmount } = mountHarness();
    try {
      view.dispatch({ changes: { from: 0, insert: "hello" } });
      const docBefore = view.state.doc.toString();

      const evt = makeDragEvent("drop", { files: [] });
      view.contentDOM.dispatchEvent(evt);

      expect(view.state.doc.toString()).toBe(docBefore);
      expect(getAtomsInState(view.state)).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it("calls `event.preventDefault()` on a file drop so the WebView doesn't navigate", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("drop", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    } finally {
      unmount();
    }
  });

  it("calls `preventDefault()` on a `dragover` carrying files", () => {
    // Without the dragover preventDefault, the OS refuses the drag
    // and no `drop` event ever fires. The handler must claim the
    // event so the drop pipeline runs at all.
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("dragover", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    } finally {
      unmount();
    }
  });

  it("calls `preventDefault()` on a `dragenter` carrying files", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("dragenter", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    } finally {
      unmount();
    }
  });

  it("ignores a `dragover` whose dataTransfer doesn't carry files", () => {
    const { view, unmount } = mountHarness();
    try {
      // A keyboard-driven drag or in-app drag doesn't include
      // "Files" in `dataTransfer.types`. Without files, the editor
      // shouldn't claim the event — other handlers up the chain
      // may want it.
      const evt = makeDragEvent("dragover", { types: ["text/plain"] });
      view.contentDOM.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    } finally {
      unmount();
    }
  });

  it("uses the host-supplied dropHandler when one is provided", () => {
    const customAtom: AtomSegment = {
      kind: "atom",
      type: "doc",
      label: "from-handler.md",
      value: "/abs/path/from-handler.md",
    };
    const handler = (_files: FileList): AtomSegment[] => [customAtom];

    const { view, unmount } = mountHarness({ dropHandler: handler });
    try {
      const file = new File(["x"], "ignored.txt", { type: "text/plain" });
      const evt = makeDragEvent("drop", { files: [file] });
      view.contentDOM.dispatchEvent(evt);

      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.segment).toEqual(customAtom);
    } finally {
      unmount();
    }
  });

  it("classifies image extensions via the default mapping (case-insensitive)", () => {
    const { view, unmount } = mountHarness();
    try {
      const png = new File(["x"], "screenshot.PNG", { type: "image/png" });
      const evt = makeDragEvent("drop", { files: [png] });
      view.contentDOM.dispatchEvent(evt);

      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.segment.type).toBe("image");
      expect(atoms[0]!.segment.label).toBe("screenshot.PNG");
    } finally {
      unmount();
    }
  });

  it("classifies non-image extensions as `file` via the default mapping", () => {
    const { view, unmount } = mountHarness();
    try {
      const md = new File(["x"], "notes.md", { type: "text/markdown" });
      const evt = makeDragEvent("drop", { files: [md] });
      view.contentDOM.dispatchEvent(evt);

      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(1);
      expect(atoms[0]!.segment.type).toBe("file");
      expect(atoms[0]!.segment.label).toBe("notes.md");
    } finally {
      unmount();
    }
  });

  it("inserts every file from a multi-file drop in document order", () => {
    const { view, unmount } = mountHarness();
    try {
      const a = new File(["a"], "a.png", { type: "image/png" });
      const b = new File(["b"], "b.txt", { type: "text/plain" });
      const c = new File(["c"], "c.svg", { type: "image/svg+xml" });
      const evt = makeDragEvent("drop", { files: [a, b, c] });
      view.contentDOM.dispatchEvent(evt);

      const atoms = getAtomsInState(view.state);
      expect(atoms).toHaveLength(3);
      expect(atoms[0]!.segment.label).toBe("a.png");
      expect(atoms[0]!.segment.type).toBe("image");
      expect(atoms[1]!.segment.label).toBe("b.txt");
      expect(atoms[1]!.segment.type).toBe("file");
      expect(atoms[2]!.segment.label).toBe("c.svg");
      expect(atoms[2]!.segment.type).toBe("image");
      // Selection lands after the last inserted atom.
      expect(view.state.selection.main.head).toBe(3);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Drop-caret lifecycle
// ---------------------------------------------------------------------------

describe("drop-caret lifecycle", () => {
  /**
   * Find the drop-caret indicator element inside the view. The
   * element is created lazily on first non-null position, so a
   * `null` return means "no caret currently rendered" — distinct
   * from "caret rendered but off-screen", which the painter uses
   * for unresolvable positions.
   */
  function findCaret(view: EditorView): HTMLElement | null {
    return view.scrollDOM.querySelector(".cm-tug-drop-caret");
  }

  it("does not render a caret before any drag starts", () => {
    const { view, unmount } = mountHarness();
    try {
      expect(findCaret(view)).toBeNull();
    } finally {
      unmount();
    }
  });

  it("removes the caret after `drop` clears the StateField", () => {
    const { view, unmount } = mountHarness();
    try {
      // Even a `dragover` over an empty editor with no resolvable
      // position dispatches an effect setting the field to `null`
      // (via the `view.state.field(...) !== pos` check in the
      // handler). Drop fires drop-caret cleanup as part of the
      // insertion transaction. After the drop the caret should
      // be gone regardless of intermediate state.
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("drop", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      expect(findCaret(view)).toBeNull();
    } finally {
      unmount();
    }
  });

  it("removes the caret after `dragleave` truly exits the editor", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      // dragover with non-null dataTransfer types — happy-dom
      // posAtCoords returns null so the field stays null, but
      // the dispatch path runs.
      const over = makeDragEvent("dragover", { files: [file] });
      view.contentDOM.dispatchEvent(over);

      // dragleave with relatedTarget OUTSIDE the editor → caret
      // (if any) is removed. relatedTarget = null counts as "left
      // the page entirely", which the handler treats as a leave.
      const leave = makeDragEvent("dragleave", {
        files: [file],
        relatedTarget: null,
      });
      view.contentDOM.dispatchEvent(leave);
      expect(findCaret(view)).toBeNull();
    } finally {
      unmount();
    }
  });

  it("`dragleave` to a relatedTarget INSIDE the editor does not hide the caret", () => {
    // The handler's contract: only hide on a true exit. If the
    // dragleave is the OS dispatching during element-to-element
    // crossing inside the editor, the caret must stay. happy-dom
    // doesn't render the caret element (no positions resolve), so
    // we assert the StateField path indirectly: the handler returns
    // false and doesn't preventDefault, which is the documented
    // pass-through shape.
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      // relatedTarget is the contentDOM itself — inside the editor.
      const leave = makeDragEvent("dragleave", {
        files: [file],
        relatedTarget: view.contentDOM,
      });
      view.contentDOM.dispatchEvent(leave);
      expect(leave.defaultPrevented).toBe(false);
    } finally {
      unmount();
    }
  });

  it("removes the caret after `dragend`", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const over = makeDragEvent("dragover", { files: [file] });
      view.contentDOM.dispatchEvent(over);

      const end = makeDragEvent("dragend", { files: [file] });
      view.contentDOM.dispatchEvent(end);
      expect(findCaret(view)).toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// data-drop-active attribute lifecycle
// ---------------------------------------------------------------------------

describe("data-drop-active attribute", () => {
  /** Find the `tug-text-editor` host wrapper that the drop extension toggles. */
  function findHost(view: EditorView): HTMLElement | null {
    let el: HTMLElement | null = view.dom.parentElement;
    while (el !== null) {
      if (el.getAttribute("data-slot") === "tug-text-editor") return el;
      el = el.parentElement;
    }
    return null;
  }

  it("does not set data-drop-active before any drag starts", () => {
    const { view, unmount } = mountHarness();
    try {
      const host = findHost(view);
      expect(host).not.toBeNull();
      expect(host!.hasAttribute("data-drop-active")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("sets data-drop-active on dragenter with files", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("dragenter", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("sets data-drop-active on dragover with files", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      const evt = makeDragEvent("dragover", { files: [file] });
      view.contentDOM.dispatchEvent(evt);
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("does NOT set data-drop-active on a non-file drag", () => {
    const { view, unmount } = mountHarness();
    try {
      const evt = makeDragEvent("dragover", { types: ["text/plain"] });
      view.contentDOM.dispatchEvent(evt);
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("clears data-drop-active after `drop`", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      // Engage drag.
      view.contentDOM.dispatchEvent(makeDragEvent("dragenter", { files: [file] }));
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
      // Drop.
      view.contentDOM.dispatchEvent(makeDragEvent("drop", { files: [file] }));
      expect(host.hasAttribute("data-drop-active")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("clears data-drop-active after `dragleave` truly exits the editor", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      view.contentDOM.dispatchEvent(makeDragEvent("dragenter", { files: [file] }));
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
      view.contentDOM.dispatchEvent(
        makeDragEvent("dragleave", { files: [file], relatedTarget: null }),
      );
      expect(host.hasAttribute("data-drop-active")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("keeps data-drop-active on a dragleave to a relatedTarget INSIDE the editor", () => {
    // The handler's contract: only clear on a true exit. If the
    // dragleave is the OS dispatching during element-to-element
    // crossing inside the editor, the drop ring must stay.
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      view.contentDOM.dispatchEvent(makeDragEvent("dragenter", { files: [file] }));
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
      view.contentDOM.dispatchEvent(
        makeDragEvent("dragleave", {
          files: [file],
          relatedTarget: view.contentDOM,
        }),
      );
      expect(host.hasAttribute("data-drop-active")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("clears data-drop-active after `dragend`", () => {
    const { view, unmount } = mountHarness();
    try {
      const file = new File(["x"], "x.png", { type: "image/png" });
      view.contentDOM.dispatchEvent(makeDragEvent("dragenter", { files: [file] }));
      const host = findHost(view)!;
      expect(host.hasAttribute("data-drop-active")).toBe(true);
      view.contentDOM.dispatchEvent(makeDragEvent("dragend", { files: [file] }));
      expect(host.hasAttribute("data-drop-active")).toBe(false);
    } finally {
      unmount();
    }
  });
});
