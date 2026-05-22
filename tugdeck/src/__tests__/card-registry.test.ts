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
  getStackSizePolicy,
  DEFAULT_SIZE_POLICY,
  _resetForTest,
} from "../card-registry";
import type { CardRegistration, CardSizePolicy } from "../card-registry";

// ---- Helpers ----

function makeRegistration(componentId: string): CardRegistration {
  return {
    componentId,
    contentFactory: () => null,
    defaultMeta: { title: `${componentId} card`, closable: true },
  };
}

/** Register a card type carrying an explicit size policy. */
function registerSized(componentId: string, sizePolicy: CardSizePolicy): void {
  registerCard({ ...makeRegistration(componentId), sizePolicy });
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

// ---- Phase 5b3 Step 1: family, acceptsFamilies, defaultCards, defaultTitle fields ----

describe("CardRegistration – family, acceptsFamilies, defaultCards, defaultTitle", () => {
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

  it("registers a card with defaultCards and getRegistration returns them", () => {
    const defaultCards = [
      { id: "tmpl-1", componentId: "gallery-buttons", title: "Buttons", closable: false },
      { id: "tmpl-2", componentId: "gallery-chain-actions", title: "Chain Actions", closable: false },
    ] as const;
    registerCard({
      ...makeRegistration("gallery-host-cards"),
      defaultCards,
    });
    const reg = getRegistration("gallery-host-cards");
    expect(reg).toBeDefined();
    expect(reg!.defaultCards).toBeDefined();
    expect(reg!.defaultCards!.length).toBe(2);
    expect(reg!.defaultCards![0].componentId).toBe("gallery-buttons");
    expect(reg!.defaultCards![1].componentId).toBe("gallery-chain-actions");
  });

  it("fields are all optional: registration without them is valid", () => {
    registerCard(makeRegistration("plain-card"));
    const reg = getRegistration("plain-card");
    expect(reg).toBeDefined();
    expect(reg!.family).toBeUndefined();
    expect(reg!.acceptsFamilies).toBeUndefined();
    expect(reg!.defaultCards).toBeUndefined();
    expect(reg!.defaultTitle).toBeUndefined();
  });
});

// ---- getStackSizePolicy — pane-level aggregation across a stack ----

describe("getStackSizePolicy", () => {
  it("returns DEFAULT_SIZE_POLICY for an empty stack", () => {
    expect(getStackSizePolicy([])).toEqual(DEFAULT_SIZE_POLICY);
  });

  it("takes the element-wise max of the cards' minimums", () => {
    registerSized("wide", {
      min: { width: 800, height: 240 },
      preferred: { width: 900, height: 600 },
    });
    registerSized("tall", {
      min: { width: 300, height: 700 },
      preferred: { width: 400, height: 800 },
    });
    const policy = getStackSizePolicy(["wide", "tall"]);
    expect(policy.min).toEqual({ width: 800, height: 700 });
  });

  it("takes the element-wise min of the cards' defined maximums", () => {
    registerSized("capped", {
      min: { width: 200, height: 150 },
      max: { width: 1000, height: 900 },
      preferred: { width: 400, height: 300 },
    });
    registerSized("tighter", {
      min: { width: 200, height: 150 },
      max: { width: 700, height: 1200 },
      preferred: { width: 400, height: 300 },
    });
    expect(getStackSizePolicy(["capped", "tighter"]).max).toEqual({
      width: 700,
      height: 900,
    });
  });

  it("omits max when every card in the stack is unbounded", () => {
    registerSized("free-a", {
      min: { width: 200, height: 150 },
      preferred: { width: 400, height: 300 },
    });
    registerSized("free-b", {
      min: { width: 250, height: 180 },
      preferred: { width: 400, height: 300 },
    });
    expect(getStackSizePolicy(["free-a", "free-b"]).max).toBeUndefined();
  });

  it("an unbounded card does not relax a bounded sibling's ceiling", () => {
    registerSized("capped", {
      min: { width: 200, height: 150 },
      max: { width: 1000, height: 900 },
      preferred: { width: 400, height: 300 },
    });
    registerSized("free", {
      min: { width: 200, height: 150 },
      preferred: { width: 400, height: 300 },
    });
    expect(getStackSizePolicy(["capped", "free"]).max).toEqual({
      width: 1000,
      height: 900,
    });
  });

  it("treats an unregistered id as DEFAULT_SIZE_POLICY", () => {
    registerSized("narrow", {
      min: { width: 100, height: 100 },
      preferred: { width: 200, height: 200 },
    });
    // DEFAULT_SIZE_POLICY.min (250 × 180) floors the result.
    expect(getStackSizePolicy(["narrow", "ghost"]).min).toEqual(
      DEFAULT_SIZE_POLICY.min,
    );
  });

  it("floors preferred to the aggregated minimum", () => {
    registerSized("wide-min-small-pref", {
      min: { width: 800, height: 600 },
      preferred: { width: 400, height: 300 },
    });
    expect(getStackSizePolicy(["wide-min-small-pref"]).preferred).toEqual({
      width: 800,
      height: 600,
    });
  });
});
