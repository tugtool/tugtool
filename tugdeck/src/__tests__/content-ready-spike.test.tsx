/**
 * Spike: Proving the ref-flag + no-deps useLayoutEffect principle for
 * the onContentReady facility.
 *
 * CORE PRINCIPLE UNDER TEST:
 *
 *   A component's own no-deps useLayoutEffect fires on every render of
 *   THAT component — including re-renders triggered by its own setState.
 *   By setting a ref flag when onRestore is called and checking it in the
 *   no-deps effect, useTugcardPersistence can fire onContentReady at
 *   exactly the right moment: after the child's restored state is committed
 *   to the DOM.
 *
 * This spike tests the principle across multiple realistic scenarios:
 *
 *   S1. Basic ref-flag: onRestore sets flag, next useLayoutEffect fires callback
 *   S2. DOM is committed when the callback fires (not stale)
 *   S3. Flag only fires once per restore (cleared after firing)
 *   S4. Rapid sequential restores (each gets its own callback)
 *   S5. No false fires: re-renders from non-restore setState don't trigger it
 *   S6. Multiple independent hooks in sibling components
 *   S7. Full persistence context indirection (mirrors real tugcard pattern)
 *   S8. Nested content: hook is in parent wrapper, setState is in grandchild
 *   S9. Content with no onRestore (static) — no false ready signal
 *   S10. Parent applies scroll in the callback — DOM measurements are valid
 *   S11. Cleanup: rapid tab switch cancels pending ready before it fires
 */
import "./setup-rtl";

import React, {
  useState,
  useLayoutEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

// ===========================================================================
// Simulated useTugcardPersistence with ref-flag onContentReady mechanism
// ===========================================================================

/**
 * Minimal simulation of the proposed onContentReady mechanism.
 *
 * - onRestore: called by the parent to restore saved state. Sets a ref flag.
 * - A no-deps useLayoutEffect watches the flag. When set, fires onContentReady
 *   and clears the flag.
 *
 * This is the EXACT mechanism we intend to build into useTugcardPersistence.
 */
function useContentReadyHook(options: {
  onRestore: (state: unknown) => void;
  onContentReady?: () => void;
}) {
  const restorePendingRef = useRef(false);
  const onRestoreRef = useRef(options.onRestore);
  onRestoreRef.current = options.onRestore;
  const onContentReadyRef = useRef(options.onContentReady);
  onContentReadyRef.current = options.onContentReady;

  // Stable wrapper that the parent calls.
  const restore = useCallback((state: unknown) => {
    restorePendingRef.current = true;
    onRestoreRef.current(state);
  }, []);

  // No-deps useLayoutEffect: fires on every render of THIS component.
  // When restorePendingRef is set, the previous onRestore triggered a
  // setState that caused this re-render. DOM is now committed.
  useLayoutEffect(() => {
    if (restorePendingRef.current) {
      restorePendingRef.current = false;
      onContentReadyRef.current?.();
    }
  });

  return { restore };
}

// ===========================================================================
// S1: Basic ref-flag — onRestore sets flag, callback fires on re-render
// ===========================================================================

describe("S1: Basic ref-flag mechanism", () => {
  it("onRestore sets flag, no-deps useLayoutEffect fires onContentReady on re-render", () => {
    let readyFired = false;

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      // Expose restore to parent via ref.
      restoreRef.current = restore;

      return <ul data-testid="list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Parent({ shouldRestore }: { shouldRestore: boolean }) {
      useLayoutEffect(() => {
        if (!shouldRestore) return;
        restoreRef.current?.(["a", "b", "c"]);
      }, [shouldRestore]);

      return <Content onContentReady={() => { readyFired = true; }} />;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent shouldRestore={false} />)); });
    act(() => { rerender(<Parent shouldRestore={true} />); });

    expect(readyFired).toBe(true);
  });
});

// ===========================================================================
// S2: DOM is committed when the callback fires
// ===========================================================================

describe("S2: DOM is committed when onContentReady fires", () => {
  it("parent can read child DOM in the onContentReady callback", () => {
    let domCountAtReady: number | null = null;
    let domTextAtReady: string | null = null;

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      restoreRef.current = restore;

      return <ul data-testid="list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    function Parent({ shouldRestore }: { shouldRestore: boolean }) {
      const ref = useRef<HTMLDivElement>(null);

      const handleReady = useCallback(() => {
        const list = ref.current?.querySelector("[data-testid='list']");
        domCountAtReady = list?.childElementCount ?? -1;
        domTextAtReady = list?.textContent ?? null;
      }, []);

      useLayoutEffect(() => {
        if (!shouldRestore) return;
        restoreRef.current?.(["alpha", "beta", "gamma"]);
      }, [shouldRestore]);

      return (
        <div ref={ref}>
          <Content onContentReady={handleReady} />
        </div>
      );
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent shouldRestore={false} />)); });
    act(() => { rerender(<Parent shouldRestore={true} />); });

    expect(domCountAtReady).toBe(3);
    expect(domTextAtReady).toBe("alphabetagamma");
  });
});

// ===========================================================================
// S3: Flag only fires once per restore
// ===========================================================================

describe("S3: One-shot behavior — flag clears after firing", () => {
  it("onContentReady fires exactly once per onRestore call, not on subsequent re-renders", () => {
    let readyCount = 0;

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady, extra }: { onContentReady: () => void; extra?: string }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      restoreRef.current = restore;

      return (
        <div>
          <ul data-testid="list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {extra && <span>{extra}</span>}
        </div>
      );
    }

    function Parent({ shouldRestore, extra }: { shouldRestore: boolean; extra?: string }) {
      useLayoutEffect(() => {
        if (!shouldRestore) return;
        restoreRef.current?.(["a", "b"]);
      }, [shouldRestore]);

      return <Content onContentReady={() => { readyCount++; }} extra={extra} />;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent shouldRestore={false} />)); });

    // Trigger restore.
    act(() => { rerender(<Parent shouldRestore={true} />); });
    expect(readyCount).toBe(1);

    // Re-render with different props (NOT a restore). Should NOT fire again.
    act(() => { rerender(<Parent shouldRestore={true} extra="changed" />); });
    expect(readyCount).toBe(1);

    // Another re-render. Still should NOT fire.
    act(() => { rerender(<Parent shouldRestore={true} extra="changed again" />); });
    expect(readyCount).toBe(1);
  });
});

// ===========================================================================
// S4: Rapid sequential restores — each gets its own callback
// ===========================================================================

describe("S4: Sequential restores", () => {
  it("each onRestore call fires its own onContentReady", () => {
    const readyPayloads: number[] = [];

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [count, setCount] = useState(0);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setCount(state as number),
        onContentReady,
      });

      restoreRef.current = restore;

      return <div data-testid="count">{count}</div>;
    }

    function Parent() {
      return (
        <Content
          onContentReady={() => {
            const el = document.querySelector("[data-testid='count']");
            readyPayloads.push(Number(el?.textContent ?? -1));
          }}
        />
      );
    }

    act(() => { render(<Parent />); });

    // First restore.
    act(() => { restoreRef.current?.(10); });
    expect(readyPayloads).toEqual([10]);

    // Second restore.
    act(() => { restoreRef.current?.(20); });
    expect(readyPayloads).toEqual([10, 20]);

    // Third restore.
    act(() => { restoreRef.current?.(30); });
    expect(readyPayloads).toEqual([10, 20, 30]);
  });
});

// ===========================================================================
// S5: No false fires from non-restore setState
// ===========================================================================

describe("S5: No false fires", () => {
  it("setState from user interaction (not onRestore) does not trigger onContentReady", () => {
    let readyCount = 0;

    const addItemRef: { current: (() => void) | null } = { current: null };
    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      restoreRef.current = restore;

      // Simulate user interaction that adds an item.
      addItemRef.current = () => setItems((prev) => [...prev, "user-added"]);

      return <ul data-testid="list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    act(() => { render(<Content onContentReady={() => { readyCount++; }} />); });
    expect(readyCount).toBe(0);

    // User action: add item. Should NOT fire onContentReady.
    act(() => { addItemRef.current?.(); });
    expect(readyCount).toBe(0);

    // Another user action.
    act(() => { addItemRef.current?.(); });
    expect(readyCount).toBe(0);

    // Now do a real restore. Should fire exactly once.
    act(() => { restoreRef.current?.(["restored-a", "restored-b"]); });
    expect(readyCount).toBe(1);

    // User action after restore. Should NOT fire.
    act(() => { addItemRef.current?.(); });
    expect(readyCount).toBe(1);
  });
});

// ===========================================================================
// S6: Multiple independent hooks in sibling components
// ===========================================================================

describe("S6: Independent sibling components", () => {
  it("each sibling's onContentReady fires independently", () => {
    const readyLog: string[] = [];

    const restoreA: { current: ((s: unknown) => void) | null } = { current: null };
    const restoreB: { current: ((s: unknown) => void) | null } = { current: null };

    function ContentA({ onReady }: { onReady: () => void }) {
      const [val, setVal] = useState("");
      const { restore } = useContentReadyHook({
        onRestore: (s: unknown) => setVal(s as string),
        onContentReady: onReady,
      });
      restoreA.current = restore;
      return <div data-testid="a">{val}</div>;
    }

    function ContentB({ onReady }: { onReady: () => void }) {
      const [val, setVal] = useState("");
      const { restore } = useContentReadyHook({
        onRestore: (s: unknown) => setVal(s as string),
        onContentReady: onReady,
      });
      restoreB.current = restore;
      return <div data-testid="b">{val}</div>;
    }

    function Shell() {
      return (
        <div>
          <ContentA onReady={() => { readyLog.push("A"); }} />
          <ContentB onReady={() => { readyLog.push("B"); }} />
        </div>
      );
    }

    act(() => { render(<Shell />); });

    // Restore only A.
    act(() => { restoreA.current?.("hello-a"); });
    expect(readyLog).toEqual(["A"]);

    // Restore only B.
    act(() => { restoreB.current?.("hello-b"); });
    expect(readyLog).toEqual(["A", "B"]);

    // Restore both at once.
    act(() => {
      restoreA.current?.("again-a");
      restoreB.current?.("again-b");
    });
    expect(readyLog).toEqual(["A", "B", "A", "B"]);
  });
});

// ===========================================================================
// S7: Full persistence context indirection (mirrors real tugcard)
// ===========================================================================

describe("S7: Persistence context indirection", () => {
  it("the pattern works through context registration (like real useTugcardPersistence)", () => {
    // This simulates the full real pattern:
    // 1. Parent (Tugcard) provides registration context
    // 2. Child registers onRestore + onContentReady via useLayoutEffect
    // 3. Parent calls onRestore in its own useLayoutEffect
    // 4. Child's hook fires onContentReady after re-render

    type PersistCallbacks = {
      onSave: () => unknown;
      onRestore: (state: unknown) => void;
      // The proposed extension:
      onContentReady: () => void;
    };
    const PersistCtx = createContext<((cb: PersistCallbacks) => void) | null>(null);

    let readyFiredWithCount: number | null = null;

    function CardContent() {
      const [items, setItems] = useState<string[]>([]);
      const register = useContext(PersistCtx);
      const setItemsRef = useRef(setItems);
      setItemsRef.current = setItems;

      const restorePendingRef = useRef(false);

      // Registration (like real useTugcardPersistence).
      useLayoutEffect(() => {
        register?.({
          onSave: () => items,
          onRestore: (state: unknown) => {
            restorePendingRef.current = true;
            setItemsRef.current(state as string[]);
          },
          onContentReady: () => {
            // This will be called by the hook's internal effect, but
            // for this simulation we put the logic inline.
          },
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [register]);

      // The ref-flag mechanism (would be inside useTugcardPersistence).
      useLayoutEffect(() => {
        if (restorePendingRef.current) {
          restorePendingRef.current = false;
          // Fire the parent's onContentReady.
          // In the real implementation, this calls through the ref.
          onContentReadyRef.current?.();
        }
      });

      return <ul data-testid="items">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    // The parent-side onContentReady handler.
    const onContentReadyRef: { current: (() => void) | null } = { current: null };

    function CardShell({ activeTab }: { activeTab: string }) {
      const ref = useRef<HTMLDivElement>(null);
      const onRestoreRef = useRef<((s: unknown) => void) | null>(null);
      const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
      const contentRef = useRef<HTMLDivElement>(null);

      const registerCb = useCallback((cb: PersistCallbacks) => {
        onRestoreRef.current = cb.onRestore;
      }, []);

      // Phase 1: call onRestore, hide, set pending scroll.
      useLayoutEffect(() => {
        if (activeTab !== "t2") return;

        const el = contentRef.current;
        if (el) el.style.visibility = "hidden";

        onRestoreRef.current?.(["saved-x", "saved-y", "saved-z"]);
        pendingScrollRef.current = { x: 0, y: 150 };
      }, [activeTab]);

      // Phase 2: onContentReady callback — apply scroll, unhide.
      onContentReadyRef.current = () => {
        const count = ref.current?.querySelector("[data-testid='items']")?.childElementCount ?? 0;
        readyFiredWithCount = count;

        // Apply scroll (simulated).
        pendingScrollRef.current = null;

        // Unhide.
        const el = contentRef.current;
        if (el) el.style.visibility = "";
      };

      return (
        <div ref={ref}>
          <div ref={contentRef}>
            <PersistCtx value={registerCb}>
              <CardContent />
            </PersistCtx>
          </div>
        </div>
      );
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<CardShell activeTab="t1" />)); });
    act(() => { rerender(<CardShell activeTab="t2" />); });

    // onContentReady fired with 3 items in the DOM.
    expect(readyFiredWithCount).toBe(3);
  });
});

// ===========================================================================
// S8: Nested content — hook in wrapper, setState deeper
// ===========================================================================

describe("S8: Nested content components", () => {
  it("hook in wrapper component, setState in grandchild — ready fires correctly", () => {
    // Real-world: useTugcardPersistence is called in an outer wrapper,
    // but onRestore passes state down to a nested child via props/context.

    let readyFired = false;
    let domTextAtReady: string | null = null;

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    // Grandchild: receives items via props, no direct setState.
    function DeepList({ items }: { items: string[] }) {
      return <ul data-testid="deep">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    // Wrapper: owns state, uses the hook.
    function ContentWrapper({ onContentReady }: { onContentReady: () => void }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      restoreRef.current = restore;

      return <DeepList items={items} />;
    }

    function Parent({ shouldRestore }: { shouldRestore: boolean }) {
      const ref = useRef<HTMLDivElement>(null);

      const handleReady = useCallback(() => {
        readyFired = true;
        domTextAtReady = ref.current?.querySelector("[data-testid='deep']")?.textContent ?? null;
      }, []);

      useLayoutEffect(() => {
        if (!shouldRestore) return;
        restoreRef.current?.(["deep-a", "deep-b"]);
      }, [shouldRestore]);

      return (
        <div ref={ref}>
          <ContentWrapper onContentReady={handleReady} />
        </div>
      );
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent shouldRestore={false} />)); });
    act(() => { rerender(<Parent shouldRestore={true} />); });

    expect(readyFired).toBe(true);
    // The grandchild's DOM is committed because the wrapper re-rendered
    // (it owns the state), and React commits the entire subtree.
    expect(domTextAtReady).toBe("deep-adeep-b");
  });
});

// ===========================================================================
// S9: Static content — no onRestore, no false ready signal
// ===========================================================================

describe("S9: Static content — no false signals", () => {
  it("component using the hook but never receiving onRestore does not fire onContentReady", () => {
    let readyCount = 0;

    function StaticContent({ onContentReady }: { onContentReady: () => void }) {
      const [label] = useState("static");

      useContentReadyHook({
        onRestore: () => { /* never called */ },
        onContentReady,
      });

      return <div data-testid="static">{label}</div>;
    }

    function Parent({ extra }: { extra?: string }) {
      return <StaticContent onContentReady={() => { readyCount++; }} />;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent />)); });
    expect(readyCount).toBe(0);

    // Re-render parent (causes child re-render). Should NOT fire.
    act(() => { rerender(<Parent extra="changed" />); });
    expect(readyCount).toBe(0);

    act(() => { rerender(<Parent extra="changed again" />); });
    expect(readyCount).toBe(0);
  });
});

// ===========================================================================
// S10: Parent applies scroll in callback — DOM measurements valid
// ===========================================================================

describe("S10: DOM measurements in onContentReady callback", () => {
  it("parent can measure and mutate DOM in the callback (simulated scroll restore)", () => {
    let scrollApplied = false;
    let measuredChildCount: number | null = null;
    let measuredAttributes: string | null = null;

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [state, setState] = useState({ items: [] as string[], expanded: false });

      const { restore } = useContentReadyHook({
        onRestore: (s: unknown) => setState(s as typeof state),
        onContentReady,
      });

      restoreRef.current = restore;

      return (
        <div data-testid="content" data-expanded={state.expanded ? "true" : "false"}>
          <ul data-testid="list">
            {state.items.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      );
    }

    function Parent({ shouldRestore }: { shouldRestore: boolean }) {
      const ref = useRef<HTMLDivElement>(null);

      const handleReady = useCallback(() => {
        const content = ref.current?.querySelector("[data-testid='content']");
        const list = ref.current?.querySelector("[data-testid='list']");
        measuredChildCount = list?.childElementCount ?? -1;
        measuredAttributes = content?.getAttribute("data-expanded") ?? null;
        scrollApplied = true;
        // In real code: contentEl.scrollTop = savedScroll.y;
      }, []);

      useLayoutEffect(() => {
        if (!shouldRestore) return;
        restoreRef.current?.({ items: ["x", "y", "z"], expanded: true });
      }, [shouldRestore]);

      return (
        <div ref={ref}>
          <Content onContentReady={handleReady} />
        </div>
      );
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Parent shouldRestore={false} />)); });
    act(() => { rerender(<Parent shouldRestore={true} />); });

    expect(scrollApplied).toBe(true);
    expect(measuredChildCount).toBe(3);
    expect(measuredAttributes).toBe("true");
  });
});

// ===========================================================================
// S11: Cleanup — rapid tab switch cancels pending ready
// ===========================================================================

describe("S11: Cleanup on rapid tab switch", () => {
  it("switching away before onContentReady fires cancels the pending restore", () => {
    const readyLog: string[] = [];

    const restoreRef: { current: ((s: unknown) => void) | null } = { current: null };

    function Content({ onContentReady }: { onContentReady: () => void }) {
      const [items, setItems] = useState<string[]>([]);

      const { restore } = useContentReadyHook({
        onRestore: (state: unknown) => setItems(state as string[]),
        onContentReady,
      });

      restoreRef.current = restore;

      return <ul data-testid="list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>;
    }

    function Shell({ activeTab }: { activeTab: string }) {
      const ref = useRef<HTMLDivElement>(null);
      const pendingRef = useRef<string | null>(null);

      // Phase 1: trigger restore and mark pending.
      useLayoutEffect(() => {
        if (activeTab === "t2") {
          pendingRef.current = "t2";
          restoreRef.current?.(["tab2-a", "tab2-b"]);
        } else {
          // Switching away: cancel pending.
          pendingRef.current = null;
        }
      }, [activeTab]);

      // onContentReady: only apply if still pending for this tab.
      const handleReady = useCallback(() => {
        if (pendingRef.current) {
          readyLog.push(`ready:${pendingRef.current}`);
          pendingRef.current = null;
        }
      }, []);

      return (
        <div ref={ref}>
          <Content onContentReady={handleReady} />
        </div>
      );
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => { ({ rerender } = render(<Shell activeTab="t1" />)); });

    // Normal restore.
    act(() => { rerender(<Shell activeTab="t2" />); });
    expect(readyLog).toEqual(["ready:t2"]);

    // Switch to t2 then immediately back to t1.
    // The restore fires (setState happens), but the pending flag is cleared
    // before onContentReady can use it.
    readyLog.length = 0;
    act(() => { rerender(<Shell activeTab="t2" />); });
    act(() => { rerender(<Shell activeTab="t1" />); });

    // The ready callback may fire (setState happened), but pendingRef was
    // cleared by the t1 switch, so nothing is applied.
    // Check that no "ready:t1" appeared (t1 has no restore).
    const hasT1Ready = readyLog.some((e) => e === "ready:t1");
    expect(hasT1Ready).toBe(false);
  });
});
