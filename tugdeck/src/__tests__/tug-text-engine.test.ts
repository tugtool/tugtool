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

  it("transition from inside → outside the root emits null exactly once", () => {
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    try {
      const emissions: (Range | null)[] = [];
      ctx.engine.onSelectionChanged((r) => emissions.push(r));

      // First: selection lands inside the root → emit range.
      setSelectionIn(ctx.root, 1, 3);
      document.dispatchEvent(new Event("selectionchange"));

      // Then: user clicks outside → emit null once (transition-out).
      const range = document.createRange();
      range.setStart(outside.firstChild!, 1);
      range.setEnd(outside.firstChild!, 4);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));

      // A second outside-change does not emit again (already null).
      const range2 = document.createRange();
      range2.setStart(outside.firstChild!, 0);
      range2.setEnd(outside.firstChild!, 2);
      sel?.removeAllRanges();
      sel?.addRange(range2);
      document.dispatchEvent(new Event("selectionchange"));

      expect(emissions.length).toBe(2);
      expect(emissions[0]).not.toBeNull();
      expect(emissions[1]).toBeNull();
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
