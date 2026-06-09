/**
 * spatial-nav — the spatial arrow navigator over a real `FocusManager` ([P22] /
 * [P23]). Exercises `moveKeyViewSpatial` against a registered focusable set + a
 * declared ring/seam order + a live group cursor handle — no DOM (`focusKeyView`
 * no-ops headless; `setKeyView` mutates the in-memory key view, which is what these
 * assert). The pure resolver itself is pinned by `spatial-order.test.ts`; this pins
 * the engine wiring: ring/seam movement, group cursor delegation, the never-beep
 * edge clamp, the dead-arrow warning ([R06]), and the default-context path ([L26]).
 */

import { describe, expect, test } from "bun:test";

import { BASE_FOCUS_MODE, FocusManager } from "../focus-manager";
import type { SpatialCursorHandle } from "../focus-manager";
import type { SpatialDirection, SpatialOrder } from "../spatial-order";

// The PermissionDialog skeleton: a [deny, allow] button ring + a scope group below
// Allow, reached by a seam. Nodes are referenced by their stable `group:order` key
// (here group "g") — the navigator maps the ringed focusable id to its key ([Q12]).
// Groups are injected live from the handle, so the order declares only rings + seams.
const order: SpatialOrder = {
  rings: [{ axis: "horizontal", nodes: ["g:0", "g:1"], closed: true }], // deny, allow
  seams: [
    { from: "g:1", direction: "down", to: "g:2" }, // allow → scope
    { from: "g:2", direction: "up", to: "g:1" }, // scope → allow
  ],
};

// A minimal stand-in for a group's `useFocusCursor` handle — a 1D index with clamp.
function makeHandle(length: number, start = 0) {
  const state = { index: start, descendable: false, descended: 0 };
  const handle: SpatialCursorHandle = {
    length: () => length,
    cursorIndex: () => state.index,
    moveCursor: (delta) => {
      state.index = Math.max(0, Math.min(length - 1, state.index + delta));
    },
    tryDescendRight: () => {
      if (state.descendable) {
        state.descended += 1;
        return true;
      }
      return false;
    },
  };
  return { handle, state };
}

function setup() {
  const m = new FocusManager();
  const ctx = m.contextFor(null); // the default context — no key card ([L26])
  ctx.registerFocusable({ id: "deny", group: "g", order: 0 });
  ctx.registerFocusable({ id: "allow", group: "g", order: 1 });
  ctx.registerFocusable({ id: "scope", group: "g", order: 2 });
  ctx.registerSpatialOrder(BASE_FOCUS_MODE, order);
  return { m, ctx };
}

describe("moveKeyViewSpatial — ring movement", () => {
  test("Left from allow lands on deny (the reported case), reversibly", () => {
    const { m, ctx } = setup();
    ctx.setKeyView("allow", true);
    expect(m.moveKeyViewSpatial("left")).toBe(true);
    expect(m.keyView()).toBe("deny");
    // Right returns to allow — the author declared both edges (closed ring).
    expect(m.moveKeyViewSpatial("right")).toBe(true);
    expect(m.keyView()).toBe("allow");
  });

  test("a closed ring never beeps — both edges wrap and report consumed", () => {
    const { m, ctx } = setup();
    ctx.setKeyView("allow", true);
    expect(m.moveKeyViewSpatial("right")).toBe(true); // wrap → deny
    expect(m.keyView()).toBe("deny");
    expect(m.moveKeyViewSpatial("left")).toBe(true); // wrap → allow
    expect(m.keyView()).toBe("allow");
  });

  test("a declared seam crosses from the button ring to the scope group", () => {
    const { m, ctx } = setup();
    ctx.setKeyView("allow", true);
    expect(m.moveKeyViewSpatial("down")).toBe(true);
    expect(m.keyView()).toBe("scope");
  });
});

describe("moveKeyViewSpatial — group cursor delegation", () => {
  test("an in-group arrow drives the cursor and keeps the ring on the group", () => {
    const { m, ctx } = setup();
    const { handle, state } = makeHandle(2, 0);
    ctx.registerCursorHandle("scope", handle);
    ctx.setKeyView("scope", true);
    expect(m.moveKeyViewSpatial("down")).toBe(true);
    expect(m.keyView()).toBe("scope"); // ring stayed on the group
    expect(state.index).toBe(1); // cursor advanced
  });

  test("an arrow off the group edge crosses the declared seam", () => {
    const { m, ctx } = setup();
    const { handle } = makeHandle(2, 0); // cursor at the top
    ctx.registerCursorHandle("scope", handle);
    ctx.setKeyView("scope", true);
    expect(m.moveKeyViewSpatial("up")).toBe(true); // off the top → seam → allow
    expect(m.keyView()).toBe("allow");
  });

  test("a group edge in a declared scope falls back to the linear walk (liveliness)", () => {
    const { m, ctx } = setup();
    const { handle } = makeHandle(2, 1); // cursor at the bottom
    ctx.registerCursorHandle("scope", handle);
    ctx.setKeyView("scope", true);
    // Down runs off the end with no down-seam → no spatial target → the linear
    // groupOrder fallback advances: scope is last, so it wraps to the first stop.
    // The arrow never silently swallows ([P23] liveliness).
    expect(m.moveKeyViewSpatial("down")).toBe(true);
    expect(m.keyView()).toBe("deny"); // focusNext(scope=last) wraps to deny (order 0)
  });

  test("a group edge with NO declared order clamps (standalone group, no scroll)", () => {
    const m = new FocusManager();
    const ctx = m.contextFor(null);
    ctx.registerFocusable({ id: "g", group: "grp", order: 0 });
    const { handle, state } = makeHandle(2, 1); // cursor at the bottom
    ctx.registerCursorHandle("g", handle);
    ctx.setKeyView("g", true);
    // No declared spatial order for this mode → the group holds (clamps) rather than
    // walking out; it consumes the arrow so the page does not scroll.
    expect(m.moveKeyViewSpatial("down")).toBe(true);
    expect(m.keyView()).toBe("g");
    expect(state.index).toBe(1);
  });

  test("ArrowRight descends a disclosable item before any spatial movement", () => {
    const { m, ctx } = setup();
    const { handle, state } = makeHandle(2, 0);
    state.descendable = true;
    ctx.registerCursorHandle("scope", handle);
    ctx.setKeyView("scope", true);
    expect(m.moveKeyViewSpatial("right")).toBe(true);
    expect(state.descended).toBe(1);
    expect(m.keyView()).toBe("scope"); // descend is the group's; the ring did not move
  });
});

describe("moveKeyViewSpatial — never-beep boundaries", () => {
  test("an arrow with no spatial target in a declared scope falls back to the linear walk", () => {
    const { m, ctx } = setup();
    ctx.setKeyView("deny", true); // deny is on the horizontal ring; Up is undeclared
    // Up has no ring (vertical) / seam / override from deny → the liveliness fallback
    // retreats one stop in groupOrder (deny is first, so it wraps to the last). The
    // arrow moves the ring and reports consumed — never a beep, never not-consumed.
    expect(m.moveKeyViewSpatial("up")).toBe(true);
    expect(m.keyView()).toBe("scope"); // focusPrevious(deny=first) wraps to scope (order 2)
  });

  test("with no declared order and no group, the arrow is not the navigator's", () => {
    const m = new FocusManager();
    const ctx = m.contextFor(null);
    ctx.registerFocusable({ id: "btn", group: "g", order: 0 });
    ctx.setKeyView("btn", true);
    for (const dir of ["up", "down", "left", "right"] as SpatialDirection[]) {
      expect(m.moveKeyViewSpatial(dir)).toBe(false);
    }
    expect(m.keyView()).toBe("btn");
  });

  test("no key view → nothing to move", () => {
    const { m } = setup();
    expect(m.moveKeyViewSpatial("left")).toBe(false);
  });
});
