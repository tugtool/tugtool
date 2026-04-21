/**
 * window-content-registry — module-level registry mapping window id to the
 * HTMLDivElement that holds that window's content area.
 *
 * Tests cover: register/unregister, replacement, subscribe/unsubscribe
 * semantics, and isolation between window ids.
 */
import "./setup-rtl";

import { describe, it, expect, beforeEach, mock } from "bun:test";

import * as registry from "@/components/chrome/window-content-registry";

function makeDiv(): HTMLDivElement {
  return document.createElement("div");
}

describe("window-content-registry", () => {
  beforeEach(() => {
    registry._resetForTests();
  });

  it("register/getElement round-trips a single window", () => {
    const el = makeDiv();
    expect(registry.getElement("win-1")).toBeNull();
    registry.register("win-1", el);
    expect(registry.getElement("win-1")).toBe(el);
  });

  it("unregister removes the element", () => {
    const el = makeDiv();
    registry.register("win-1", el);
    registry.unregister("win-1");
    expect(registry.getElement("win-1")).toBeNull();
  });

  it("register replaces a previous element and notifies subscribers", () => {
    const first = makeDiv();
    const second = makeDiv();
    const cb = mock(() => {});
    registry.register("win-1", first);
    registry.subscribe("win-1", cb);
    registry.register("win-1", second);
    expect(registry.getElement("win-1")).toBe(second);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("register with the same element is a no-op (no notification)", () => {
    const el = makeDiv();
    const cb = mock(() => {});
    registry.register("win-1", el);
    registry.subscribe("win-1", cb);
    registry.register("win-1", el);
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscribe fires on register and unregister for the same windowId", () => {
    const cb = mock(() => {});
    registry.subscribe("win-1", cb);
    registry.register("win-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    registry.unregister("win-1");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("subscribe does not fire for a different windowId", () => {
    const cb = mock(() => {});
    registry.subscribe("win-1", cb);
    registry.register("win-2", makeDiv());
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const cb = mock(() => {});
    const unsub = registry.subscribe("win-1", cb);
    registry.register("win-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    registry.register("win-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unregister on an unregistered windowId is a no-op and does not notify", () => {
    const cb = mock(() => {});
    registry.subscribe("win-1", cb);
    registry.unregister("win-1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers for the same windowId", () => {
    const cbA = mock(() => {});
    const cbB = mock(() => {});
    registry.subscribe("win-1", cbA);
    registry.subscribe("win-1", cbB);
    registry.register("win-1", makeDiv());
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });
});
