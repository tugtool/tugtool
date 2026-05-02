/**
 * `manager.focusResponder(id)` unit tests.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 3 / [D03] / [D04] /
 * (#focus-contract). The chain's new public method closes the
 * gap between chain-state (firstResponderId) and DOM focus
 * (document.activeElement). Three branches:
 *
 *   1. Registered responder *with* substrate focus callback —
 *      `makeFirstResponder(id)` runs; `node.focus()` runs; DOM
 *      walk does NOT run.
 *   2. Registered responder *without* substrate callback —
 *      `makeFirstResponder(id)` runs; chain queries
 *      `[data-responder-id="<id>"]` and focuses the element (or
 *      its first tabbable descendant).
 *   3. Unregistered id — no-op + dev-mode warn.
 *
 * The editor's `focus: () => view.focus()` integration touchpoint
 * — a real CM6 EditorView under a real TugTextEditor with the
 * chain provider mounted, asserted via `document.activeElement
 * === view.contentDOM` — is happy-dom-unsafe per the project's
 * happy-dom scoping rule (no focus/selection assertions across
 * React renders). That assertion is covered by the upcoming
 * app-test added in Step 5 (image 5 close path: open `@`
 * completion → click font picker → pick font → next keystroke
 * lands in the editor). The "wiring through the hook" half of
 * the integration is asserted here directly: the test suite
 * "useOptionalResponder forwards focus option" registers via
 * the React hook, dispatches `focusResponder` through the
 * manager, and verifies the supplied callback fired. The CM6-
 * specific half (real `view.focus()` lands on `view.contentDOM`)
 * is the app-test's job.
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import {
  ResponderChainManager,
  ResponderChainContext,
} from "../components/tugways/responder-chain";
import type {
  ActionEvent,
  ActionHandler,
} from "../components/tugways/responder-chain";
import type { TugAction } from "../components/tugways/action-vocabulary";
import { useOptionalResponder } from "../components/tugways/use-responder";

// Synthetic-action helpers (mirror `responder-chain.test.ts`).
const _asActions = (a: Record<string, ActionHandler>) =>
  a as unknown as Partial<Record<TugAction, ActionHandler>>;
const _asAction = (name: string) => name as unknown as TugAction;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Branch 1 — substrate-supplied focus callback
// ---------------------------------------------------------------------------

describe("manager.focusResponder(id) — substrate focus callback present", () => {
  it("invokes node.focus() and promotes id to first responder", () => {
    const mgr = new ResponderChainManager();
    let focusCalls = 0;
    mgr.register({
      id: "editor",
      parentId: null,
      actions: {},
      focus: () => {
        focusCalls += 1;
      },
    });

    // Pre-condition: auto-promoted root is first responder.
    expect(mgr.getFirstResponder()).toBe("editor");
    // Reset to a known different state so we observe the promotion
    // happening as part of focusResponder, not from auto-promotion.
    mgr.resignFirstResponder();
    expect(mgr.getFirstResponder()).toBe(null);
    expect(focusCalls).toBe(0);

    mgr.focusResponder("editor");

    expect(mgr.getFirstResponder()).toBe("editor");
    expect(focusCalls).toBe(1);
  });

  it("runs makeFirstResponder BEFORE node.focus (subscribers see id flip first)", () => {
    // Order matters: dispatchObservers / firstResponder subscribers
    // must observe the chain's record updating before any DOM focus
    // event the substrate callback might trigger. Verified by
    // recording the firstResponderId at the moment node.focus runs;
    // it must already be the new id.
    const mgr = new ResponderChainManager();
    const observed: { firstResponder: string | null | undefined } = {
      firstResponder: undefined,
    };
    mgr.register({
      id: "child",
      parentId: null,
      actions: {},
      focus: () => {
        observed.firstResponder = mgr.getFirstResponder();
      },
    });
    mgr.resignFirstResponder();

    mgr.focusResponder("child");

    expect(observed.firstResponder).toBe("child");
  });

  it("does NOT walk the DOM when a focus callback is present", () => {
    // Set up an element with a button descendant; if the DOM walk
    // ran, the button would receive focus and we could observe that
    // via document.activeElement. The callback path must skip DOM
    // entirely, so document.activeElement stays where it was.
    const mgr = new ResponderChainManager();
    const host = document.createElement("div");
    host.setAttribute("data-responder-id", "with-callback");
    const button = document.createElement("button");
    button.textContent = "decoy";
    host.appendChild(button);
    document.body.appendChild(host);

    let callbackInvoked = false;
    mgr.register({
      id: "with-callback",
      parentId: null,
      actions: {},
      focus: () => {
        callbackInvoked = true;
      },
    });
    mgr.resignFirstResponder();

    // Pre-condition: nothing focused.
    (document.activeElement as HTMLElement | null)?.blur?.();

    mgr.focusResponder("with-callback");

    expect(callbackInvoked).toBe(true);
    // The DOM walk would have focused the button; it must not have run.
    expect(document.activeElement).not.toBe(button);

    document.body.removeChild(host);
  });
});

// ---------------------------------------------------------------------------
// Branch 2 — DOM-walk fallback
// ---------------------------------------------------------------------------

describe("manager.focusResponder(id) — DOM-walk fallback when no callback", () => {
  it("focuses an intrinsically focusable responder element directly", () => {
    const mgr = new ResponderChainManager();
    const button = document.createElement("button");
    button.setAttribute("data-responder-id", "btn");
    button.textContent = "Click me";
    document.body.appendChild(button);

    mgr.register({ id: "btn", parentId: null, actions: {} });
    mgr.resignFirstResponder();

    mgr.focusResponder("btn");

    expect(mgr.getFirstResponder()).toBe("btn");
    expect(document.activeElement).toBe(button);

    document.body.removeChild(button);
  });

  it("focuses an element that declares tabindex >= 0 directly (not its descendants)", () => {
    // A wrapper div with `tabindex="0"` is the intended focus target;
    // its descendant button must NOT win the focus race.
    const mgr = new ResponderChainManager();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-responder-id", "wrapper");
    wrapper.setAttribute("tabindex", "0");
    const inner = document.createElement("button");
    inner.textContent = "inner";
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    mgr.register({ id: "wrapper", parentId: null, actions: {} });
    mgr.resignFirstResponder();

    mgr.focusResponder("wrapper");

    expect(document.activeElement).toBe(wrapper);
    expect(document.activeElement).not.toBe(inner);

    document.body.removeChild(wrapper);
  });

  it("falls through to the first tabbable descendant when the responder element itself is not focusable", () => {
    const mgr = new ResponderChainManager();
    const host = document.createElement("div");
    host.setAttribute("data-responder-id", "host");
    const intro = document.createElement("p"); // not focusable
    intro.textContent = "intro";
    const action = document.createElement("button");
    action.textContent = "action";
    host.appendChild(intro);
    host.appendChild(action);
    document.body.appendChild(host);

    mgr.register({ id: "host", parentId: null, actions: {} });
    mgr.resignFirstResponder();

    mgr.focusResponder("host");

    expect(document.activeElement).toBe(action);

    document.body.removeChild(host);
  });

  it("skips elements with tabindex=\"-1\" when scanning for the first tabbable descendant", () => {
    const mgr = new ResponderChainManager();
    const host = document.createElement("div");
    host.setAttribute("data-responder-id", "host");
    const skipped = document.createElement("div");
    skipped.setAttribute("tabindex", "-1");
    skipped.textContent = "skipped";
    const winner = document.createElement("button");
    winner.textContent = "winner";
    host.appendChild(skipped);
    host.appendChild(winner);
    document.body.appendChild(host);

    mgr.register({ id: "host", parentId: null, actions: {} });
    mgr.resignFirstResponder();

    mgr.focusResponder("host");

    expect(document.activeElement).toBe(winner);

    document.body.removeChild(host);
  });

  it("no-ops cleanly when the responder's element is not in the document", () => {
    // A responder registered before its DOM element committed (or
    // after a detach race) should not crash focusResponder; the chain
    // record updates, the DOM step silently skips.
    const mgr = new ResponderChainManager();
    mgr.register({ id: "detached", parentId: null, actions: {} });
    mgr.resignFirstResponder();

    expect(() => mgr.focusResponder("detached")).not.toThrow();
    expect(mgr.getFirstResponder()).toBe("detached");
  });

  it("promotes id to first responder regardless of whether DOM focus lands successfully", () => {
    // Even when there's no element to focus (registered but not yet
    // attached), the chain record updates. Subscribers that observe
    // the chain learn about the id promotion; only the DOM side-
    // effect is missing.
    const mgr = new ResponderChainManager();
    mgr.register({ id: "x", parentId: null, actions: {} });
    mgr.register({ id: "y", parentId: null, actions: {} });
    mgr.makeFirstResponder("y");

    mgr.focusResponder("x");

    expect(mgr.getFirstResponder()).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// Branch 3 — unregistered id
// ---------------------------------------------------------------------------

describe("manager.focusResponder(id) — unregistered id", () => {
  it("is a no-op (does not promote, does not throw, dev-mode warns)", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "real", parentId: null, actions: {} });
    expect(mgr.getFirstResponder()).toBe("real");

    // Capture console.warn so we can assert the dev-mode signal
    // fired without flooding test output.
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    expect(() => mgr.focusResponder("ghost")).not.toThrow();

    console.warn = originalWarn;

    // Chain unchanged.
    expect(mgr.getFirstResponder()).toBe("real");
    // Dev warn fired once with the expected message shape.
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][0])).toContain("focusResponder");
    expect(String(warnCalls[0][0])).toContain("ghost");
  });
});

// ---------------------------------------------------------------------------
// React-integration touchpoint — useOptionalResponder forwards focus option
// ---------------------------------------------------------------------------

describe("useOptionalResponder forwards focus option onto the registered node", () => {
  it("focusResponder dispatches the substrate callback through the registered node", () => {
    // Mounts a tiny consumer that calls useOptionalResponder with a
    // recorded focus callback. After mount, dispatches
    // focusResponder via the manager from outside React; verifies
    // the consumer's callback fired. This pins the option-forwarding
    // wiring without needing a real editor — the editor's CM6
    // `view.focus()` integration is the app-test's job per the
    // module docstring above.
    const mgr = new ResponderChainManager();
    let focusCalls = 0;

    function Consumer() {
      const { responderRef, ResponderScope } = useOptionalResponder({
        id: "harness-responder",
        actions: {},
        focus: () => {
          focusCalls += 1;
        },
      });
      return (
        <div ref={responderRef as (el: HTMLDivElement | null) => void}>
          <ResponderScope>
            <span>body</span>
          </ResponderScope>
        </div>
      );
    }

    render(
      <ResponderChainContext.Provider value={mgr}>
        <Consumer />
      </ResponderChainContext.Provider>,
    );

    // After mount, the responder is registered and (because it is a
    // root, and the manager started with no first responder) auto-
    // promoted. Reset to a known state so the assertion observes
    // the new promotion.
    mgr.resignFirstResponder();
    expect(focusCalls).toBe(0);

    mgr.focusResponder("harness-responder");

    expect(mgr.getFirstResponder()).toBe("harness-responder");
    expect(focusCalls).toBe(1);
  });
});
