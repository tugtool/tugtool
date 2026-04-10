/**
 * unregister recovery — DOM-walk fallback when an ancestor responder
 * unregisters before its descendants.
 *
 * Regression for the ⇧⌘[ / ⇧⌘] tab navigation bug observed in the
 * Component Gallery card. The card had eight tabs; the second tab
 * (Prompt Input) wraps a `tug-prompt-input` inside a
 * `useResponderForm` ResponderScope. The chain on that tab is:
 *
 *   canvas → card → form-responder → tug-prompt-input
 *
 * Pressing ⇧⌘] from tab 1 advanced to tab 2 correctly. Then pressing
 * ⇧⌘] from tab 2 advanced to tab 3 — but as part of tab 2's unmount,
 * the `[responder-chain] first responder cleared` log fired and
 * subsequent ⇧⌘] presses produced `(unhandled)` dispatches with no
 * tab change. The keyboard shortcut became a no-op until a click
 * promoted a new first responder.
 *
 * Root cause: React's useLayoutEffect cleanup order during a
 * multi-level unmount is not strictly child-to-parent in this
 * nesting. The form responder's effect cleanup ran BEFORE the prompt
 * input's cleanup. By the time the prompt input unregistered, its
 * captured `parentId` (= the form responder's id) was no longer in
 * `nodes`, and the previous one-level promotion logic in
 * `unregister()` set `firstResponderId = null` instead of walking
 * further up to the still-mounted card.
 *
 * Fix: walk DOM ancestors of the unregistering element via
 * `findResponderForTarget`, which checks `this.nodes.has(id)` and so
 * naturally skips ancestors that already unregistered earlier in the
 * same cleanup pass. The DOM is the truth source during cleanup —
 * React removes nodes only after effect cleanups run, so the
 * unregistering element and all its ancestors are still in the
 * document.
 *
 * Tests below reproduce the scenario in two ways:
 * 1. Unit-level: register card → form → editor in the manager, set
 *    editor as first responder, unregister the form first, then the
 *    editor. Without the fix, firstResponder = null. With the fix,
 *    firstResponder = card.
 * 2. Coverage of the no-DOM fallback: register parent → child without
 *    DOM elements. The DOM walk yields nothing, the captured-parentId
 *    fallback path takes over and correctly promotes to the parent.
 */

import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { ResponderChainManager } from "@/components/tugways/responder-chain";

describe("unregister — DOM-walk parent recovery", () => {
  it("walks DOM ancestors when the captured parentId already unregistered", () => {
    const mgr = new ResponderChainManager();

    // Build a DOM tree mirroring the responder hierarchy. The chain's
    // unregister() walks DOM via findResponderForTarget, which reads
    // `data-responder-id` attributes — so the test must put real
    // elements in the document.
    const cardEl = document.createElement("div");
    cardEl.setAttribute("data-responder-id", "card");
    const formEl = document.createElement("div");
    formEl.setAttribute("data-responder-id", "form");
    const editorEl = document.createElement("div");
    editorEl.setAttribute("data-responder-id", "editor");
    cardEl.appendChild(formEl);
    formEl.appendChild(editorEl);
    document.body.appendChild(cardEl);

    try {
      mgr.register({ id: "card", parentId: null, actions: {} });
      mgr.register({ id: "form", parentId: "card", actions: {} });
      mgr.register({ id: "editor", parentId: "form", actions: {} });
      mgr.makeFirstResponder("editor");
      expect(mgr.getFirstResponder()).toBe("editor");

      // Unmount the form responder FIRST (the wrapper effect cleanup
      // runs before the inner editor's cleanup in this nesting).
      // firstResponder is still "editor", so this call doesn't change
      // it — the no-op-on-non-first-responder branch in unregister().
      mgr.unregister("form");
      expect(mgr.getFirstResponder()).toBe("editor");

      // Now unmount the editor. Its captured parentId ("form") is no
      // longer in `nodes`. The DOM walk must skip past `form` and
      // find the still-registered card. Without the fix this
      // expectation fails with `null`.
      mgr.unregister("editor");
      expect(mgr.getFirstResponder()).toBe("card");
    } finally {
      document.body.removeChild(cardEl);
    }
  });

  it("falls back to captured parentId when DOM walk yields nothing", () => {
    // The DOM walk is the primary path, but for environments where
    // the unregistering element has no matching `data-responder-id`
    // in the document, the chain falls back to the captured
    // parentId. This test exercises the fallback by registering nodes
    // WITHOUT placing matching DOM elements — findResponderForTarget
    // returns null, and the captured-parentId promotion takes over.
    const mgr = new ResponderChainManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    mgr.register({ id: "child", parentId: "root", actions: {} });
    mgr.makeFirstResponder("child");
    expect(mgr.getFirstResponder()).toBe("child");

    mgr.unregister("child");
    expect(mgr.getFirstResponder()).toBe("root");
  });

  it("clears firstResponderId when neither DOM walk nor captured parentId yields a registered ancestor", () => {
    // Final fallback: a true root responder (no parent, no ancestor
    // responder in the DOM). Unregistering it must clear
    // firstResponderId to null.
    const mgr = new ResponderChainManager();
    mgr.register({ id: "root", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("root");
    mgr.unregister("root");
    expect(mgr.getFirstResponder()).toBe(null);
  });
});
