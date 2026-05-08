/**
 * pane-frame-registry — module-level registry mapping pane id to the
 * outer HTMLDivElement of that pane's frame (the `.tug-pane` element).
 *
 * Tests cover: register/unregister, replacement, subscribe/unsubscribe
 * semantics, and isolation between pane ids. Same shape as
 * `pane-root-registry` and `pane-content-registry` (those two cover the
 * inner chrome and the content slot respectively); this registry
 * bridges the outer frame for pane-modal portal targets.
 */
import "./setup-rtl";

import { describe, it, expect, beforeEach, mock } from "bun:test";

import * as registry from "@/components/chrome/pane-frame-registry";

function makeDiv(): HTMLDivElement {
  return document.createElement("div");
}

describe("pane-frame-registry", () => {
  beforeEach(() => {
    registry._resetForTests();
  });

  it("register/getElement round-trips a single pane", () => {
    const el = makeDiv();
    expect(registry.getElement("pane-1")).toBeNull();
    registry.register("pane-1", el);
    expect(registry.getElement("pane-1")).toBe(el);
  });

  it("unregister removes the element", () => {
    const el = makeDiv();
    registry.register("pane-1", el);
    registry.unregister("pane-1");
    expect(registry.getElement("pane-1")).toBeNull();
  });

  it("register replaces a previous element and notifies subscribers", () => {
    const first = makeDiv();
    const second = makeDiv();
    const cb = mock(() => {});
    registry.register("pane-1", first);
    registry.subscribe("pane-1", cb);
    registry.register("pane-1", second);
    expect(registry.getElement("pane-1")).toBe(second);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("register with the same element is a no-op (no notification)", () => {
    const el = makeDiv();
    const cb = mock(() => {});
    registry.register("pane-1", el);
    registry.subscribe("pane-1", cb);
    registry.register("pane-1", el);
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscribe fires on register and unregister for the same paneId", () => {
    const cb = mock(() => {});
    registry.subscribe("pane-1", cb);
    registry.register("pane-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    registry.unregister("pane-1");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("subscribe does not fire for a different paneId", () => {
    const cb = mock(() => {});
    registry.subscribe("pane-1", cb);
    registry.register("pane-2", makeDiv());
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const cb = mock(() => {});
    const unsub = registry.subscribe("pane-1", cb);
    registry.register("pane-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    registry.register("pane-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unregister on an unregistered paneId is a no-op and does not notify", () => {
    const cb = mock(() => {});
    registry.subscribe("pane-1", cb);
    registry.unregister("pane-1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers for the same paneId", () => {
    const cbA = mock(() => {});
    const cbB = mock(() => {});
    registry.subscribe("pane-1", cbA);
    registry.subscribe("pane-1", cbB);
    registry.register("pane-1", makeDiv());
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });
});
