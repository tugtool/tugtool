/**
 * R1 invariant tests — findResponderForTarget + document-level
 * first-responder promotion via pointerdown and focusin.
 *
 * These tests exercise the specific architectural invariant introduced
 * in Phase R1 of the responder chain integration audit: the innermost
 * registered responder under an event target becomes first responder,
 * driven by a document-level capture-phase listener in
 * ResponderChainProvider that walks the DOM via
 * ResponderChainManager.findResponderForTarget().
 *
 * Coverage:
 * 1. findResponderForTarget unit tests against a handcrafted DOM tree:
 *    - Returns innermost registered responder id.
 *    - Returns null when no ancestor carries data-responder-id.
 *    - Ignores data-responder-id values that are not registered.
 *    - Walks correctly from Text nodes (uses parentElement).
 * 2. Integration tests with a real provider:
 *    - pointerdown inside a nested responder promotes the innermost one,
 *      not the enclosing card-like ancestor.
 *    - focusin (Tab navigation) promotes the innermost responder without
 *      requiring a pointer interaction.
 *    - Clicking a child of a responder that itself has no registration
 *      promotes the nearest enclosing responder.
 *
 * See: roadmap/responder-chain-integration-audit.md Part 8 Phase A1
 * item 3 ("R1 invariant test — fixes Hole 7").
 */

import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { ResponderChainProvider, useResponderChain } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";
import { ResponderChainManager } from "@/components/tugways/responder-chain";

afterEach(() => {
  cleanup();
});

// ===================================================================
// Unit: findResponderForTarget
// ===================================================================

describe("ResponderChainManager.findResponderForTarget", () => {
  it("returns the innermost registered responder id when walking up from a nested element", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "outer", parentId: null, actions: {} });
    mgr.register({ id: "inner", parentId: "outer", actions: {} });

    // Build a DOM tree: outer > middle (unregistered) > inner > leaf
    const outer = document.createElement("div");
    outer.setAttribute("data-responder-id", "outer");
    const middle = document.createElement("div"); // no attribute
    const inner = document.createElement("div");
    inner.setAttribute("data-responder-id", "inner");
    const leaf = document.createElement("span"); // click target
    inner.appendChild(leaf);
    middle.appendChild(inner);
    outer.appendChild(middle);
    document.body.appendChild(outer);

    try {
      expect(mgr.findResponderForTarget(leaf)).toBe("inner");
      expect(mgr.findResponderForTarget(inner)).toBe("inner");
      expect(mgr.findResponderForTarget(middle)).toBe("outer");
      expect(mgr.findResponderForTarget(outer)).toBe("outer");
    } finally {
      document.body.removeChild(outer);
    }
  });

  it("returns null when no ancestor of the target carries data-responder-id", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "some-responder", parentId: null, actions: {} });

    const detached = document.createElement("div");
    document.body.appendChild(detached);

    try {
      expect(mgr.findResponderForTarget(detached)).toBe(null);
    } finally {
      document.body.removeChild(detached);
    }
  });

  it("ignores data-responder-id values that point to unregistered nodes", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "real", parentId: null, actions: {} });

    // DOM carries an id the manager doesn't know about.
    const outer = document.createElement("div");
    outer.setAttribute("data-responder-id", "real");
    const stale = document.createElement("div");
    stale.setAttribute("data-responder-id", "ghost"); // never registered
    const leaf = document.createElement("span");
    stale.appendChild(leaf);
    outer.appendChild(stale);
    document.body.appendChild(outer);

    try {
      // The walk skips the ghost and lands on the real ancestor.
      expect(mgr.findResponderForTarget(leaf)).toBe("real");
    } finally {
      document.body.removeChild(outer);
    }
  });

  it("walks from a Text node via parentElement", () => {
    const mgr = new ResponderChainManager();
    mgr.register({ id: "holder", parentId: null, actions: {} });

    const holder = document.createElement("div");
    holder.setAttribute("data-responder-id", "holder");
    const text = document.createTextNode("hello");
    holder.appendChild(text);
    document.body.appendChild(holder);

    try {
      expect(mgr.findResponderForTarget(text)).toBe("holder");
    } finally {
      document.body.removeChild(holder);
    }
  });
});

// ===================================================================
// Integration: document-level pointerdown/focusin promotion
// ===================================================================
//
// These tests mount a real ResponderChainProvider with nested responders
// registered via useResponder, then dispatch a pointerdown (or focusin)
// event on a deeply-nested element and assert that the innermost
// responder becomes first responder. They exercise the full R1 path:
// useResponder writes data-responder-id, provider installs the
// document-level listener, the listener calls findResponderForTarget,
// the manager promotes via makeFirstResponder.

interface TestResponderProps {
  id: string;
  children?: React.ReactNode;
}

/**
 * A minimal component that registers as a responder and attaches
 * responderRef to its root element. Used as a test fixture for
 * nested-responder scenarios.
 */
function TestResponder({ id, children }: TestResponderProps) {
  const { ResponderScope, responderRef } = useResponder({
    id,
    actions: {},
  });

  return (
    <ResponderScope>
      <div ref={responderRef as (el: HTMLDivElement | null) => void} data-testid={id}>
        {children}
      </div>
    </ResponderScope>
  );
}

/**
 * Extract the manager from inside a ResponderChainProvider so tests can
 * assert on first-responder state. Uses a ref bridged through a child
 * component that calls useResponderChain.
 */
function ManagerBridge({ managerRef }: { managerRef: React.MutableRefObject<ResponderChainManager | null> }) {
  const mgr = useResponderChain();
  if (mgr) managerRef.current = mgr;
  return null;
}

describe("R1 integration: document-level promotion", () => {
  it("pointerdown on a nested responder promotes the innermost one, not the enclosing ancestor", () => {
    const managerRef: React.MutableRefObject<ResponderChainManager | null> = { current: null };

    render(
      <ResponderChainProvider>
        <ManagerBridge managerRef={managerRef} />
        <TestResponder id="outer">
          <TestResponder id="inner">
            <span data-testid="leaf">inside</span>
          </TestResponder>
        </TestResponder>
      </ResponderChainProvider>,
    );

    const manager = managerRef.current;
    expect(manager).not.toBe(null);
    if (!manager) return;

    // Initially: outer auto-promotes on register (root node), then
    // inner registers as a child of outer and does not auto-promote.
    // So outer is first responder.
    expect(manager.getFirstResponder()).toBe("outer");

    // Dispatch a pointerdown on the leaf inside the inner responder.
    // The document-level capture-phase listener should walk up from
    // the leaf, find inner first (innermost data-responder-id
    // ancestor), and promote it.
    const leaf = document.querySelector<HTMLElement>('[data-testid="leaf"]');
    expect(leaf).not.toBe(null);

    act(() => {
      leaf!.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    expect(manager.getFirstResponder()).toBe("inner");
  });

  it("focusin on a nested responder promotes the innermost one (keyboard Tab parity)", () => {
    const managerRef: React.MutableRefObject<ResponderChainManager | null> = { current: null };

    render(
      <ResponderChainProvider>
        <ManagerBridge managerRef={managerRef} />
        <TestResponder id="outer">
          <TestResponder id="inner">
            <button data-testid="focusable">button</button>
          </TestResponder>
        </TestResponder>
      </ResponderChainProvider>,
    );

    const manager = managerRef.current;
    expect(manager).not.toBe(null);
    if (!manager) return;

    // outer is the auto-promoted root.
    expect(manager.getFirstResponder()).toBe("outer");

    // Simulate Tab-focus landing inside the inner responder. focusin
    // bubbles, so dispatching on the button reaches the document-level
    // capture-phase listener installed by the provider.
    const btn = document.querySelector<HTMLElement>('[data-testid="focusable"]');
    expect(btn).not.toBe(null);

    act(() => {
      btn!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(manager.getFirstResponder()).toBe("inner");
  });

  it("pointerdown on a non-responder child promotes the nearest enclosing responder", () => {
    const managerRef: React.MutableRefObject<ResponderChainManager | null> = { current: null };

    render(
      <ResponderChainProvider>
        <ManagerBridge managerRef={managerRef} />
        <TestResponder id="outer">
          {/* A plain DOM subtree with no nested responder. */}
          <div data-testid="plain-wrapper">
            <span data-testid="plain-leaf">no responder here</span>
          </div>
        </TestResponder>
      </ResponderChainProvider>,
    );

    const manager = managerRef.current;
    expect(manager).not.toBe(null);
    if (!manager) return;

    expect(manager.getFirstResponder()).toBe("outer");

    const leaf = document.querySelector<HTMLElement>('[data-testid="plain-leaf"]');
    act(() => {
      leaf!.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      );
    });

    // The walk skips the plain wrapper and finds outer. Since outer
    // is already first responder, no change, but the id is still
    // resolved correctly.
    expect(manager.getFirstResponder()).toBe("outer");
  });
});

