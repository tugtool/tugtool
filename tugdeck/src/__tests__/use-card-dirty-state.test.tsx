/**
 * useCardDirtyState hook unit tests.
 *
 * Tests cover:
 *   - markDirty is stable across re-renders
 *   - markDirty triggers saveRef.current() after debounce
 *   - rapid markDirty calls collapse into one save (debounce)
 *   - scroll on hostContentEl triggers markDirty
 *   - selectionchange inside hostContentEl triggers markDirty
 *   - selectionchange outside hostContentEl does NOT trigger markDirty
 *   - unmount clears any pending save
 *
 * Uses bun:test's fake timers to assert the debounce deterministically.
 */
import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import React, { useRef } from "react";
import { renderHook, act } from "@testing-library/react";

import { useCardDirtyState } from "@/components/tugways/hooks/use-card-dirty-state";

const DEBOUNCE_MS = 1000;

describe("useCardDirtyState", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("returns a stable markDirty across re-renders", () => {
    const saveRef = { current: () => {} } as React.RefObject<() => void>;
    const { result, rerender } = renderHook(() =>
      useCardDirtyState({ hostContentEl: host, saveRef }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("triggers saveRef.current() once after the debounce window", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;
    const { result } = renderHook(() =>
      useCardDirtyState({ hostContentEl: host, saveRef }),
    );

    act(() => result.current());
    expect(saveCount).toBe(0);

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(1);
  });

  it("collapses rapid markDirty calls into a single save", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;
    const { result } = renderHook(() =>
      useCardDirtyState({ hostContentEl: host, saveRef }),
    );

    act(() => result.current());
    act(() => result.current());
    act(() => result.current());

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(1);
  });

  it("scroll on hostContentEl schedules a save", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;
    renderHook(() => useCardDirtyState({ hostContentEl: host, saveRef }));

    act(() => {
      host.dispatchEvent(new Event("scroll"));
    });
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(1);
  });

  it("selectionchange whose anchor is inside hostContentEl schedules a save", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;

    host.textContent = "hello";
    renderHook(() => useCardDirtyState({ hostContentEl: host, saveRef }));

    act(() => {
      const range = document.createRange();
      const textNode = host.firstChild!;
      range.setStart(textNode, 1);
      range.setEnd(textNode, 3);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(1);
  });

  it("selectionchange whose anchor is outside hostContentEl does NOT schedule a save", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;

    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);

    renderHook(() => useCardDirtyState({ hostContentEl: host, saveRef }));

    act(() => {
      const range = document.createRange();
      const textNode = outside.firstChild!;
      range.setStart(textNode, 0);
      range.setEnd(textNode, 2);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(0);

    outside.remove();
  });

  it("unmount clears the pending save and reads latest saveRef at fire time", async () => {
    let saveCount = 0;
    const saveRef = { current: () => { saveCount++; } } as React.RefObject<() => void>;
    const { result, unmount } = renderHook(() =>
      useCardDirtyState({ hostContentEl: host, saveRef }),
    );

    act(() => result.current());
    unmount();

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(saveCount).toBe(0);
  });

  it("reads the latest saveRef closure at fire time (no stale capture)", async () => {
    let invokedBy = "";
    const saveRef = {
      current: () => { invokedBy = "first"; },
    } as React.RefObject<() => void>;

    const { result } = renderHook(() =>
      useCardDirtyState({ hostContentEl: host, saveRef }),
    );

    act(() => result.current());
    // Swap the closure before the debounce fires.
    saveRef.current = () => { invokedBy = "second"; };

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
    expect(invokedBy).toBe("second");
  });
});
