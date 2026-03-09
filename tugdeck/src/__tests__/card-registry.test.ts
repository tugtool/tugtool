/**
 * Card Registry unit tests -- Step 1.
 *
 * Tests cover:
 * - T01: registerCard stores a registration and getRegistration retrieves it
 * - T02: getRegistration returns undefined for unregistered component
 * - T03: duplicate registerCard overwrites and logs warning
 * - T04: getAllRegistrations returns all registered entries
 * - T05: _resetForTest clears the registry
 */

import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import {
  registerCard,
  getRegistration,
  getAllRegistrations,
  _resetForTest,
} from "../card-registry";
import type { CardRegistration } from "../card-registry";

// ---- Helpers ----

function makeRegistration(componentId: string): CardRegistration {
  return {
    componentId,
    defaultMeta: { title: `${componentId} card`, closable: true },
  };
}

beforeEach(() => {
  _resetForTest();
});

// ---- T01: registerCard and getRegistration ----

describe("registerCard and getRegistration", () => {
  it("T01: registerCard stores a registration and getRegistration retrieves it", () => {
    const reg = makeRegistration("hello");
    registerCard(reg);
    const retrieved = getRegistration("hello");
    expect(retrieved).toBe(reg);
  });
});

// ---- T02: getRegistration for unregistered component ----

describe("getRegistration for unregistered", () => {
  it("T02: returns undefined for an unregistered componentId", () => {
    const result = getRegistration("nonexistent");
    expect(result).toBeUndefined();
  });
});

// ---- T03: duplicate registration ----

describe("duplicate registerCard", () => {
  it("T03: overwrites existing registration and logs a warning", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});

    const first = makeRegistration("terminal");
    const second = makeRegistration("terminal");
    second.defaultMeta = { title: "Terminal v2", closable: false };

    registerCard(first);
    registerCard(second);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("terminal");

    const retrieved = getRegistration("terminal");
    expect(retrieved).toBe(second);
    expect(retrieved?.defaultMeta.title).toBe("Terminal v2");

    spy.mockRestore();
  });
});

// ---- T04: getAllRegistrations ----

describe("getAllRegistrations", () => {
  it("T04: returns all registered entries", () => {
    const a = makeRegistration("alpha");
    const b = makeRegistration("beta");
    registerCard(a);
    registerCard(b);

    const all = getAllRegistrations();
    expect(all.size).toBe(2);
    expect(all.get("alpha")).toBe(a);
    expect(all.get("beta")).toBe(b);
  });

  it("returns empty map when nothing is registered", () => {
    const all = getAllRegistrations();
    expect(all.size).toBe(0);
  });
});

// ---- T05: _resetForTest ----

describe("_resetForTest", () => {
  it("T05: clears the registry", () => {
    registerCard(makeRegistration("foo"));
    registerCard(makeRegistration("bar"));
    expect(getAllRegistrations().size).toBe(2);

    _resetForTest();
    expect(getAllRegistrations().size).toBe(0);
    expect(getRegistration("foo")).toBeUndefined();
    expect(getRegistration("bar")).toBeUndefined();
  });
});

// ---- Phase 5b3 Step 1: family, acceptsFamilies, defaultTabs, defaultTitle fields ----

describe("CardRegistration – family, acceptsFamilies, defaultTabs, defaultTitle", () => {
  it("registers a card with family and getRegistration returns it", () => {
    registerCard({
      ...makeRegistration("gallery-buttons"),
      family: "developer",
    });
    const reg = getRegistration("gallery-buttons");
    expect(reg).toBeDefined();
    expect(reg!.family).toBe("developer");
  });

  it("registers a card with acceptsFamilies and getRegistration returns it", () => {
    registerCard({
      ...makeRegistration("gallery-host"),
      acceptsFamilies: ["developer"],
    });
    const reg = getRegistration("gallery-host");
    expect(reg).toBeDefined();
    expect(reg!.acceptsFamilies).toEqual(["developer"]);
  });

  it("registers a card with defaultTitle and getRegistration returns it", () => {
    registerCard({
      ...makeRegistration("component-gallery"),
      defaultTitle: "Component Gallery",
    });
    const reg = getRegistration("component-gallery");
    expect(reg).toBeDefined();
    expect(reg!.defaultTitle).toBe("Component Gallery");
  });

  it("registers a card with defaultTabs and getRegistration returns them", () => {
    const defaultTabs = [
      { id: "tmpl-1", componentId: "gallery-buttons", title: "Buttons", closable: false },
      { id: "tmpl-2", componentId: "gallery-chain-actions", title: "Chain Actions", closable: false },
    ] as const;
    registerCard({
      ...makeRegistration("gallery-host-tabs"),
      defaultTabs,
    });
    const reg = getRegistration("gallery-host-tabs");
    expect(reg).toBeDefined();
    expect(reg!.defaultTabs).toBeDefined();
    expect(reg!.defaultTabs!.length).toBe(2);
    expect(reg!.defaultTabs![0].componentId).toBe("gallery-buttons");
    expect(reg!.defaultTabs![1].componentId).toBe("gallery-chain-actions");
  });

  it("fields are all optional: registration without them is valid", () => {
    registerCard(makeRegistration("plain-card"));
    const reg = getRegistration("plain-card");
    expect(reg).toBeDefined();
    expect(reg!.family).toBeUndefined();
    expect(reg!.acceptsFamilies).toBeUndefined();
    expect(reg!.defaultTabs).toBeUndefined();
    expect(reg!.defaultTitle).toBeUndefined();
  });
});
