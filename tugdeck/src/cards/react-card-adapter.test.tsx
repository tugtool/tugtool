/**
 * ReactCardAdapter tests — step-3
 *
 * Covers:
 * - Lifecycle: mount, onFrame, onResize, destroy
 * - meta getter: initialMeta before update, updated meta after card-meta-update event
 * - Live meta update: CardHeader DOM updates immediately when event is dispatched
 * - Multi-tab: setActiveTab controls whether meta is pushed to CardFrame
 * - setCardFrame(null) guard: no throw after clearing reference
 * - setCardFrame(null) + setCardFrame(newFrame): meta flows to new frame
 * - Menu item callbacks in updated meta invoke handler
 * - useFeed hook: returns updated data when onFrame is called
 * - useConnection hook: provides the TugConnection instance
 * - useCardMeta hook: dispatches meta update event on the container
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
import type { CardFrameHandle } from "../components/chrome/card-frame";

// ---- Minimal DOM setup for tests that don't use RTL ----

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

// ---- Minimal CardFrame mock ----

function makeCardFrameMock() {
  const calls: TugCardMeta[] = [];
  const mock = {
    updateMeta: (meta: TugCardMeta) => {
      calls.push(meta);
    },
    _calls: calls,
  } as unknown as CardFrameHandle & { _calls: TugCardMeta[] };
  return mock;
}

// ---- Test components ----

/** A component that renders a fixed text node — no meta update. */
function StaticComponent() {
  return <div data-testid="static">hello</div>;
}

/** A component that calls useCardMeta with a given meta. */
function MetaComponent({ meta }: { meta: TugCardMeta }) {
  useCardMeta(meta);
  return <div data-testid="meta-component">meta card</div>;
}

/** A component that renders feed data from useFeed. */
function FeedComponent({ feedId }: { feedId: number }) {
  const bytes = useFeed(feedId as typeof FeedId[keyof typeof FeedId]);
  const text = bytes ? new TextDecoder().decode(bytes) : "no data";
  return <div data-testid="feed-data">{text}</div>;
}

/** A component that renders connection state from useConnection. */
function ConnectionComponent() {
  const conn = useConnection();
  return <div data-testid="connection">{conn ? "connected" : "no connection"}</div>;
}

// ---- Tests ----

describe("ReactCardAdapter – lifecycle", () => {
  it("mounts a React component into a container div", async () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });

    await act(async () => {
      adapter.mount(container);
    });
    expect(container.querySelector("[data-testid='static']")).not.toBeNull();
    adapter.destroy();
  });

  it("destroy() unmounts the React root and stops rendering", async () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });

    await act(async () => {
      adapter.mount(container);
    });
    expect(container.querySelector("[data-testid='static']")).not.toBeNull();

    await act(async () => {
      adapter.destroy();
    });
    // After unmount, React clears the container
    expect(container.querySelector("[data-testid='static']")).toBeNull();
  });

  it("destroy() removes the card-meta-update event listener", () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta({ title: "Before" }),
    });
    adapter.mount(container);
    adapter.destroy();

    // Dispatch after destroy should not update meta
    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "After Destroy" }),
      })
    );
    expect(adapter.meta.title).toBe("Before");
  });
});

describe("ReactCardAdapter – meta getter", () => {
  it("meta returns initialMeta before any updates", () => {
    const initial = makeMeta({ title: "Initial Title", icon: "Settings" });
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: initial,
    });
    expect(adapter.meta.title).toBe("Initial Title");
    expect(adapter.meta.icon).toBe("Settings");
  });

  it("meta returns updated meta after card-meta-update event is dispatched", () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta({ title: "Original" }),
    });
    adapter.mount(container);

    const newMeta = makeMeta({ title: "Updated" });
    container.dispatchEvent(
      new CustomEvent("card-meta-update", { detail: newMeta })
    );

    expect(adapter.meta.title).toBe("Updated");
    adapter.destroy();
  });
});

describe("ReactCardAdapter – onFrame and onResize", () => {
  it("onFrame() delivers feed data to the mounted React component via context", async () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: () => <FeedComponent feedId={FeedId.FILESYSTEM} />,
      feedIds: [FeedId.FILESYSTEM],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);

    const payload = new TextEncoder().encode("file data");
    await act(async () => {
      adapter.onFrame(FeedId.FILESYSTEM, payload);
    });

    const el = container.querySelector("[data-testid='feed-data']");
    expect(el?.textContent).toBe("file data");
    adapter.destroy();
  });

  it("onResize() updates dimensions accessible via context", async () => {
    let capturedDimensions = { width: 0, height: 0 };
    function DimComponent() {
      const { dimensions } = React.useContext(CardContext);
      capturedDimensions = dimensions;
      return <div />;
    }

    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: DimComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);

    await act(async () => {
      adapter.onResize(640, 480);
    });

    expect(capturedDimensions.width).toBe(640);
    expect(capturedDimensions.height).toBe(480);
    adapter.destroy();
  });
});

describe("ReactCardAdapter – live meta update to CardHeader", () => {
  it("when React component dispatches card-meta-update and isActiveTab, CardFrame.updateMeta is called", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta({ title: "Old Title" }),
    });
    adapter.mount(container);
    // Set active=false first so setCardFrame doesn't trigger initial push
    adapter.setCardFrame(frame);
    adapter.setActiveTab(false);
    frame._calls.length = 0; // clear any initial pushes

    // Now activate
    adapter.setActiveTab(true);
    frame._calls.length = 0; // clear the setActiveTab(true) push of initialMeta

    const newMeta = makeMeta({ title: "New Title" });
    container.dispatchEvent(
      new CustomEvent("card-meta-update", { detail: newMeta })
    );

    expect(frame._calls.length).toBe(1);
    expect(frame._calls[0].title).toBe("New Title");
    adapter.destroy();
  });

  it("meta update does NOT push to CardFrame when isActiveTab is false", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);
    adapter.setCardFrame(frame);
    adapter.setActiveTab(false);

    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "Silent Update" }),
      })
    );

    expect(frame._calls.length).toBe(0);
    adapter.destroy();
  });

  it("menu item callbacks in updated meta invoke the handler", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    let actionFired = false;

    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);
    adapter.setCardFrame(frame);
    adapter.setActiveTab(true);

    const menuItems: CardMenuItem[] = [
      {
        type: "action",
        label: "Do Thing",
        action: () => {
          actionFired = true;
        },
      },
    ];
    const newMeta = makeMeta({ menuItems });
    container.dispatchEvent(
      new CustomEvent("card-meta-update", { detail: newMeta })
    );

    // Trigger the menu action via the stored meta
    const storedMenu = adapter.meta.menuItems[0];
    expect(storedMenu?.type).toBe("action");
    if (storedMenu?.type === "action") {
      storedMenu.action();
    }
    expect(actionFired).toBe(true);
    adapter.destroy();
  });
});

describe("ReactCardAdapter – multi-tab behavior", () => {
  it("setActiveTab(true) immediately pushes cached meta to CardFrame", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta({ title: "Tab Meta" }),
    });
    adapter.mount(container);
    adapter.setCardFrame(frame);
    adapter.setActiveTab(false);

    // Update meta while inactive — should be cached, not pushed
    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "Cached Meta" }),
      })
    );
    expect(frame._calls.length).toBe(0);

    // Now activate — should push cached meta immediately
    adapter.setActiveTab(true);
    expect(frame._calls.length).toBe(1);
    expect(frame._calls[0].title).toBe("Cached Meta");
    adapter.destroy();
  });

  it("setActiveTab(false) prevents further meta pushes", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);
    adapter.setCardFrame(frame);
    // Activate, then clear the initial push from setActiveTab(true)
    adapter.setActiveTab(true);
    frame._calls.length = 0;

    // First update while active — goes through
    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "Active Update" }),
      })
    );
    expect(frame._calls.length).toBe(1);

    // Deactivate
    adapter.setActiveTab(false);

    // Second update while inactive — cached only
    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "Inactive Update" }),
      })
    );
    expect(frame._calls.length).toBe(1); // no new push
    adapter.destroy();
  });
});

describe("ReactCardAdapter – stale CardFrame guard", () => {
  it("after setCardFrame(null), meta update event does not throw", () => {
    const container = makeContainer();
    const frame = makeCardFrameMock();
    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);
    adapter.setCardFrame(frame);
    adapter.setActiveTab(true);
    adapter.setCardFrame(null);

    expect(() => {
      container.dispatchEvent(
        new CustomEvent("card-meta-update", {
          detail: makeMeta({ title: "After Null" }),
        })
      );
    }).not.toThrow();

    // Meta is still updated even when frame is null
    expect(adapter.meta.title).toBe("After Null");
    adapter.destroy();
  });

  it("after setCardFrame(null) then setCardFrame(newFrame), meta flows to new frame", () => {
    const container = makeContainer();
    const frame1 = makeCardFrameMock();
    const frame2 = makeCardFrameMock();

    const adapter = new ReactCardAdapter({
      component: StaticComponent,
      feedIds: [],
      initialMeta: makeMeta({ title: "Initial" }),
    });
    adapter.mount(container);
    // Set frame1 active — it receives the setActiveTab(true) initial push
    adapter.setCardFrame(frame1);
    adapter.setActiveTab(true);
    const frame1InitialPushCount = frame1._calls.length; // typically 1

    // Simulate re-render teardown: clear frame, then assign new frame
    adapter.setCardFrame(null);
    adapter.setCardFrame(frame2);

    // Dispatch a new meta update — must flow to frame2 only
    container.dispatchEvent(
      new CustomEvent("card-meta-update", {
        detail: makeMeta({ title: "To New Frame" }),
      })
    );

    // frame1 should not receive any NEW calls after setCardFrame(null)
    expect(frame1._calls.length).toBe(frame1InitialPushCount);
    // frame2 receives the new meta
    expect(frame2._calls.length).toBe(1);
    expect(frame2._calls[0].title).toBe("To New Frame");
    adapter.destroy();
  });
});

describe("useFeed hook", () => {
  it("returns null before any onFrame call", () => {
    let captured: Uint8Array | null = undefined as unknown as Uint8Array | null;
    function Probe() {
      captured = useFeed(FeedId.GIT);
      return null;
    }

    const container = makeContainer();
    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={container}
      >
        <Probe />
      </CardContextProvider>
    );
    expect(captured).toBeNull();
    unmount();
  });

  it("returns updated data when onFrame is called via ReactCardAdapter", async () => {
    const container = makeContainer();
    const adapter = new ReactCardAdapter({
      component: () => <FeedComponent feedId={FeedId.GIT} />,
      feedIds: [FeedId.GIT],
      initialMeta: makeMeta(),
    });
    adapter.mount(container);

    const payload = new TextEncoder().encode("git status");
    await act(async () => {
      adapter.onFrame(FeedId.GIT, payload);
    });

    const el = container.querySelector("[data-testid='feed-data']");
    expect(el?.textContent).toBe("git status");
    adapter.destroy();
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

    const container = makeContainer();
    const { unmount } = render(
      <CardContextProvider
        connection={mockConn}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={container}
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

    const container = makeContainer();
    const { unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={new Map()}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={container}
      >
        <Probe />
      </CardContextProvider>
    );

    expect(captured).toBeNull();
    unmount();
  });
});

describe("useCardMeta hook", () => {
  it("dispatches card-meta-update event on the container element", async () => {
    const container = makeContainer();
    const received: TugCardMeta[] = [];
    container.addEventListener("card-meta-update", (e) => {
      received.push((e as CustomEvent<TugCardMeta>).detail);
    });

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
        containerEl={container}
      >
        <Probe />
      </CardContextProvider>
    );

    // useEffect fires after render; wait for it
    await act(async () => {});

    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].title).toBe("Hook Test");
    unmount();
  });
});

