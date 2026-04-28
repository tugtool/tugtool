/**
 * TugEdit — Step 1 substrate bootstrap tests.
 *
 * Verifies that the CodeMirror 6-backed `TugEdit` component:
 *   1. Mounts and constructs an `EditorView` accessible via the
 *      imperative delegate.
 *   2. Renders the editor's DOM tree into the host wrapper.
 *   3. Disposes the `EditorView` cleanly on unmount, and a subsequent
 *      mount produces a fresh, distinct `EditorView` instance —
 *      validating the StrictMode-safe lifecycle pattern recorded
 *      in the `tug-edit.tsx` module docstring (plan [Q03]).
 *
 * Scope: structural mount/unmount only. Focus, selection, key events,
 * and editor input behavior are out of scope for the happy-dom
 * environment per the project's test-scoping rule (those are exercised
 * via the gallery card and `just app-test` in later spike steps).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "../../../__tests__/setup-rtl";

import React, { useRef, useLayoutEffect } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate } from "@/components/tugways/tug-edit";

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
