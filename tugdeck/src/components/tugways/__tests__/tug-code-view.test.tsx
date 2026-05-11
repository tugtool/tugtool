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

describe("TugCodeView — search panel", () => {
  test("openSearch() mounts the search panel; closeSearch() removes it", () => {
    const { container, ref } = renderWithRef({ value: "alpha beta gamma" });

    expect(container.querySelector(".cm-search")).toBeNull();

    act(() => {
      ref.current?.openSearch();
    });
    expect(container.querySelector(".cm-search")).not.toBeNull();

    act(() => {
      ref.current?.closeSearch();
    });
    expect(container.querySelector(".cm-search")).toBeNull();
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
