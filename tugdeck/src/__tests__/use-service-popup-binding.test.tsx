/**
 * `useServicePopupBinding` unit tests.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 5 / [D06] / [D07] /
 * (#service-binding). The hook returns `{ captureOnOpen,
 * onCloseAutoFocus }`. Consumers (TugPopupMenu, TugPopover,
 * TugContextMenu) call `captureOnOpen()` from their `onOpenChange(next)`
 * when `next === true`, and pass `onCloseAutoFocus` to Radix's
 * `<Content onCloseAutoFocus>` prop.
 *
 * The tests below exercise the hook in isolation against a bare
 * `ResponderChainManager` and a synthesized canvas overlay root — no
 * Radix involvement. The captureOnOpen / onCloseAutoFocus pair is
 * driven directly so the tests can assert each branch of the restore
 * predicate.
 *
 * Coverage:
 *
 *   1. captureOnOpen snapshots manager.getFirstResponder().
 *   2. onCloseAutoFocus calls preventDefault + focusResponder when no
 *      external pointerdown observed.
 *   3. external pointerdown (target outside overlay root) sets the
 *      flag → onCloseAutoFocus skips restore.
 *   4. internal pointerdown (target inside overlay root) does NOT set
 *      the flag → onCloseAutoFocus restores.
 *   5. listener removed BEFORE predicate evaluation in
 *      onCloseAutoFocus (a synthesized pointerdown after remove does
 *      not flip the flag).
 *   6. unmount-while-open cleanup — listener leak prevention.
 *   7. no-provider tolerance — captureOnOpen is a no-op, no listener
 *      installed.
 *   8. captured responder unregistered before close — focusResponder
 *      no-ops gracefully (already verified by Step 3 tests; this
 *      pins that the binding still calls it without throwing).
 *
 * happy-dom scoping per project rules: this file tests pure DOM-event
 * + ref-state plumbing; no focus assertions across React renders. The
 * editor-end-to-end "image 5 close path" assertion (real CM6 view
 * regains DOM focus when the menu closes) is the app-test's job.
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { useServicePopupBinding } from "@/components/tugways/use-service-popup-binding";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";
import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";

afterEach(() => {
  cleanup();
  canvasOverlayRegistry._resetForTests();
});

beforeEach(() => {
  canvasOverlayRegistry._resetForTests();
});

// Synthesize a pointerdown event whose `target` is the supplied element.
// happy-dom doesn't wire native PointerEvent constructor with target
// straight away, so we dispatch through `el.dispatchEvent` and the
// event's target is the element. The capture-phase listener installed
// by the hook on `document` still fires.
function dispatchPointerDown(el: HTMLElement): void {
  const ev = new Event("pointerdown", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

// A consumer component that mounts the hook and exposes its return
// value via a ref the test can read. Pattern mirrors the
// useCompanionPopupBinding tests.
function Consumer({
  bindingRef,
}: {
  bindingRef: { current: ReturnType<typeof useServicePopupBinding> | null };
}) {
  const binding = useServicePopupBinding();
  bindingRef.current = binding;
  return null;
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupOverlayRoot(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-slot", "tug-canvas-overlay-root");
  document.body.appendChild(overlay);
  canvasOverlayRegistry.register(overlay);
  return overlay;
}

function setupExternalEl(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-test", "external");
  document.body.appendChild(el);
  return el;
}

function setupManagerWithEditor(): {
  mgr: ResponderChainManager;
  editorFocusCalls: { current: number };
} {
  const mgr = new ResponderChainManager();
  const editorFocusCalls = { current: 0 };
  mgr.register({
    id: "editor",
    parentId: null,
    actions: {},
    focus: () => {
      editorFocusCalls.current += 1;
    },
  });
  // After register, the editor is auto-promoted to first responder.
  return { mgr, editorFocusCalls };
}

function renderConsumerWithManager(
  mgr: ResponderChainManager,
): {
  bindingRef: {
    current: ReturnType<typeof useServicePopupBinding> | null;
  };
} {
  const bindingRef: {
    current: ReturnType<typeof useServicePopupBinding> | null;
  } = { current: null };
  render(
    <ResponderChainContext.Provider value={mgr}>
      <Consumer bindingRef={bindingRef} />
    </ResponderChainContext.Provider>,
  );
  return { bindingRef };
}

// ---------------------------------------------------------------------------
// 1. captureOnOpen snapshots first responder
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — captureOnOpen", () => {
  it("snapshots manager.getFirstResponder() at the moment captureOnOpen runs", () => {
    setupOverlayRoot();
    const { mgr, editorFocusCalls } = setupManagerWithEditor();
    const { bindingRef } = renderConsumerWithManager(mgr);
    expect(bindingRef.current).not.toBeNull();
    expect(mgr.getFirstResponder()).toBe("editor");

    bindingRef.current!.captureOnOpen();

    // Now Radix simulates having grabbed focus by promoting some
    // popup-content responder. We can fake this by registering a
    // throwaway and promoting it. The captured value is the
    // pre-open value — `editor`, not the post-promotion value.
    mgr.register({ id: "popup-content", parentId: "editor", actions: {} });
    mgr.makeFirstResponder("popup-content");
    expect(mgr.getFirstResponder()).toBe("popup-content");

    // Close — restore should land on the captured "editor", not the
    // current "popup-content".
    const ev = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(mgr.getFirstResponder()).toBe("editor");
    expect(editorFocusCalls.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. onCloseAutoFocus restores when no external pointerdown
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — onCloseAutoFocus, no external pointerdown", () => {
  it("calls preventDefault + focusResponder(captured) and restores prior responder", () => {
    setupOverlayRoot();
    const { mgr, editorFocusCalls } = setupManagerWithEditor();
    const { bindingRef } = renderConsumerWithManager(mgr);

    bindingRef.current!.captureOnOpen();

    // Assume the popup briefly took chain focus — promote a fake
    // popup-content responder so that getFirstResponder() returns
    // non-null at close time (the predicate's "chain torn down"
    // branch requires non-null current first responder).
    mgr.register({ id: "popup-content", parentId: "editor", actions: {} });
    mgr.makeFirstResponder("popup-content");

    const ev = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(mgr.getFirstResponder()).toBe("editor");
    expect(editorFocusCalls.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. External pointerdown skips restore
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — onCloseAutoFocus, external pointerdown observed", () => {
  it("does NOT call preventDefault and does NOT call focusResponder when external click happened", () => {
    setupOverlayRoot();
    const externalEl = setupExternalEl();
    const { mgr, editorFocusCalls } = setupManagerWithEditor();
    const { bindingRef } = renderConsumerWithManager(mgr);

    bindingRef.current!.captureOnOpen();

    // External pointerdown — outside the overlay root.
    dispatchPointerDown(externalEl);

    const ev = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(editorFocusCalls.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Internal pointerdown does NOT set the flag
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — onCloseAutoFocus, internal pointerdown", () => {
  it("does NOT flag external when the click target is inside the canvas overlay root", () => {
    const overlay = setupOverlayRoot();
    // Synthesize an "another popup" / sheet content child of the
    // overlay root.
    const innerEl = document.createElement("div");
    innerEl.setAttribute("data-test", "inner-popup");
    overlay.appendChild(innerEl);

    const { mgr, editorFocusCalls } = setupManagerWithEditor();
    const { bindingRef } = renderConsumerWithManager(mgr);

    bindingRef.current!.captureOnOpen();
    dispatchPointerDown(innerEl);

    const ev = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev);

    // Internal click → restore still happens.
    expect(ev.defaultPrevented).toBe(true);
    expect(editorFocusCalls.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Listener removed BEFORE predicate evaluation
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — listener removed before predicate", () => {
  it("a synthesized pointerdown AFTER onCloseAutoFocus does not flip any state", () => {
    setupOverlayRoot();
    const externalEl = setupExternalEl();
    const { mgr } = setupManagerWithEditor();
    const { bindingRef } = renderConsumerWithManager(mgr);

    bindingRef.current!.captureOnOpen();

    const ev = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev);

    // After close, the listener must be gone. A pointerdown now
    // should not flip externalClickRef. The hook's internal state is
    // already cleared at this point, so the only observable assertion
    // is that re-opening + closing without observing the post-close
    // pointerdown still restores.
    dispatchPointerDown(externalEl);

    // Re-open + close immediately. The fresh capture/restore cycle
    // should NOT see the prior external click. (If the listener had
    // leaked, the externalClickRef from the first cycle would have
    // been corrupted by `dispatchPointerDown` above; but since the
    // hook clears the ref in onCloseAutoFocus, this is also covered
    // by the ref clearing. The combined assertion verifies both:
    // ref cleared AND listener torn down.)
    bindingRef.current!.captureOnOpen();
    const ev2 = new Event("close-auto-focus", { cancelable: true });
    bindingRef.current!.onCloseAutoFocus(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Unmount-while-open cleanup
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — unmount-while-open cleanup", () => {
  it("removes the document-level pointerdown listener on consumer unmount", () => {
    setupOverlayRoot();
    const { mgr } = setupManagerWithEditor();
    const bindingRef: {
      current: ReturnType<typeof useServicePopupBinding> | null;
    } = { current: null };
    const { unmount } = render(
      <ResponderChainContext.Provider value={mgr}>
        <Consumer bindingRef={bindingRef} />
      </ResponderChainContext.Provider>,
    );

    bindingRef.current!.captureOnOpen();

    // Spy on document.removeEventListener to verify the unmount
    // cleanup invokes it. We check by counting calls with the
    // pointerdown type and capture: true option.
    const originalRemove = document.removeEventListener.bind(document);
    let pointerdownRemovals = 0;
    (document as Document).removeEventListener = ((
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (
        type === "pointerdown" &&
        typeof options === "object" &&
        options !== null &&
        options.capture === true
      ) {
        pointerdownRemovals += 1;
      }
      return originalRemove(type, handler, options);
    }) as Document["removeEventListener"];

    try {
      unmount();
      expect(pointerdownRemovals).toBeGreaterThanOrEqual(1);
    } finally {
      (document as Document).removeEventListener = originalRemove;
    }
  });
});

// ---------------------------------------------------------------------------
// 7. No-provider tolerance
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — no provider", () => {
  it("captureOnOpen is a no-op and onCloseAutoFocus does not preventDefault when manager is null", () => {
    setupOverlayRoot();

    // Spy installs vs the document. With no provider,
    // useResponderChain() returns null and captureOnOpen short-
    // circuits; no addEventListener call should happen.
    const originalAdd = document.addEventListener.bind(document);
    let pointerdownInstalls = 0;
    (document as Document).addEventListener = ((
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "pointerdown") pointerdownInstalls += 1;
      return originalAdd(type, handler, options);
    }) as Document["addEventListener"];

    try {
      const bindingRef: {
        current: ReturnType<typeof useServicePopupBinding> | null;
      } = { current: null };
      // Render WITHOUT a provider — useResponderChain() returns null.
      render(<Consumer bindingRef={bindingRef} />);

      bindingRef.current!.captureOnOpen();
      expect(pointerdownInstalls).toBe(0);

      const ev = new Event("close-auto-focus", { cancelable: true });
      bindingRef.current!.onCloseAutoFocus(ev);
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      (document as Document).addEventListener = originalAdd;
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Captured responder unregistered before close
// ---------------------------------------------------------------------------

describe("useServicePopupBinding — captured responder unregistered before close", () => {
  it("focusResponder no-ops gracefully on the unregistered id (binding does not throw)", () => {
    setupOverlayRoot();
    const mgr = new ResponderChainManager();
    mgr.register({
      id: "transient",
      parentId: null,
      actions: {},
    });
    const { bindingRef } = renderConsumerWithManager(mgr);

    bindingRef.current!.captureOnOpen();

    // Promote a different responder so the predicate's "chain torn
    // down" branch (current first responder is null) does not skip.
    mgr.register({ id: "popup-content", parentId: "transient", actions: {} });
    mgr.makeFirstResponder("popup-content");

    // Unregister the captured responder while the popup is still
    // "open" (between captureOnOpen and onCloseAutoFocus).
    mgr.unregister("transient");

    const ev = new Event("close-auto-focus", { cancelable: true });

    // Binding must not throw on unregistered captured id.
    // focusResponder dev-mode warns + no-ops per Step 3.
    expect(() => bindingRef.current!.onCloseAutoFocus(ev)).not.toThrow();

    // preventDefault still ran because the predicate evaluated to
    // "should restore"; focusResponder's no-op happens inside the
    // manager and is invisible to the binding's caller.
    expect(ev.defaultPrevented).toBe(true);
  });
});
