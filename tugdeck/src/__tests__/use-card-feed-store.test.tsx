/**
 * useCardFeedStore hook unit tests.
 *
 * Host-side hook that owns the per-card FeedStore pipeline. Tests wire a
 * TestFrameChannel through the connection-singleton mock so the real
 * FeedStore constructs against a test-controllable wire, then assert:
 *   - empty feedIds yields an empty map (no FeedStore constructed)
 *   - dispatched frames flow into the returned map
 *   - the workspace filter drops frames when a binding's workspaceKey
 *     does not match the frame's workspace_key
 *   - dispose runs on unmount (no frames delivered after unmount)
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { renderHook, act } from "@testing-library/react";

import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FeedId } from "@/protocol";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";

const mockConnection = new TestFrameChannel();

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => mockConnection,
  setConnection: () => {},
}));

import { useCardFeedStore } from "@/components/tugways/hooks/use-card-feed-store";

afterEach(() => {
  // Clear every per-card session binding between tests so workspace
  // filters start from a clean slate.
  const bindings = cardSessionBindingStore.getSnapshot();
  for (const cardId of bindings.keys()) {
    cardSessionBindingStore.clearBinding(cardId);
  }
});

describe("useCardFeedStore", () => {
  it("returns an empty map when feedIds is empty", () => {
    const { result } = renderHook(() => useCardFeedStore("card-1", []));
    expect(result.current.size).toBe(0);
  });

  it("exposes dispatched frames through the returned map", () => {
    const { result } = renderHook(() =>
      useCardFeedStore("card-1", [FeedId.STATS]),
    );
    expect(result.current.size).toBe(0);
    // Default (no binding) filter is `presentWorkspaceKey` — frames must
    // carry a workspace_key to pass. Frames without one are dropped.
    act(() => {
      mockConnection.dispatchDecoded(FeedId.STATS, {
        workspace_key: "ws-any",
        value: 42,
      });
    });
    expect(result.current.get(FeedId.STATS)).toEqual({
      workspace_key: "ws-any",
      value: 42,
    });
  });

  it("drops frames missing workspace_key when no binding is set", () => {
    const { result } = renderHook(() =>
      useCardFeedStore("card-nokey", [FeedId.STATS]),
    );
    act(() => {
      mockConnection.dispatchDecoded(FeedId.STATS, { value: 99 });
    });
    expect(result.current.has(FeedId.STATS)).toBe(false);
  });

  it("drops frames whose workspace_key does not match the card's binding", () => {
    cardSessionBindingStore.setBinding("card-2", {
      tugSessionId: "sess-A",
      workspaceKey: "ws-A",
      projectDir: "/tmp/a",
      sessionMode: "new",
    });
    const { result } = renderHook(() =>
      useCardFeedStore("card-2", [FeedId.SESSION_METADATA]),
    );
    act(() => {
      mockConnection.dispatchDecoded(FeedId.SESSION_METADATA, {
        workspace_key: "ws-OTHER",
        payload: "bad",
      });
    });
    expect(result.current.has(FeedId.SESSION_METADATA)).toBe(false);
    act(() => {
      mockConnection.dispatchDecoded(FeedId.SESSION_METADATA, {
        workspace_key: "ws-A",
        payload: "good",
      });
    });
    expect(result.current.get(FeedId.SESSION_METADATA)).toEqual({
      workspace_key: "ws-A",
      payload: "good",
    });
  });

  it("disposes on unmount — no further frames are delivered", () => {
    const { result, unmount } = renderHook(() =>
      useCardFeedStore("card-3", [FeedId.STATS]),
    );
    act(() => {
      mockConnection.dispatchDecoded(FeedId.STATS, {
        workspace_key: "ws-any",
        value: 1,
      });
    });
    expect(result.current.get(FeedId.STATS)).toEqual({
      workspace_key: "ws-any",
      value: 1,
    });
    const snapshotBefore = result.current;
    unmount();
    act(() => {
      mockConnection.dispatchDecoded(FeedId.STATS, {
        workspace_key: "ws-any",
        value: 2,
      });
    });
    // Ref snapshot captured before unmount must not mutate after dispose.
    expect(snapshotBefore.get(FeedId.STATS)).toEqual({
      workspace_key: "ws-any",
      value: 1,
    });
  });
});
