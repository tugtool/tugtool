/**
 * card-content-registry — module-level registry mapping cardId to the
 * HTMLDivElement that holds the card's content area.
 *
 * Tests cover: register/unregister, replacement, subscribe/unsubscribe
 * semantics, and isolation between cardIds.
 */
import "./setup-rtl";

import { describe, it, expect, beforeEach, mock } from "bun:test";

import * as registry from "@/components/chrome/card-content-registry";

function makeDiv(): HTMLDivElement {
  return document.createElement("div");
}

describe("card-content-registry", () => {
  beforeEach(() => {
    registry._resetForTests();
  });

  it("register/getElement round-trips a single card", () => {
    const el = makeDiv();
    expect(registry.getElement("card-1")).toBeNull();
    registry.register("card-1", el);
    expect(registry.getElement("card-1")).toBe(el);
  });

  it("unregister removes the element", () => {
    const el = makeDiv();
    registry.register("card-1", el);
    registry.unregister("card-1");
    expect(registry.getElement("card-1")).toBeNull();
  });

  it("register replaces a previous element and notifies subscribers", () => {
    const first = makeDiv();
    const second = makeDiv();
    const cb = mock(() => {});
    registry.register("card-1", first);
    registry.subscribe("card-1", cb);
    registry.register("card-1", second);
    expect(registry.getElement("card-1")).toBe(second);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("register with the same element is a no-op (no notification)", () => {
    const el = makeDiv();
    const cb = mock(() => {});
    registry.register("card-1", el);
    registry.subscribe("card-1", cb);
    registry.register("card-1", el);
    expect(cb).not.toHaveBeenCalled();
  });

  it("subscribe fires on register and unregister for the same cardId", () => {
    const cb = mock(() => {});
    registry.subscribe("card-1", cb);
    registry.register("card-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    registry.unregister("card-1");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("subscribe does not fire for a different cardId", () => {
    const cb = mock(() => {});
    registry.subscribe("card-1", cb);
    registry.register("card-2", makeDiv());
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const cb = mock(() => {});
    const unsub = registry.subscribe("card-1", cb);
    registry.register("card-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    registry.register("card-1", makeDiv());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unregister on an unregistered cardId is a no-op and does not notify", () => {
    const cb = mock(() => {});
    registry.subscribe("card-1", cb);
    registry.unregister("card-1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers for the same cardId", () => {
    const cbA = mock(() => {});
    const cbB = mock(() => {});
    registry.subscribe("card-1", cbA);
    registry.subscribe("card-1", cbB);
    registry.register("card-1", makeDiv());
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });
});
