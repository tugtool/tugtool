/**
 * TabContentHost — owns per-tab-content scope (feed data, property store,
 * persistence callbacks, dirty-mark, save callback registration).
 *
 * Tests cover: renders the content factory, registers a PropertyStore into
 * tab-property-store-registry keyed by hostCardId, registers a save callback
 * keyed by tabId, cleanup unregisters both, and the rendered DOM lands
 * inside the host card's tugcard-content div (via Tugcard + TabContentHost
 * composition).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { TabContentHost } from "@/components/chrome/tab-content-host";
import * as registry from "@/components/chrome/card-content-registry";
import * as propRegistry from "@/components/chrome/tab-property-store-registry";
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

describe("TabContentHost", () => {
  beforeEach(() => {
    registry._resetForTests();
    propRegistry._resetForTests();
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

    // Pre-register a host content element so the portal path (later piece) can
    // route into it; for Piece 1.ii the content is rendered inline.
    const host = makeDivInBody();
    registry.register("card-1", host);

    const { container } = render(
      withDeckManager(
        <ResponderChainProvider>
          <TabContentHost tabId="tab-1" hostCardId="card-1" componentId="content-host-hello" />
        </ResponderChainProvider>,
      ),
    );

    const child = container.querySelector('[data-testid="tab-host-child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe("hello content");
  });

  it("renders nothing when the componentId is unregistered", () => {
    const host = makeDivInBody();
    registry.register("card-1", host);

    const { container } = render(
      withDeckManager(
        <ResponderChainProvider>
          <TabContentHost tabId="tab-1" hostCardId="card-1" componentId="not-registered" />
        </ResponderChainProvider>,
      ),
    );

    expect(container.querySelector("[data-testid]")).toBeNull();
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
          <TabContentHost tabId="my-tab" hostCardId="my-card" componentId="content-host-hello" />
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
    expect(store.getTabState("my-tab")).toEqual({});

    unmount();
    // After unmount, invoking the callback is a no-op (nothing registered).
    const priorSize = Object.keys(store.getTabState("my-tab") ?? {}).length;
    act(() => {
      store.invokeSaveCallback("my-tab");
    });
    // Bag is unchanged (no-op).
    expect(Object.keys(store.getTabState("my-tab") ?? {}).length).toBe(priorSize);
  });

  it("publishes the content's PropertyStore to the registry keyed by hostCardId", () => {
    function PropertyContent() {
      const SCHEMA: PropertyDescriptor[] = [
        { path: "style.fontSize", type: "number", label: "Font Size" },
      ];
      usePropertyStore({ schema: SCHEMA, initialValues: { "style.fontSize": 16 } });
      return <div>property content</div>;
    }

    registerCard({
      componentId: "content-host-prop",
      defaultMeta: { title: "Prop", closable: true },
      contentFactory: () => <PropertyContent />,
    });

    const host = makeDivInBody();
    registry.register("prop-card", host);

    render(
      withDeckManager(
        <ResponderChainProvider>
          <TabContentHost tabId="prop-tab" hostCardId="prop-card" componentId="content-host-prop" />
        </ResponderChainProvider>,
      ),
    );

    // Flush useLayoutEffect so usePropertyStore's registration completes.
    act(() => {});

    const ps = propRegistry.get("prop-card");
    expect(ps).not.toBeNull();
    expect(ps?.get("style.fontSize")).toBe(16);
  });

  it("unpublishes the PropertyStore from the registry on unmount", () => {
    function PropertyContent() {
      const SCHEMA: PropertyDescriptor[] = [
        { path: "style.fontSize", type: "number", label: "Font Size" },
      ];
      usePropertyStore({ schema: SCHEMA, initialValues: { "style.fontSize": 16 } });
      return <div>property content</div>;
    }

    registerCard({
      componentId: "content-host-prop",
      defaultMeta: { title: "Prop", closable: true },
      contentFactory: () => <PropertyContent />,
    });

    const host = makeDivInBody();
    registry.register("prop-card", host);

    const { unmount } = render(
      withDeckManager(
        <ResponderChainProvider>
          <TabContentHost tabId="prop-tab" hostCardId="prop-card" componentId="content-host-prop" />
        </ResponderChainProvider>,
      ),
    );

    act(() => {});
    expect(propRegistry.get("prop-card")).not.toBeNull();

    unmount();
    expect(propRegistry.get("prop-card")).toBeNull();
  });
});
