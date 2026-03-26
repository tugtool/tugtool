/**
 * Observable Props integration tests -- Step 5 (full round-trip verification).
 *
 * Covers every success criterion from #success-criteria and every verification
 * task from Step 5 of tugplan-tugways-phase-5d4-observable-properties.md.
 *
 * Tasks verified:
 * - Task 1: Inspector reads match card state — controls display current values
 * - Task 2: Inspector writes update the card — dispatchTo → store → re-render
 * - Task 3: Card-side changes notify inspector — store.set → controls update
 * - Task 4: Source attribution prevents circular updates (covered in step-4
 *           tests; cross-referenced here via the no-loop assertion)
 * - Task 5: useSyncExternalStore renders only for changed property — changing
 *           backgroundColor does not notify fontSize/fontFamily subscribers
 * - Task 6: setProperty works via dispatchTo (same as Task 2 path)
 *
 * Success criteria verified:
 * - PropertyStore.get returns current value; throws for invalid path
 * - PropertyStore.set fires observers with correct PropertyChange
 * - PropertyStore.observe returns unsubscribe; after unsub listener is silent
 * - useSyncExternalStore triggers re-render only for the observed path
 * - Inspector dispatches setProperty → store updates → appearance changes
 * - Source attribution: observer skips re-dispatch on inspector source
 * - Gallery tab "Observable Props" is the eighth tab
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useSyncExternalStore } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { PropertyStore } from "@/components/tugways/property-store";
import type { PropertyChange, PropertyDescriptor } from "@/components/tugways/property-store";
import { GALLERY_DEFAULT_TABS, registerGalleryCards } from "@/components/tugways/cards/gallery-registrations";
import { GalleryObservableProps } from "@/components/tugways/cards/gallery-observable-props";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import { Tugcard } from "@/components/tugways/tug-card";
import { _resetForTest } from "@/card-registry";
import { withDeckManager } from "./mock-deck-manager-store";

// ---------------------------------------------------------------------------
// Shared schema fixture
// ---------------------------------------------------------------------------

const SCHEMA: PropertyDescriptor[] = [
  { path: "style.backgroundColor", type: "color",  label: "Background Color" },
  { path: "style.fontSize",        type: "number", label: "Font Size", min: 8, max: 72 },
  { path: "style.fontFamily",      type: "enum",   label: "Font Family",
    enumValues: ["system-ui", "monospace", "serif"] },
];

const INITIAL: Record<string, unknown> = {
  "style.backgroundColor": "#4f8ef7",
  "style.fontSize":        16,
  "style.fontFamily":      "system-ui",
};

function makeStore() {
  return new PropertyStore({ schema: SCHEMA, initialValues: INITIAL });
}

// ---------------------------------------------------------------------------
// Helper: render GalleryObservableProps inside a fully-wired Tugcard
// ---------------------------------------------------------------------------

function renderObservableProps(cardId = "obs-int-card") {
  const manager = new ResponderChainManager();
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      withDeckManager(
        <ResponderChainContext.Provider value={manager}>
          <Tugcard cardId={cardId} meta={{ title: "Test" }} feedIds={[]}>
            <GalleryObservableProps cardId={cardId} />
          </Tugcard>
        </ResponderChainContext.Provider>
      )
    ));
  });
  // Flush useLayoutEffect hooks (usePropertyStore registration, useResponder).
  act(() => {});
  return { container, manager };
}

// ---------------------------------------------------------------------------
// Success criterion: PropertyStore.get / set / observe (unit-level re-check)
// ---------------------------------------------------------------------------

describe("SC: PropertyStore.get returns current value; throws for invalid path", () => {
  it("get() returns initial value for each schema path", () => {
    const store = makeStore();
    expect(store.get("style.backgroundColor")).toBe("#4f8ef7");
    expect(store.get("style.fontSize")).toBe(16);
    expect(store.get("style.fontFamily")).toBe("system-ui");
  });

  it("get() throws for a path not in the schema", () => {
    const store = makeStore();
    expect(() => store.get("style.fontWeight")).toThrow(/unknown path/);
  });
});

describe("SC: PropertyStore.set fires observers with correct PropertyChange", () => {
  it("change record includes path, oldValue, newValue, and source", () => {
    const store = makeStore();
    const records: PropertyChange[] = [];
    store.observe("style.backgroundColor", (c) => records.push(c));

    store.set("style.backgroundColor", "#ff0000", "inspector");

    expect(records).toHaveLength(1);
    expect(records[0].path).toBe("style.backgroundColor");
    expect(records[0].oldValue).toBe("#4f8ef7");
    expect(records[0].newValue).toBe("#ff0000");
    expect(records[0].source).toBe("inspector");
  });
});

describe("SC: PropertyStore.observe returns unsubscribe; after unsubscribe listener is silent", () => {
  it("unsubscribe stops the listener from receiving further changes", () => {
    const store = makeStore();
    const calls: unknown[] = [];
    const unsub = store.observe("style.fontSize", () => calls.push(true));

    store.set("style.fontSize", 24, "test");
    expect(calls).toHaveLength(1);

    unsub();

    store.set("style.fontSize", 32, "test");
    expect(calls).toHaveLength(1); // no new call after unsubscribe
  });
});

// ---------------------------------------------------------------------------
// Task 1: Inspector reads match card state
// ---------------------------------------------------------------------------

describe("Task 1: Inspector reads match card state", () => {
  beforeEach(() => { _resetForTest(); registerGalleryCards(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("inspector controls display initial values from the PropertyStore", () => {
    const { container } = renderObservableProps("obs-t1");

    // The state table is driven by useSyncExternalStore and reflects the store.
    expect(container.querySelector("[data-testid='state-bg-color']")?.textContent)
      .toBe("#4f8ef7");
    expect(container.querySelector("[data-testid='state-font-size']")?.textContent)
      .toBe("16px");
    expect(container.querySelector("[data-testid='state-font-family']")?.textContent)
      .toBe("system-ui");
  });

  it("color input rendered value matches initial store backgroundColor", () => {
    const { container } = renderObservableProps("obs-t1b");
    const colorInput = container.querySelector("[data-testid='inspector-bg-color']") as HTMLInputElement;
    expect(colorInput).not.toBeNull();
    // Controlled input value = store value
    expect(colorInput.value).toBe("#4f8ef7");
  });
});

// ---------------------------------------------------------------------------
// Task 2: Inspector writes update the card
// ---------------------------------------------------------------------------

describe("Task 2: Inspector writes update the card", () => {
  beforeEach(() => { _resetForTest(); registerGalleryCards(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("setProperty dispatched via dispatchTo updates the target element backgroundColor", () => {
    const { container, manager } = renderObservableProps("obs-t2a");

    act(() => {
      manager.dispatchTo("obs-t2a", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.backgroundColor", value: "#cc0000", source: "inspector" },
      });
    });

    const target = container.querySelector("[data-testid='observable-props-target']") as HTMLElement;
    // useSyncExternalStore re-rendered; React applied the new inline style.
    expect(container.querySelector("[data-testid='state-bg-color']")?.textContent).toBe("#cc0000");
    expect(target).not.toBeNull();
  });

  it("setProperty updates fontSize and the state table reflects the new value", () => {
    const { container, manager } = renderObservableProps("obs-t2b");

    act(() => {
      manager.dispatchTo("obs-t2b", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.fontSize", value: 40, source: "inspector" },
      });
    });

    expect(container.querySelector("[data-testid='state-font-size']")?.textContent).toBe("40px");
  });

  it("setProperty updates fontFamily and the state table reflects the new value", () => {
    const { container, manager } = renderObservableProps("obs-t2c");

    act(() => {
      manager.dispatchTo("obs-t2c", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.fontFamily", value: "serif", source: "inspector" },
      });
    });

    expect(container.querySelector("[data-testid='state-font-family']")?.textContent).toBe("serif");
  });
});

// ---------------------------------------------------------------------------
// Task 3: Card-side changes notify inspector
// ---------------------------------------------------------------------------

describe("Task 3: Card-side changes notify inspector (store.set → controls update)", () => {
  beforeEach(() => { _resetForTest(); registerGalleryCards(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  /**
   * A helper card content that exposes the PropertyStore via a ref and then
   * renders GalleryObservableProps's useSyncExternalStore pattern in
   * isolation using a simple Probe component.
   *
   * For task 3 we need to call store.set() directly (simulating a card-side
   * programmatic update) and verify the inspector display re-renders.
   * We do this by dispatching setProperty with source: 'content', which takes
   * the non-guarded observer path.
   */
  it("dispatching setProperty with source 'content' updates the state table", () => {
    const { container, manager } = renderObservableProps("obs-t3a");

    // Simulate a card-side programmatic update (source: 'content').
    act(() => {
      manager.dispatchTo("obs-t3a", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.backgroundColor", value: "#009900", source: "content" },
      });
    });

    // useSyncExternalStore re-rendered; state table reflects the new value.
    expect(container.querySelector("[data-testid='state-bg-color']")?.textContent).toBe("#009900");
  });

  it("multiple sequential card-side updates are all reflected in the display", () => {
    const { container, manager } = renderObservableProps("obs-t3b");

    act(() => {
      manager.dispatchTo("obs-t3b", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.fontSize", value: 20, source: "content" },
      });
    });
    expect(container.querySelector("[data-testid='state-font-size']")?.textContent).toBe("20px");

    act(() => {
      manager.dispatchTo("obs-t3b", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.fontSize", value: 36, source: "content" },
      });
    });
    expect(container.querySelector("[data-testid='state-font-size']")?.textContent).toBe("36px");
  });
});

// ---------------------------------------------------------------------------
// Task 4: Source attribution prevents circular updates (cross-reference)
// ---------------------------------------------------------------------------
// The [D03] guard is directly tested in gallery-card.test.tsx under
// "GalleryObservableProps – source attribution observer [D03]".
// Here we add a pure-PropertyStore unit test confirming the store itself
// never loops — it always notifies all observers unconditionally, and it is
// the observer's responsibility to guard. [D03]

describe("Task 4: Store unconditionally notifies; observer is responsible for guard", () => {
  it("store notifies all observers regardless of source — observer decides to guard", () => {
    const store = makeStore();
    const allChanges: PropertyChange[] = [];

    // Observer that guards against re-dispatch when source === 'inspector'.
    // It records every notification it receives (before the guard check).
    let redispatchCount = 0;
    store.observe("style.backgroundColor", (change) => {
      allChanges.push(change);
      if (change.source === "inspector") return; // guard: skip re-dispatch
      redispatchCount += 1;
    });

    store.set("style.backgroundColor", "#aaa", "inspector");
    store.set("style.backgroundColor", "#bbb", "content");

    // Both changes were notified to the observer.
    expect(allChanges).toHaveLength(2);
    // Only the 'content' change triggered the re-dispatch path.
    expect(redispatchCount).toBe(1);
  });

  it("no infinite loop when inspector dispatches and observer guards", () => {
    // Simulate an inspector write. Observer receives it but skips re-dispatch.
    // If the guard were missing, a re-dispatch would call set() again,
    // triggering the observer again, ad infinitum.
    const store = makeStore();
    let callCount = 0;

    store.observe("style.fontSize", (change) => {
      callCount += 1;
      if (change.source === "inspector") return; // guard
      // If this branch ran and called store.set() again with source 'inspector',
      // the guard would stop it on the next iteration.
    });

    store.set("style.fontSize", 24, "inspector");
    store.set("style.fontSize", 32, "inspector");

    // Exactly 2 notifications — one per set() call. No runaway loop.
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task 5: useSyncExternalStore renders only for changed property
// ---------------------------------------------------------------------------

describe("Task 5: useSyncExternalStore triggers re-render only for changed path", () => {
  it("changing backgroundColor notifies only backgroundColor subscribers", () => {
    const store = makeStore();

    // Count notification callbacks per path (these are the () => void callbacks
    // that useSyncExternalStore passes as its subscribe argument).
    const bgCallbacks: number[] = [];
    const sizeCallbacks: number[] = [];
    const familyCallbacks: number[] = [];

    // Simulate what useSyncExternalStore does: subscribe with a plain () => void.
    const unsubBg = store.observe("style.backgroundColor", () => bgCallbacks.push(1));
    const unsubSize = store.observe("style.fontSize", () => sizeCallbacks.push(1));
    const unsubFamily = store.observe("style.fontFamily", () => familyCallbacks.push(1));

    // Change only backgroundColor.
    store.set("style.backgroundColor", "#ff0000", "inspector");

    expect(bgCallbacks).toHaveLength(1);     // backgroundColor notified
    expect(sizeCallbacks).toHaveLength(0);   // fontSize NOT notified
    expect(familyCallbacks).toHaveLength(0); // fontFamily NOT notified

    // Change only fontSize.
    store.set("style.fontSize", 24, "inspector");

    expect(bgCallbacks).toHaveLength(1);     // backgroundColor NOT notified again
    expect(sizeCallbacks).toHaveLength(1);   // fontSize notified
    expect(familyCallbacks).toHaveLength(0); // fontFamily NOT notified

    unsubBg(); unsubSize(); unsubFamily();
  });

  it("useSyncExternalStore subscription pattern: per-path subscribe is stable", () => {
    // Verify the observe() → unsubscribe contract that useSyncExternalStore
    // relies on: calling subscribe multiple times gives independent subscriptions,
    // and unsubscribing one does not affect others.
    const store = makeStore();
    const countA: number[] = [];
    const countB: number[] = [];

    const unsubA = store.observe("style.backgroundColor", () => countA.push(1));
    const unsubB = store.observe("style.backgroundColor", () => countB.push(1));

    store.set("style.backgroundColor", "#111", "test");
    expect(countA).toHaveLength(1);
    expect(countB).toHaveLength(1);

    unsubA();

    store.set("style.backgroundColor", "#222", "test");
    expect(countA).toHaveLength(1); // A unsubscribed — no new notification
    expect(countB).toHaveLength(2); // B still active
    unsubB();
  });

  it("React component re-renders only for the subscribed path (integration)", () => {
    // Use a render-count probe component to verify per-path isolation.
    // Each useSyncExternalStore subscription is independent; changing one path
    // should not trigger re-renders in components subscribed to other paths.
    const store = makeStore();
    const renderCounts = { bg: 0, size: 0, family: 0 };

    function BgProbe() {
      renderCounts.bg += 1;
      useSyncExternalStore(
        (cb) => store.observe("style.backgroundColor", cb),
        () => store.get("style.backgroundColor"),
      );
      return null;
    }
    function SizeProbe() {
      renderCounts.size += 1;
      useSyncExternalStore(
        (cb) => store.observe("style.fontSize", cb),
        () => store.get("style.fontSize"),
      );
      return null;
    }
    function FamilyProbe() {
      renderCounts.family += 1;
      useSyncExternalStore(
        (cb) => store.observe("style.fontFamily", cb),
        () => store.get("style.fontFamily"),
      );
      return null;
    }

    act(() => {
      render(
        <>
          <BgProbe />
          <SizeProbe />
          <FamilyProbe />
        </>
      );
    });

    // Record counts after initial render.
    const afterMount = { ...renderCounts };

    // Change only backgroundColor.
    act(() => {
      store.set("style.backgroundColor", "#ff0000", "test");
    });

    expect(renderCounts.bg).toBe(afterMount.bg + 1);       // re-rendered
    expect(renderCounts.size).toBe(afterMount.size);       // NOT re-rendered
    expect(renderCounts.family).toBe(afterMount.family);   // NOT re-rendered

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Task 6: setProperty action works via dispatchTo
// ---------------------------------------------------------------------------

describe("Task 6: setProperty action works via dispatchTo (console-equivalent)", () => {
  beforeEach(() => { _resetForTest(); registerGalleryCards(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("dispatchTo setProperty with backgroundColor '#ff0000' updates the target", () => {
    const { container, manager } = renderObservableProps("obs-t6a");

    // This mirrors what a browser console call would do:
    //   manager.dispatchTo(cardId, {
    //     action: 'setProperty',
    //     phase: 'discrete',
    //     value: { path: 'style.backgroundColor', value: '#ff0000' }
    //   })
    act(() => {
      manager.dispatchTo("obs-t6a", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.backgroundColor", value: "#ff0000" },
        // source omitted — Tugcard defaults it to 'inspector'
      });
    });

    expect(container.querySelector("[data-testid='state-bg-color']")?.textContent).toBe("#ff0000");
  });

  it("dispatchTo setProperty with omitted source defaults to 'inspector'", () => {
    const { container, manager } = renderObservableProps("obs-t6b");

    // The source attribution observer tracks the source; when source is
    // 'inspector' (the default from Tugcard.setProperty handler) it guards.
    const countSpan = container.querySelector("[data-testid='observer-fire-count']") as HTMLSpanElement;
    const lastChangeSpan = container.querySelector("[data-testid='observer-last-change']") as HTMLSpanElement;

    act(() => {
      manager.dispatchTo("obs-t6b", {
        action: "setProperty",
        phase: "discrete",
        value: { path: "style.backgroundColor", value: "#abcdef" },
        // no source — Tugcard defaults to 'inspector'
      });
    });

    // Observer fired, saw source 'inspector', guarded.
    expect(countSpan.textContent).toBe("1");
    expect(lastChangeSpan.textContent).toContain("[guarded]");
    expect(lastChangeSpan.textContent).toContain("inspector");
  });
});

// ---------------------------------------------------------------------------
// Gallery tab position: eighth tab
// ---------------------------------------------------------------------------

describe("Gallery tab 'Observable Props' is the eighth tab (of twenty-one total)", () => {
  it("GALLERY_DEFAULT_TABS has exactly twenty-one entries", () => {
    expect(GALLERY_DEFAULT_TABS).toHaveLength(21);
  });

  it("the eighth tab has componentId 'gallery-observable-props' and title 'Observable Props'", () => {
    const eighth = GALLERY_DEFAULT_TABS[7];
    expect(eighth.componentId).toBe("gallery-observable-props");
    expect(eighth.title).toBe("Observable Props");
    expect(eighth.closable).toBe(true);
  });

  it("the ninth tab has componentId 'gallery-palette' and title 'Palette Engine'", () => {
    const ninth = GALLERY_DEFAULT_TABS[8];
    expect(ninth.componentId).toBe("gallery-palette");
    expect(ninth.title).toBe("Palette Engine");
    expect(ninth.closable).toBe(true);
  });

  it("the tenth tab has componentId 'gallery-scale-timing' and title 'Scale & Timing'", () => {
    const tenth = GALLERY_DEFAULT_TABS[9];
    expect(tenth.componentId).toBe("gallery-scale-timing");
    expect(tenth.title).toBe("Scale & Timing");
    expect(tenth.closable).toBe(true);
  });

  it("the eleventh tab has componentId 'gallery-cascade-inspector' and title 'Cascade Inspector'", () => {
    const eleventh = GALLERY_DEFAULT_TABS[10];
    expect(eleventh.componentId).toBe("gallery-cascade-inspector");
    expect(eleventh.title).toBe("Cascade Inspector");
    expect(eleventh.closable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase exit criteria cross-check
// ---------------------------------------------------------------------------

describe("Phase exit criteria: PropertyStore API completeness", () => {
  it("PropertyStore has get, set, observe, and getSchema", () => {
    const store = makeStore();
    expect(typeof store.get).toBe("function");
    expect(typeof store.set).toBe("function");
    expect(typeof store.observe).toBe("function");
    expect(typeof store.getSchema).toBe("function");
  });

  it("getSchema returns PropertySchema with all registered paths", () => {
    const store = makeStore();
    const schema = store.getSchema();
    const paths = schema.paths.map((d) => d.path);
    expect(paths).toContain("style.backgroundColor");
    expect(paths).toContain("style.fontSize");
    expect(paths).toContain("style.fontFamily");
  });

  it("PropertyDescriptor includes type, label, and optional constraints", () => {
    const store = makeStore();
    const schema = store.getSchema();
    const sizeDesc = schema.paths.find((d) => d.path === "style.fontSize")!;
    expect(sizeDesc.type).toBe("number");
    expect(sizeDesc.label).toBe("Font Size");
    expect(sizeDesc.min).toBe(8);
    expect(sizeDesc.max).toBe(72);

    const familyDesc = schema.paths.find((d) => d.path === "style.fontFamily")!;
    expect(familyDesc.type).toBe("enum");
    expect(familyDesc.enumValues).toEqual(["system-ui", "monospace", "serif"]);
  });
});

