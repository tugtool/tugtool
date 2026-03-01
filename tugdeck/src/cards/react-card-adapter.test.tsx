/**
 * ReactCardAdapter tests — step-7
 *
 * ReactCardAdapter is now a lightweight config object. Tests cover:
 * - Config properties: feedIds, component, initialMeta accessible as properties
 * - meta getter returns initialMeta
 * - TugCard interface: mount, onFrame, onResize, destroy are no-ops
 * - setDragState updates dragState property
 * - CardContextProvider: state-based updateMeta works (no CustomEvent)
 * - useFeed hook: returns updated data when feedData Map is provided
 * - useConnection hook: provides TugConnection instance
 * - useCardMeta hook: calls updateMeta state callback (no CustomEvent dispatched)
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, act } from "@testing-library/react";
import React, { useEffect, useRef, useState } from "react";

import { ReactCardAdapter } from "./react-card-adapter.tsx";
import { CardContext, CardContextProvider } from "./card-context";
import { useCardMeta } from "../hooks/use-card-meta";
import { useConnection } from "../hooks/use-connection";
import { useFeed } from "../hooks/use-feed";
import { FeedId } from "../protocol";
import type { TugCardMeta, CardMenuItem } from "./card";
import type { TugConnection } from "../connection";

// ---- Minimal DOM setup ----

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function makeMeta(overrides: Partial<TugCardMeta> = {}): TugCardMeta {
  return {
    title: "Test Card",
    icon: "Info",
    closable: true,
    menuItems: [],
    ...overrides,
  };
}

// ---- Test components ----

function StaticComponent() {
  return <div data-testid="static">hello</div>;
}

function FeedComponent({ feedId }: { feedId: number }) {
  const bytes = useFeed(feedId as typeof FeedId[keyof typeof FeedId]);
  const text = bytes ? new TextDecoder().decode(bytes) : "no data";
  return <div data-testid="feed-data">{text}</div>;
}

function ConnectionComponent() {
  const conn = useConnection();
  return <div data-testid="connection">{conn ? "connected" : "no connection"}</div>;
}

// ---- Tests ----

describe("ReactCardAdapter – config object properties", () => {
  it("feedIds property reflects config.feedIds", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [FeedId.GIT, FeedId.FILESYSTEM],
      initialMeta: makeMeta(),
    });
    expect(adapter.feedIds).toEqual([FeedId.GIT, FeedId.FILESYSTEM]);
  });

  it("meta returns initialMeta", () => {
    const initial = makeMeta({ title: "Initial Title", icon: "Settings" });
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: initial,
    });
    expect(adapter.meta.title).toBe("Initial Title");
    expect(adapter.meta.icon).toBe("Settings");
  });

  it("component property reflects config.component", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(adapter.component).toBe(StaticComponent);
  });

  it("connection defaults to null when not provided", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(adapter.connection).toBeNull();
  });

  it("connection property reflects config.connection", () => {
    const mockConn = { send: () => {} } as unknown as TugConnection;
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
      connection: mockConn,
    });
    expect(adapter.connection).toBe(mockConn);
  });

  it("setDragState updates dragState property", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(adapter.dragState).toBeNull();
    const mockDragState = { isDragging: false };
    adapter.setDragState(mockDragState as any);
    expect(adapter.dragState).toBe(mockDragState);
  });
});

describe("ReactCardAdapter – TugCard interface (no-ops)", () => {
  it("mount() is a no-op", () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    // Should not throw
    expect(() => adapter.mount(container)).not.toThrow();
    // No React content mounted (DeckCanvas handles rendering)
    expect(container.querySelector("[data-testid='static']")).toBeNull();
  });

  it("onFrame() is a no-op", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [FeedId.GIT],
      initialMeta: makeMeta(),
    });
    expect(() => adapter.onFrame(FeedId.GIT, new Uint8Array([1, 2, 3]))).not.toThrow();
  });

  it("onResize() is a no-op", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(() => adapter.onResize(640, 480)).not.toThrow();
  });

  it("destroy() is a no-op", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(() => adapter.destroy()).not.toThrow();
  });

  it("focus() is a no-op", () => {
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    expect(() => adapter.focus()).not.toThrow();
  });
});

describe("CardContextProvider – state-based updateMeta", () => {
  it("updateMeta callback is called when card component calls useCardMeta", async () => {
    const received: TugCardMeta[] = [];
    const onMetaUpdate = (meta: TugCardMeta) => {
      received.push(meta);
    };

    const meta = makeMeta({ title: "State Callback Test" });
    function Probe() {
      useCardMeta(meta);
      return null;
    }

    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        updateMeta={onMetaUpdate}
      >
        <Probe />
      </CardContextProvider>
    );

    await act(async () => {});

    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].title).toBe("State Callback Test");
    unmount();
  });

  it("updateMeta is a no-op when not provided", async () => {
    function Probe() {
      useCardMeta(makeMeta({ title: "No-op Test" }));
      return null;
    }

    // Should not throw when updateMeta is not provided
    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );

    await act(async () => {});
    unmount();
  });
});

describe("useFeed hook", () => {
  it("returns null before any feed data", () => {
    let captured: Uint8Array | null = undefined as unknown as Uint8Array | null;
    function Probe() {
      captured = useFeed(FeedId.GIT);
      return null;
    }

    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );
    expect(captured).toBeNull();
    unmount();
  });

  it("returns feed data when feedData Map contains it", () => {
    let captured: Uint8Array | null = null;
    function Probe() {
      captured = useFeed(FeedId.GIT);
      return null;
    }

    const payload = new TextEncoder().encode("git status");
    const feedData = new Map([[FeedId.GIT, payload]]);

    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={feedData}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );
    expect(captured).toBe(payload);
    unmount();
  });
});

describe("useConnection hook", () => {
  it("provides the TugConnection instance via context", () => {
    const mockConn = { send: () => {} } as unknown as TugConnection;
    let captured: TugConnection | null = null;

    function Probe() {
      captured = useConnection();
      return null;
    }

    const { unmount } = render(
      <CardContextProvider
        connection={mockConn}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );

    expect(captured).toBe(mockConn);
    unmount();
  });

  it("returns null connection when not provided", () => {
    let captured: TugConnection | null = undefined as unknown as TugConnection | null;

    function Probe() {
      captured = useConnection();
      return null;
    }

    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );

    expect(captured).toBeNull();
    unmount();
  });
});

describe("useCardMeta hook", () => {
  it("calls updateMeta state callback on mount", async () => {
    const received: TugCardMeta[] = [];
    const onMetaUpdate = (meta: TugCardMeta) => received.push(meta);

    const meta = makeMeta({ title: "Hook Test" });
    function Probe() {
      useCardMeta(meta);
      return null;
    }

    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        updateMeta={onMetaUpdate}
      >
        <Probe />
      </CardContextProvider>
    );

    await act(async () => {});

    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].title).toBe("Hook Test");
    unmount();
  });

  it("does NOT dispatch card-meta-update CustomEvent (CustomEvent eliminated)", async () => {
    const container = makeContainer();
    const received: Event[] = [];
    container.addEventListener("card-meta-update", (e) => received.push(e));

    const meta = makeMeta({ title: "No CustomEvent" });
    function Probe() {
      useCardMeta(meta);
      return null;
    }

    // Render without containerEl (it no longer exists)
    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
      >
        <Probe />
      </CardContextProvider>
    );

    await act(async () => {});

    // No CustomEvent should be dispatched
    expect(received.length).toBe(0);
    unmount();
  });
});
