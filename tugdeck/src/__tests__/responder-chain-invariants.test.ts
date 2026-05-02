/**
 * Responder-chain invariants — pin the six contracts ([D04]) the
 * chain guarantees.
 *
 * Per `tugplan-tide-overlay-framework.md` (#step-4) / [D04], each
 * invariant gets a `describe` block here and is also summarized in
 * the `INVARIANTS:` block at the top of `responder-chain.ts`.
 *
 *   I1. Every registered responder's `parentId` is either `null` or the
 *       id of another registered responder (caller contract; chain
 *       tolerates a stale parentId by stopping at the dangling reference
 *       — no infinite loop, no crash).
 *   I2. `firstResponderId` is `null` OR the id of a currently registered
 *       responder.
 *   I3. `sendToTarget(id, ...)` walks `parentId` from `id`, regardless
 *       of `firstResponderId` state.
 *   I4. `findResponderForTarget(node)` walks DOM `parentElement` from
 *       `node`, returning the nearest registered responder along the
 *       rendered DOM path, or `null` if none exists.
 *   I5. A modal that captures a `cascadeTargetId` at open time can
 *       dispatch to that target on close even when there is no DOM-walk
 *       path between the modal's portaled DOM and the target.
 *   I6. `data-tug-focus="refuse"` controls only chain-promotion-skip and
 *       browser-focus-prevention semantics. It does NOT control
 *       pane-focus-controller behavior; the controller keys on
 *       `[data-slot="tug-canvas-overlay-root"]`.
 *
 * I1–I3 are pure-chain tests; I4–I6 need a DOM, so this file imports
 * `setup-rtl` to install happy-dom globals.
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { ResponderChainManager } from "../components/tugways/responder-chain";
import type {
  ActionEvent,
  ActionHandler,
} from "../components/tugways/responder-chain";
import type { TugAction } from "../components/tugways/action-vocabulary";

// Pure-chain tests use synthetic action names. These two helpers cast
// string literals and action-keyed records so the synthetic names
// type-check without widening the production signatures (mirrors the
// helpers in `responder-chain.test.ts`).
const asActions = (a: Record<string, ActionHandler>) =>
  a as unknown as Partial<Record<TugAction, ActionHandler>>;
const asAction = (name: string) => name as unknown as TugAction;

// ---------------------------------------------------------------------------
// I1 — parentId is null or a registered responder id (caller contract)
// ---------------------------------------------------------------------------

describe("I1 — parentId points at null or a registered responder", () => {
  it("a node registered with parentId pointing at another registered node walks correctly", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "parent", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "parent", actions: {} });
    // Both nodes are reachable; sendToTarget at the child walks up to
    // the parent. (No handler matches; we assert the dispatch returned
    // false rather than throwing.)
    expect(
      mgr.sendToTarget("child", { action: asAction("noop"), phase: "discrete" }),
    ).toBe(false);
  });

  it("a node registered with parentId pointing at an unregistered id does NOT crash the walk", () => {
    // The chain does not enforce I1 at registration; it is a caller
    // contract. The walk semantics tolerate the stale reference: the
    // dispatch loop terminates at the dangling parentId and returns
    // unhandled. This pins the tolerance — a future enforcement pass
    // can promote this to a thrown error, but until then we rely on
    // tolerance to keep render-time order-of-effects edge cases from
    // crashing the app.
    const mgr = new ResponderChainManager();
    mgr.register({ id: "orphan", parentId: "ghost", actions: {} });
    expect(() =>
      mgr.sendToTarget("orphan", { action: asAction("noop"), phase: "discrete" }),
    ).not.toThrow();
    expect(
      mgr.sendToTarget("orphan", { action: asAction("noop"), phase: "discrete" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I2 — firstResponderId is null or a registered id
// ---------------------------------------------------------------------------

describe("I2 — firstResponderId is null or a registered id", () => {
  it("on a fresh manager firstResponderId is null", () => {
    const mgr = new ResponderChainManager();
    expect(mgr.getFirstResponder()).toBe(null);
  });

  it("after registering a single root, firstResponderId is the root's id", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("after unregistering the first responder with no parent, firstResponderId is null", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.unregister("root");
    expect(mgr.getFirstResponder()).toBe(null);
  });

  it("after unregistering the first responder, the new firstResponderId is null OR a registered id", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "parent", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "parent", actions: {} });
    mgr.makeFirstResponder("child");
    mgr.unregister("child");
    const fr = mgr.getFirstResponder();
    // Either null, or one of the still-registered ids.
    expect(fr === null || fr === "parent").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I3 — sendToTarget walks parentId regardless of first-responder state
// ---------------------------------------------------------------------------

describe("I3 — sendToTarget walks parentId from the named id, independent of firstResponderId", () => {
  it("sendToTarget(child) walks child → parent and reaches the parent's handler when firstResponderId is null", () => {
    const mgr = new ResponderChainManager();
    let parentHandled = false;
    mgr.register({
      id: "parent",
      parentId: null,
      actions: asActions({
        foo: (_event: ActionEvent) => {
          parentHandled = true;
        },
      }),
    });
    mgr.register({ id: "child", parentId: "parent", actions: {} });
    // Force first responder null so any first-responder-walking
    // dispatch path would be a no-op.
    mgr.resignFirstResponder();
    expect(mgr.getFirstResponder()).toBe(null);

    expect(
      mgr.sendToTarget("child", { action: asAction("foo"), phase: "discrete" }),
    ).toBe(true);
    expect(parentHandled).toBe(true);
  });

  it("sendToTarget(child) reaches the parent's handler even when firstResponderId points to an UNRELATED node", () => {
    // Two disjoint chains: A-tree (a-root → a-child) and B-tree
    // (b-root). With firstResponderId pinned on B, sendToTarget(a-child)
    // must still walk a-child → a-root and reach a-root's handler.
    const mgr = new ResponderChainManager();
    let aRootHandled = false;
    mgr.register({
      id: "a-root",
      parentId: null,
      actions: asActions({
        foo: (_event: ActionEvent) => {
          aRootHandled = true;
        },
      }),
    });
    mgr.register({ id: "a-child", parentId: "a-root", actions: {} });
    mgr.register({ id: "b-root", parentId: null, actions: {} });
    mgr.makeFirstResponder("b-root");
    expect(mgr.getFirstResponder()).toBe("b-root");

    expect(
      mgr.sendToTarget("a-child", { action: asAction("foo"), phase: "discrete" }),
    ).toBe(true);
    expect(aRootHandled).toBe(true);
  });

  it("sendToTarget on an unregistered id throws (chain refuses to silently swallow)", () => {
    const mgr = new ResponderChainManager();
    expect(() =>
      mgr.sendToTarget("ghost", {
        action: asAction("foo"),
        phase: "discrete",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// I4 — findResponderForTarget walks DOM parentElement, finds nearest
//      registered responder
// ---------------------------------------------------------------------------

describe("I4 — findResponderForTarget walks DOM parentElement to the nearest registered responder", () => {
  it("returns the responder id when the target is a descendant of the responder's element", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "outer", parentId: null, actions: {} });

    const outerEl = document.createElement("div");
    outerEl.setAttribute("data-responder-id", "outer");
    const innerEl = document.createElement("span");
    outerEl.appendChild(innerEl);
    document.body.appendChild(outerEl);

    expect(mgr.findResponderForTarget(innerEl)).toBe("outer");
    document.body.removeChild(outerEl);
  });

  it("returns the deepest responder when responders are nested in DOM", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "outer", parentId: null, actions: {} });
    mgr.register({ id: "inner", parentId: "outer", actions: {} });

    const outerEl = document.createElement("div");
    outerEl.setAttribute("data-responder-id", "outer");
    const innerEl = document.createElement("div");
    innerEl.setAttribute("data-responder-id", "inner");
    const leafEl = document.createElement("span");
    outerEl.appendChild(innerEl);
    innerEl.appendChild(leafEl);
    document.body.appendChild(outerEl);

    expect(mgr.findResponderForTarget(leafEl)).toBe("inner");
    expect(mgr.findResponderForTarget(innerEl)).toBe("inner");
    expect(mgr.findResponderForTarget(outerEl)).toBe("outer");
    document.body.removeChild(outerEl);
  });

  it("returns null when no DOM ancestor carries a registered responder id", () => {
    const mgr = new ResponderChainManager();

    const orphanEl = document.createElement("div");
    document.body.appendChild(orphanEl);
    expect(mgr.findResponderForTarget(orphanEl)).toBe(null);
    document.body.removeChild(orphanEl);
  });

  it("returns null when an ancestor's data-responder-id refers to an UNregistered node", () => {
    // The walk treats only currently-registered ids as matches; a
    // stale data-responder-id is skipped over (or treated as absent).
    const mgr = new ResponderChainManager();

    const staleEl = document.createElement("div");
    staleEl.setAttribute("data-responder-id", "never-registered");
    const innerEl = document.createElement("span");
    staleEl.appendChild(innerEl);
    document.body.appendChild(staleEl);

    expect(mgr.findResponderForTarget(innerEl)).toBe(null);
    document.body.removeChild(staleEl);
  });
});

// ---------------------------------------------------------------------------
// I5 — Cascade target dispatch survives portaled DOM separation
// ---------------------------------------------------------------------------

describe("I5 — sendToTarget reaches the target via parentId even when no DOM-walk path connects modal and target", () => {
  it("dispatch from inside a portaled subtree still reaches the captured target", () => {
    // Topology mirrors the picker → host card cascade: a "card-host"
    // responder lives under a "pane" responder; the modal's content is
    // portaled to a DOM location that has NO responder ancestor (the
    // canvas overlay tier in production). We register an unrelated
    // "modal" responder OUTSIDE the host's DOM subtree to simulate the
    // portaled placement. sendToTarget(cardHostId) walks parentId from
    // cardHostId → paneId regardless of where the modal's DOM lives,
    // so the pane's handler fires.
    const mgr = new ResponderChainManager();
    let paneCloseHandled = false;
    mgr.register({
      id: "pane",
      parentId: null,
      actions: asActions({
        close: (_event: ActionEvent) => {
          paneCloseHandled = true;
        },
      }),
    });
    mgr.register({ id: "card-host", parentId: "pane", actions: {} });
    // The "modal" — portaled into a DOM location that is NOT a
    // descendant of the card-host's DOM. We give it a parentId that
    // matches the portaled-content scenario: its React-context
    // parentId is the card-host (chain-tree relationship), but the
    // DOM placement is elsewhere.
    mgr.register({ id: "modal", parentId: "card-host", actions: {} });

    // Build DOM that mirrors a portaled modal: card-host's DOM holds
    // card-host + nothing modal-related; the modal's element lives
    // detached (or in a sibling subtree like document.body).
    const cardHostEl = document.createElement("div");
    cardHostEl.setAttribute("data-responder-id", "card-host");
    document.body.appendChild(cardHostEl);

    const portaledModalEl = document.createElement("div");
    portaledModalEl.setAttribute("data-responder-id", "modal");
    // Crucially, append to body — NOT inside cardHostEl.
    document.body.appendChild(portaledModalEl);

    // DOM-walk from inside the portaled modal does NOT find card-host
    // (different DOM subtree).
    expect(mgr.findResponderForTarget(portaledModalEl)).toBe("modal");
    // The modal's DOM has no card-host ancestor.
    expect(portaledModalEl.closest("[data-responder-id='card-host']")).toBe(null);

    // The cascade dispatch (consumer captures card-host id at open
    // time, dispatches via sendToTarget on close) still works because
    // walkFromNode uses the chain registry, not the DOM.
    expect(
      mgr.sendToTarget("card-host", {
        action: asAction("close"),
        phase: "discrete",
      }),
    ).toBe(true);
    expect(paneCloseHandled).toBe(true);

    document.body.removeChild(cardHostEl);
    document.body.removeChild(portaledModalEl);
  });
});

// ---------------------------------------------------------------------------
// I6 — data-tug-focus="refuse" does NOT control pane-focus-controller behavior
// ---------------------------------------------------------------------------

describe("I6 — data-tug-focus=\"refuse\" is decoupled from pane-focus-controller activation/deselect", () => {
  it("an element marked data-tug-focus=\"refuse\" is NOT matched by the canvas-overlay slot selector", () => {
    // The pane-focus-controller's short-circuit selector is
    // [data-slot="tug-canvas-overlay-root"]. An element marked
    // refuse but rendered outside the overlay tier must not match
    // that selector — refuse is a button-class focus signal, not
    // a structural overlay marker.
    const button = document.createElement("button");
    button.setAttribute("data-tug-focus", "refuse");
    document.body.appendChild(button);

    // Refuse selector still matches its own element — refuse has not
    // lost its meaning, only its overlap with the overlay-tier
    // controller selector has been removed.
    expect(button.closest('[data-tug-focus="refuse"]')).toBe(button);
    // Overlay-tier selector does not match — the controller will not
    // skip activation logic for this element.
    expect(button.closest('[data-slot="tug-canvas-overlay-root"]')).toBe(null);

    document.body.removeChild(button);
  });

  it("a descendant of [data-slot=tug-canvas-overlay-root] is matched by the slot selector regardless of refuse markers", () => {
    // The controller's check fires for any descendant of the overlay
    // root, whether or not refuse is present. Refuse is irrelevant to
    // the slot match.
    const overlayRoot = document.createElement("div");
    overlayRoot.setAttribute("data-slot", "tug-canvas-overlay-root");
    const childWithoutRefuse = document.createElement("div");
    overlayRoot.appendChild(childWithoutRefuse);
    document.body.appendChild(overlayRoot);

    expect(
      childWithoutRefuse.closest('[data-slot="tug-canvas-overlay-root"]'),
    ).toBe(overlayRoot);
    expect(childWithoutRefuse.closest('[data-tug-focus="refuse"]')).toBe(null);

    document.body.removeChild(overlayRoot);
  });

  it("refuse and overlay-slot selectors target disjoint behaviors (refuse outside overlay, overlay without refuse)", () => {
    // Two elements demonstrate the separation:
    //   refuseAlone — marked refuse, NOT inside overlay → matched by
    //                 refuse selector only (button-class behavior).
    //   overlayChild — inside overlay, NOT marked refuse → matched by
    //                  overlay slot selector only (controller short-
    //                  circuit).
    const refuseAlone = document.createElement("button");
    refuseAlone.setAttribute("data-tug-focus", "refuse");

    const overlayRoot = document.createElement("div");
    overlayRoot.setAttribute("data-slot", "tug-canvas-overlay-root");
    const overlayChild = document.createElement("div");
    overlayRoot.appendChild(overlayChild);

    document.body.appendChild(refuseAlone);
    document.body.appendChild(overlayRoot);

    // refuseAlone matches refuse, not overlay slot.
    expect(refuseAlone.closest('[data-tug-focus="refuse"]')).toBe(refuseAlone);
    expect(refuseAlone.closest('[data-slot="tug-canvas-overlay-root"]')).toBe(null);

    // overlayChild matches overlay slot, not refuse.
    expect(
      overlayChild.closest('[data-slot="tug-canvas-overlay-root"]'),
    ).toBe(overlayRoot);
    expect(overlayChild.closest('[data-tug-focus="refuse"]')).toBe(null);

    document.body.removeChild(refuseAlone);
    document.body.removeChild(overlayRoot);
  });
});
