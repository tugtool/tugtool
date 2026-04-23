/**
 * TugTextEngine.onSelectionChanged publish API tests.
 *
 * Pins the contract documented on `TugTextInputDelegate.onSelectionChanged`:
 *
 *   - Subscribers receive a cloned `Range` when the engine's selection
 *     moves via `setSelectedRange` or `restoreState`.
 *   - Subscribers receive `null` after `clear()` or after a `restoreState`
 *     whose `state.selection` is null.
 *   - A document-level `selectionchange` whose anchor lands inside the
 *     engine's root fires the subscriber exactly once with the new range.
 *   - `selectionchange` whose anchor lands outside the engine's root is
 *     ignored (no emission) unless the previous emit carried a range
 *     (transition-out case → emit `null` once).
 *   - Unsubscribe stops further fires.
 *   - `teardown()` drops subscribers.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TugTextEngine } from "@/lib/tug-text-engine";

function makeEngine(): {
  engine: TugTextEngine;
  root: HTMLDivElement;
  dispose: () => void;
} {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  const engine = new TugTextEngine(root);
  return {
    engine,
    root,
    dispose: () => {
      engine.teardown();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

function setSelectionIn(root: HTMLDivElement, start: number, end: number): void {
  const textNode = root.firstChild as Text | null;
  if (!textNode) throw new Error("root has no text node");
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe("TugTextEngine.onSelectionChanged", () => {
  let ctx!: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    ctx = makeEngine();
    ctx.root.textContent = "hello world";
  });

  afterEach(() => {
    ctx.dispose();
  });

  it("setSelectedRange fires the subscriber with a Range matching the flat offsets", () => {
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.setSelectedRange(1, 4);

    expect(emissions.length).toBe(1);
    const range = emissions[0];
    expect(range).not.toBeNull();
    expect(range!.startOffset).toBe(1);
    expect(range!.endOffset).toBe(4);
  });

  it("restoreState with a selection fires exactly once with the restored range", () => {
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.restoreState({
      text: "abcdef",
      atoms: [],
      selection: { start: 2, end: 5 },
    });

    expect(emissions.length).toBe(1);
    expect(emissions[0]).not.toBeNull();
    expect(emissions[0]!.startOffset).toBe(2);
    expect(emissions[0]!.endOffset).toBe(5);
  });

  it("restoreState with a null selection fires once with null", () => {
    setSelectionIn(ctx.root, 0, 4);
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.restoreState({
      text: "abcdef",
      atoms: [],
      selection: null,
    });

    expect(emissions.length).toBe(1);
    expect(emissions[0]).toBeNull();
  });

  it("clear fires the subscriber with null", () => {
    setSelectionIn(ctx.root, 0, 5);
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.clear();

    expect(emissions.length).toBe(1);
    expect(emissions[0]).toBeNull();
  });

  it("unsubscribe stops further emissions", () => {
    const emissions: (Range | null)[] = [];
    const unsub = ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.setSelectedRange(1, 3);
    unsub();
    ctx.engine.setSelectedRange(4, 6);

    expect(emissions.length).toBe(1);
  });

  it("a document selectionchange whose anchor is inside the root emits once with the new range", () => {
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    // Simulate a user-driven selection via manual range + selectionchange.
    setSelectionIn(ctx.root, 2, 5);
    document.dispatchEvent(new Event("selectionchange"));

    expect(emissions.length).toBe(1);
    expect(emissions[0]).not.toBeNull();
    expect(emissions[0]!.startOffset).toBe(2);
    expect(emissions[0]!.endOffset).toBe(5);
  });

  it("a selectionchange whose anchor is outside the root is ignored", () => {
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    try {
      const emissions: (Range | null)[] = [];
      ctx.engine.onSelectionChanged((r) => emissions.push(r));

      const range = document.createRange();
      range.setStart(outside.firstChild!, 1);
      range.setEnd(outside.firstChild!, 4);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));

      expect(emissions.length).toBe(0);
    } finally {
      document.body.removeChild(outside);
    }
  });

  it("transition from inside → outside the root does not emit (cardRange persists)", () => {
    // When the user moves the selection out of the engine's root —
    // e.g. by clicking a different card — the engine deliberately
    // does NOT publish `null`. Subscribers (selection-guard) want to
    // remember the last in-root Range so the guard can paint it dim
    // while the card is backgrounded and restore it on return. The
    // engine only emits `null` for programmatic clears (clear(),
    // restoreState({selection: null})); focus-out alone is silent.
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    try {
      const emissions: (Range | null)[] = [];
      ctx.engine.onSelectionChanged((r) => emissions.push(r));

      // Selection inside root — emit.
      setSelectionIn(ctx.root, 1, 3);
      document.dispatchEvent(new Event("selectionchange"));
      expect(emissions.length).toBe(1);
      expect(emissions[0]).not.toBeNull();

      // User clicks outside → selection moves out of the root.
      // No emission — the in-root range stays "last known" for
      // subscribers until the user returns or the engine is cleared.
      const range = document.createRange();
      range.setStart(outside.firstChild!, 1);
      range.setEnd(outside.firstChild!, 4);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));

      expect(emissions.length).toBe(1);
    } finally {
      document.body.removeChild(outside);
    }
  });

  it("teardown drops subscribers and stops further emissions", () => {
    const emissions: (Range | null)[] = [];
    ctx.engine.onSelectionChanged((r) => emissions.push(r));

    ctx.engine.setSelectedRange(0, 3);
    expect(emissions.length).toBe(1);

    ctx.engine.teardown();

    // A subsequent setSelectedRange is a no-op once the engine is torn
    // down (the root may still exist), but any emission from lingering
    // handlers should not reach the now-cleared subscriber set.
    ctx.engine.setSelectedRange(0, 4);
    document.dispatchEvent(new Event("selectionchange"));

    expect(emissions.length).toBe(1);
  });

  it("multiple subscribers all fire; unsubscribing one leaves the other intact", () => {
    const a: (Range | null)[] = [];
    const b: (Range | null)[] = [];
    const unsubA = ctx.engine.onSelectionChanged((r) => a.push(r));
    ctx.engine.onSelectionChanged((r) => b.push(r));

    ctx.engine.setSelectedRange(0, 3);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);

    unsubA();
    ctx.engine.setSelectedRange(1, 4);

    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// setSelectedRange focus-before-selection contract.
//
// WebKit collapses a programmatically-set selection when `.focus()` is
// called on a contentEditable *after* the selection has been applied:
// the focus-establishment path fires an async `selectionchange` that
// resets the caret to position 0 and clobbers the saved range. The
// engine sidesteps the quirk by focusing the root BEFORE calling
// `sel.addRange`. These tests pin that ordering.
// ---------------------------------------------------------------------------

describe("TugTextEngine.setSelectedRange focuses root before setting selection", () => {
  let ctx!: ReturnType<typeof makeEngine>;
  let otherInput!: HTMLInputElement;

  beforeEach(() => {
    ctx = makeEngine();
    ctx.root.textContent = "hello world";
    // Provide a plausible alternative focus target so we can assert
    // focus is moved onto the engine root when it starts elsewhere.
    otherInput = document.createElement("input");
    otherInput.type = "text";
    document.body.appendChild(otherInput);
  });

  afterEach(() => {
    ctx.dispose();
    otherInput.remove();
  });

  it("focuses the root when focus is elsewhere at call time", () => {
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    ctx.engine.setSelectedRange(2, 5);

    expect(document.activeElement).toBe(ctx.root);
  });

  it("does not move focus when the root is already focused", () => {
    ctx.root.focus();
    expect(document.activeElement).toBe(ctx.root);

    ctx.engine.setSelectedRange(0, 3);

    expect(document.activeElement).toBe(ctx.root);
  });

  it("does not yank focus when an element inside the root is the active element (IME / nested widgets)", () => {
    // Simulate a nested focusable inside the engine root. Focusing it
    // models the IME / composition case the guard is there to allow.
    const nested = document.createElement("input");
    nested.type = "text";
    ctx.root.appendChild(nested);
    nested.focus();
    expect(document.activeElement).toBe(nested);

    ctx.engine.setSelectedRange(0, 3);

    // Focus stays on the nested element — the engine doesn't steal it.
    expect(document.activeElement).toBe(nested);
  });

  it("after the call the native selection matches the requested offsets", () => {
    otherInput.focus();
    ctx.engine.setSelectedRange(2, 5);

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    if (!sel) return;
    expect(sel.rangeCount).toBe(1);
    expect(sel.anchorOffset).toBe(2);
    expect(sel.focusOffset).toBe(5);
  });
});
