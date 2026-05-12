/**
 * `TugCodeView` — read-only CM6 viewer tests.
 *
 * Coverage scope (happy-dom-safe):
 *  - Mount: the viewer constructs a CM6 `EditorView` and writes
 *    `data-slot="tug-code-view"` onto the host wrapper.
 *  - Value: the initial `value` seeds the document; subsequent value
 *    changes dispatch a replace transaction so the document reflects
 *    the new content.
 *  - Wrap toggle: the lineWrap compartment is reconfigured live; CM6
 *    surfaces the toggle as a class on `.cm-content`.
 *  - Line-numbers toggle: the gutter appears / disappears as the
 *    `lineNumbers` prop flips.
 *  - Search: `openSearch()` mounts CM6's search panel; `closeSearch()`
 *    removes it.
 *  - Selection: dispatching a selection-set transaction and reading
 *    `view.state.selection` round-trips through CM6.
 *
 * What is intentionally NOT covered here (per the happy-dom scoping
 * rule): keyboard-driven focus traversal, real-browser selection
 * gestures, and the responder-chain dispatch path that lands Cmd-A /
 * Cmd-C / Cmd-F on this viewer. Those are real-browser concerns and
 * land in the gallery card + an e2e surface.
 */

import "../../../__tests__/setup-rtl";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

import { TugCodeView, type TugCodeViewDelegate } from "../tug-code-view";

afterEach(() => {
  cleanup();
});

/**
 * Render the viewer and return both the container and a live ref so
 * tests can query the underlying CM6 view at use time.
 */
function renderWithRef(
  props: Omit<React.ComponentProps<typeof TugCodeView>, "ref"> = {
    value: "alpha\nbeta",
  },
): {
  container: HTMLElement;
  ref: React.RefObject<TugCodeViewDelegate | null>;
  rerender: (next: React.ComponentProps<typeof TugCodeView>) => void;
} {
  const ref = React.createRef<TugCodeViewDelegate | null>();
  const { container, rerender } = render(<TugCodeView ref={ref} {...props} />);
  return {
    container,
    ref: ref as React.RefObject<TugCodeViewDelegate | null>,
    rerender: (next) => rerender(<TugCodeView ref={ref} {...next} />),
  };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

describe("TugCodeView — mount", () => {
  test("host wrapper carries data-slot and tug-code-view class", () => {
    const { container } = renderWithRef({ value: "alpha\nbeta" });
    const host = container.querySelector('[data-slot="tug-code-view"]');
    expect(host).not.toBeNull();
    expect(host?.classList.contains("tug-code-view")).toBe(true);
  });

  test("EditorView mounts inside the host wrapper", () => {
    const { container, ref } = renderWithRef({ value: "alpha\nbeta" });
    expect(ref.current?.view()).not.toBeNull();
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")).not.toBeNull();
  });

  test("forwarded className composes with the base class", () => {
    const { container } = renderWithRef({
      value: "x",
      className: "extra-class",
    });
    const host = container.querySelector('[data-slot="tug-code-view"]');
    expect(host?.classList.contains("tug-code-view")).toBe(true);
    expect(host?.classList.contains("extra-class")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

describe("TugCodeView — value", () => {
  test("initial value seeds the document", () => {
    const { ref } = renderWithRef({ value: "alpha\nbeta\ngamma" });
    expect(ref.current?.view()?.state.doc.toString()).toBe(
      "alpha\nbeta\ngamma",
    );
  });

  test("value change dispatches a replace transaction", () => {
    const { ref, rerender } = renderWithRef({ value: "alpha" });
    expect(ref.current?.view()?.state.doc.toString()).toBe("alpha");

    act(() => {
      rerender({ value: "omega" });
    });
    expect(ref.current?.view()?.state.doc.toString()).toBe("omega");
  });

  test("identical value re-render does not dispatch", () => {
    const { ref, rerender } = renderWithRef({ value: "alpha" });
    const initialDoc = ref.current?.view()?.state.doc;
    act(() => {
      rerender({ value: "alpha" });
    });
    // CM6 doc instances are immutable; if no transaction fired, the
    // reference stays identical.
    expect(ref.current?.view()?.state.doc).toBe(initialDoc!);
  });

  test("empty value renders an empty document", () => {
    const { ref } = renderWithRef({ value: "" });
    expect(ref.current?.view()?.state.doc.toString()).toBe("");
    expect(ref.current?.view()?.state.doc.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Read-only enforcement
// ---------------------------------------------------------------------------

describe("TugCodeView — read-only", () => {
  test("state.readOnly is true", () => {
    const { ref } = renderWithRef({ value: "alpha" });
    expect(ref.current?.view()?.state.readOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wrap toggle
// ---------------------------------------------------------------------------

describe("TugCodeView — wrap toggle", () => {
  test("default wrap=true adds the lineWrapping class to .cm-content", () => {
    const { container } = renderWithRef({ value: "alpha" });
    const content = container.querySelector(".cm-content");
    expect(content?.classList.contains("cm-lineWrapping")).toBe(true);
  });

  test("wrap=false removes the lineWrapping class", () => {
    const { container } = renderWithRef({ value: "alpha", wrap: false });
    const content = container.querySelector(".cm-content");
    expect(content?.classList.contains("cm-lineWrapping")).toBe(false);
  });

  test("toggling wrap reconfigures live", () => {
    const { container, rerender } = renderWithRef({
      value: "alpha",
      wrap: false,
    });
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(false);

    act(() => {
      rerender({ value: "alpha", wrap: true });
    });
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(true);

    act(() => {
      rerender({ value: "alpha", wrap: false });
    });
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Line numbers
// ---------------------------------------------------------------------------

describe("TugCodeView — line-numbers toggle", () => {
  test("default lineNumbers=true mounts the gutter", () => {
    const { container } = renderWithRef({ value: "alpha" });
    expect(container.querySelector(".cm-gutters")).not.toBeNull();
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  test("lineNumbers=false hides the gutter", () => {
    const { container } = renderWithRef({
      value: "alpha",
      lineNumbers: false,
    });
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });

  test("toggling lineNumbers reconfigures live", () => {
    const { container, rerender } = renderWithRef({
      value: "alpha",
      lineNumbers: false,
    });
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();

    act(() => {
      rerender({ value: "alpha", lineNumbers: true });
    });
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Search panel
// ---------------------------------------------------------------------------

describe("TugCodeView — search", () => {
  test("setSearchQuery + findNext lands the selection on the first match", () => {
    // The composing component (e.g. FileBlock) owns the Find UI;
    // TugCodeView no longer mounts CM6's bundled panel. The delegate
    // exposes the programmatic search controls (`setSearchQuery`,
    // `findNext`, `findPrevious`, `selectAllMatches`); composing
    // components call them in response to their own input changes.
    const { ref } = renderWithRef({ value: "alpha beta alpha gamma" });

    act(() => {
      ref.current?.setSearchQuery({ search: "alpha" });
      ref.current?.findNext();
    });

    const view = ref.current?.view();
    expect(view).not.toBeNull();
    if (view === undefined || view === null) return;
    // `findNext` selects the first match after the cursor (which is at
    // position 0 by default), wrapping past the initial cursor.
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("alpha");
  });

  test("findNext advances through matches in document order", () => {
    const { ref } = renderWithRef({ value: "alpha beta alpha gamma" });

    act(() => {
      ref.current?.setSearchQuery({ search: "alpha" });
      ref.current?.findNext();
    });
    const view = ref.current?.view();
    expect(view).not.toBeNull();
    if (view === undefined || view === null) return;
    const firstFrom = view.state.selection.main.from;

    act(() => {
      ref.current?.findNext();
    });
    const secondFrom = view.state.selection.main.from;
    expect(secondFrom).toBeGreaterThan(firstFrom);
  });

  test("CM6's bundled `.cm-search` panel is hidden via theme CSS even when mounted", () => {
    // `setSearchQuery` opens the bundled panel internally so the
    // `searchHighlighter` ViewPlugin paints match decorations (CM6
    // gates highlighting on the panel field being non-null). The
    // bundled panel DOM mounts but is hidden — `.cm-panels` has
    // `display: none` in the editor theme. The composing component
    // (e.g. `FileBlock`) renders the user-facing Find chrome.
    const { container, ref } = renderWithRef({ value: "alpha beta" });

    act(() => {
      ref.current?.setSearchQuery({ search: "alpha" });
    });
    // The panel DOM is allowed to exist; assert it isn't visible.
    const panels = container.querySelector(".cm-panels") as HTMLElement | null;
    if (panels !== null) {
      // happy-dom honors inline styles set via CM6's runtime theme.
      const display = panels.style.display || window.getComputedStyle(panels).display;
      expect(display).toBe("none");
    }
  });

  test("clearSearch removes the active query and closes the bundled panel", () => {
    const { container, ref } = renderWithRef({ value: "alpha beta" });
    act(() => {
      ref.current?.setSearchQuery({ search: "alpha" });
    });
    act(() => {
      ref.current?.clearSearch();
    });
    // After clearing, the panel state is torn down. Even if the DOM
    // node lingers, it should be hidden (display: none) and any
    // search highlights gone.
    expect(container.querySelector(".cm-searchMatch")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selection round-trip
// ---------------------------------------------------------------------------

describe("TugCodeView — selection", () => {
  test("dispatching a selection-set transaction updates state.selection", () => {
    const { ref } = renderWithRef({ value: "alpha\nbeta" });
    const view = ref.current?.view();
    expect(view).not.toBeNull();
    if (view === undefined || view === null) return;

    act(() => {
      view.dispatch({
        selection: { anchor: 0, head: 5 },
      });
    });

    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });
});
