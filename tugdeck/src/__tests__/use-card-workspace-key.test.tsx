/**
 * useCardWorkspaceKey hook unit tests.
 *
 * Tests cover:
 * - Returns `undefined` when the card is unbound.
 * - Returns the canonical `workspace_key` when the card is bound.
 * - Re-renders the consumer when the binding changes or is cleared.
 *
 * Uses the module-scope `cardSessionBindingStore` singleton imported by the
 * hook. Each test clears its own card id to avoid cross-test pollution.
 */

import "./setup-rtl";
import { describe, test, expect, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";

const TOUCHED_CARD_IDS = new Set<string>();

function bind(cardId: string, workspaceKey: string): void {
  TOUCHED_CARD_IDS.add(cardId);
  cardSessionBindingStore.setBinding(cardId, {
    tugSessionId: `sess-${cardId}`,
    workspaceKey,
    projectDir: workspaceKey,
    sessionMode: "new",
    claudeSessionId: null,
  });
}

afterEach(() => {
  for (const id of TOUCHED_CARD_IDS) {
    cardSessionBindingStore.clearBinding(id);
  }
  TOUCHED_CARD_IDS.clear();
});

describe("useCardWorkspaceKey", () => {
  test("returns undefined when the card is unbound", () => {
    const { result } = renderHook(() => useCardWorkspaceKey("card-unbound"));
    expect(result.current).toBeUndefined();
  });

  test("returns the workspace key when the card is bound before mount", () => {
    bind("card-pre", "/work/alpha");
    const { result } = renderHook(() => useCardWorkspaceKey("card-pre"));
    expect(result.current).toBe("/work/alpha");
  });

  test("re-renders when the binding is set, replaced, and cleared", () => {
    const { result } = renderHook(() => useCardWorkspaceKey("card-live"));
    expect(result.current).toBeUndefined();

    act(() => {
      bind("card-live", "/work/alpha");
    });
    expect(result.current).toBe("/work/alpha");

    act(() => {
      bind("card-live", "/work/beta");
    });
    expect(result.current).toBe("/work/beta");

    act(() => {
      cardSessionBindingStore.clearBinding("card-live");
    });
    expect(result.current).toBeUndefined();
  });

  test("unrelated card-id bindings do not affect the subscriber's value", () => {
    const { result } = renderHook(() => useCardWorkspaceKey("card-target"));
    expect(result.current).toBeUndefined();

    act(() => {
      bind("card-other", "/work/other");
    });

    expect(result.current).toBeUndefined();
  });
});
