/**
 * CardContentHost — owns per-card-content scope (feed data, property
 * store, persistence callbacks, dirty-mark, save callback registration).
 *
 * Tests cover: renders the content factory, the tab-level responder
 * `setProperty` handler invokes the registered PropertyStore, the save
 * callback keyed by cardId is registered + unregistered, and the rendered
 * DOM lands inside the host stack's tugcard-content div (via Tugcard +
 * CardContentHost composition).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { CardContentHost } from "@/components/chrome/card-content-host";
import * as registry from "@/components/chrome/card-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import { usePropertyStore } from "@/components/tugways/hooks/use-property-store";
import type { PropertyDescriptor } from "@/components/tugways/property-store";
import { withDeckManager, makeMockStore } from "./mock-deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

function makeDivInBody(): HTMLDivElement {
  const d = document.createElement("div");
  document.body.appendChild(d);
  return d;
}

describe("CardContentHost", () => {
  beforeEach(() => {
    registry._resetForTests();
    _resetForTest();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the content factory result", () => {
    registerCard({
      componentId: "content-host-hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div data-testid="tab-host-child">hello content</div>,
    });

    // Pre-register a host content element so CardPortal routes into it.
    const host = makeDivInBody();
    registry.register("card-1", host);

    render(
      withDeckManager(
        <ResponderChainProvider>
          <CardContentHost tabId="tab-1" hostCardId="card-1" componentId="content-host-hello" />
        </ResponderChainProvider>,
      ),
    );

    const child = host.querySelector('[data-testid="tab-host-child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe("hello content");
  });

  it("renders nothing when the componentId is unregistered", () => {
    const host = makeDivInBody();
    registry.register("card-1", host);

    render(
      withDeckManager(
        <ResponderChainProvider>
          <CardContentHost tabId="tab-1" hostCardId="card-1" componentId="not-registered" />
        </ResponderChainProvider>,
      ),
    );

    expect(host.querySelector("[data-testid]")).toBeNull();
  });

  it("registers a save callback keyed by tabId on mount and unregisters on unmount", () => {
    registerCard({
      componentId: "content-host-hello",
      defaultMeta: { title: "Hello", closable: true },
      contentFactory: () => <div>hello</div>,
    });

    const store = makeMockStore();
    const { unmount } = render(
      withDeckManager(
        <ResponderChainProvider>
          <CardContentHost tabId="my-tab" hostCardId="my-card" componentId="content-host-hello" />
        </ResponderChainProvider>,
        store,
      ),
    );

    // invokeSaveCallback("my-tab") should now trigger the host's save
    // (which writes a bag via setTabState) — since no selection or scroll
    // is present, the bag will be empty.
    act(() => {
      store.invokeSaveCallback("my-tab");
    });
    // getTabState should now return the empty bag written by the host.
    expect(store.getCardState("my-tab")).toEqual({});

    unmount();
    // After unmount, invoking the callback is a no-op (nothing registered).
    const priorSize = Object.keys(store.getCardState("my-tab") ?? {}).length;
    act(() => {
      store.invokeSaveCallback("my-tab");
    });
    // Bag is unchanged (no-op).
    expect(Object.keys(store.getCardState("my-tab") ?? {}).length).toBe(priorSize);
  });

  it("setProperty dispatched to the card responder reaches the registered PropertyStore", async () => {
    const { ResponderChainManager, ResponderChainContext } = await import(
      "@/components/tugways/responder-chain"
    );
    const { TUG_ACTIONS } = await import(
      "@/components/tugways/action-vocabulary"
    );

    const capturedStoreRef = { current: null as null | import("@/components/tugways/property-store").PropertyStore };

    function PropertyContent() {
      const SCHEMA: PropertyDescriptor[] = [
        { path: "style.fontSize", type: "number", label: "Font Size" },
      ];
      const ps = usePropertyStore({ schema: SCHEMA, initialValues: { "style.fontSize": 16 } });
      capturedStoreRef.current = ps;
      return <div>property content</div>;
    }

    registerCard({
      componentId: "content-host-prop",
      defaultMeta: { title: "Prop", closable: true },
      contentFactory: () => <PropertyContent />,
    });

    const host = makeDivInBody();
    registry.register("prop-card", host);

    const manager = new ResponderChainManager();
    render(
      withDeckManager(
        <ResponderChainContext.Provider value={manager}>
          <CardContentHost tabId="prop-tab" hostCardId="prop-card" componentId="content-host-prop" />
        </ResponderChainContext.Provider>,
      ),
    );

    act(() => {});

    // Dispatch setProperty targeted at the card's responder id (which is
    // `tabId` in the CardContentHost's useResponder call).
    act(() => {
      manager.sendToTarget("prop-tab", {
        action: TUG_ACTIONS.SET_PROPERTY,
        phase: "discrete",
        value: { path: "style.fontSize", value: 32, source: "inspector" },
      });
    });

    const ps = capturedStoreRef.current;
    expect(ps).not.toBeNull();
    expect(ps?.get("style.fontSize")).toBe(32);
  });

  it("setProperty no-ops when the content has not registered a PropertyStore", async () => {
    const { ResponderChainManager, ResponderChainContext } = await import(
      "@/components/tugways/responder-chain"
    );
    const { TUG_ACTIONS } = await import(
      "@/components/tugways/action-vocabulary"
    );

    registerCard({
      componentId: "no-prop",
      defaultMeta: { title: "No Prop", closable: true },
      contentFactory: () => <div>no property store</div>,
    });

    const host = makeDivInBody();
    registry.register("no-prop-card", host);

    const manager = new ResponderChainManager();
    render(
      withDeckManager(
        <ResponderChainContext.Provider value={manager}>
          <CardContentHost tabId="no-prop-tab" hostCardId="no-prop-card" componentId="no-prop" />
        </ResponderChainContext.Provider>,
      ),
    );

    act(() => {});

    // No throw even though no PropertyStore was registered.
    expect(() => {
      act(() => {
        manager.sendToTarget("no-prop-tab", {
          action: TUG_ACTIONS.SET_PROPERTY,
          phase: "discrete",
          value: { path: "style.fontSize", value: 32 },
        });
      });
    }).not.toThrow();
  });
});
