/**
 * TugConfirmPopover unit tests — chain-native confirm/cancel wiring.
 *
 * TugConfirmPopover exposes a single ergonomic entry point (the
 * imperative Promise API via `confirmRef.current.confirm()`) and routes
 * its confirm/cancel buttons through the responder chain. Internally
 * the component registers as a responder with `confirmDialog` and
 * `cancelDialog` handlers that resolve the pending promise and close;
 * the buttons dispatch those actions via `manager.sendToFirstResponder`, the
 * dispatch walks from the innermost responder (promoted by the
 * pointerdown pathway to the popover's own `.tug-confirm-popover`
 * element), and lands back on the popover's own handler.
 *
 * These tests cover:
 *
 * 1. Imperative confirm() resolves on dispatched confirmDialog /
 *    cancelDialog — the core chain-native path.
 * 2. External dispatch while open resolves the pending promise with
 *    `false` and closes the popover — the observeDispatch dismissal
 *    path.
 * 3. Radix-level dismissal (Escape / click-outside via onOpenChange)
 *    also resolves with `false`.
 * 4. Fallback behavior when rendered without a ResponderChainProvider:
 *    clicking the buttons still resolves the promise (via the
 *    no-manager short circuit in the onClick handlers).
 *
 * Radix portals the popover content to document.body, so the button
 * query reaches into the document rather than the render container.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render UI inside a bare ResponderChainManager context. */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager };
}

/**
 * Locate the portaled `.tug-confirm-popover` element. Returns null when
 * the popover is not open (Radix unmounts on close).
 */
function getPopoverRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tug-confirm-popover");
}

/** Locate a button inside the portaled popover by its visible label. */
function getButtonByText(label: string): HTMLButtonElement | null {
  const root = getPopoverRoot();
  if (!root) return null;
  const buttons = root.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) return btn;
  }
  return null;
}

/**
 * Mount TugConfirmPopover, open it via the imperative confirm() API,
 * and return the ref handle and the returned promise so the test can
 * await the resolution after driving a dispatch or button click.
 *
 * The test exercises the imperative open-and-await flow that every
 * real consumer uses. Tracking the promise result via a local variable
 * and exposing it via the returned accessor keeps the test assertions
 * aligned with what a consumer would observe.
 */
function renderImperative(): {
  manager: ResponderChainManager;
  confirmRef: React.RefObject<TugConfirmPopoverHandle | null>;
  openAndAwait: () => Promise<boolean>;
} {
  const confirmRef = React.createRef<TugConfirmPopoverHandle>();
  const { manager } = renderWithManager(
    <TugConfirmPopover
      ref={confirmRef}
      message="Are you sure?"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      senderId="fixed-sender"
    >
      <TugPushButton>Trigger</TugPushButton>
    </TugConfirmPopover>,
  );
  const openAndAwait = (): Promise<boolean> => {
    const promise = confirmRef.current!.confirm();
    return promise;
  };
  return { manager, confirmRef, openAndAwait };
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. Chain-native confirmDialog / cancelDialog resolve the promise
// ---------------------------------------------------------------------------

describe("TugConfirmPopover – chain dispatch resolves the confirm() promise", () => {
  it("dispatching confirmDialog resolves the promise with true and closes", async () => {
    const { manager, openAndAwait } = renderImperative();

    // Open via the imperative API and hold the promise.
    let pending!: Promise<boolean>;
    act(() => {
      pending = openAndAwait();
    });
    expect(getPopoverRoot()).not.toBeNull();

    // Dispatch confirmDialog through the chain as if the internal
    // confirm button had been clicked (chain self-loop). The popover's
    // registered handler resolves the promise and sets open=false.
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CONFIRM_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });

    const result = await pending;
    expect(result).toBe(true);
    expect(getPopoverRoot()).toBeNull();
  });

  it("dispatching cancelDialog resolves the promise with false and closes", async () => {
    const { manager, openAndAwait } = renderImperative();

    let pending!: Promise<boolean>;
    act(() => {
      pending = openAndAwait();
    });
    expect(getPopoverRoot()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getPopoverRoot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. External dispatch cancels and closes
// ---------------------------------------------------------------------------

describe("TugConfirmPopover – observeDispatch external dismissal", () => {
  it("an unrelated chain dispatch while open resolves the promise with false", async () => {
    const { manager, openAndAwait } = renderImperative();

    let pending!: Promise<boolean>;
    act(() => {
      pending = openAndAwait();
    });
    expect(getPopoverRoot()).not.toBeNull();

    // Any unrelated chain activity — here a bare showSettings dispatch
    // with no registered handler — dismisses the popover and resolves
    // the pending promise with false.
    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getPopoverRoot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Radix-level dismissal (Escape / click-outside)
// ---------------------------------------------------------------------------

describe("TugConfirmPopover – Radix onOpenChange dismissal", () => {
  it("pressing Escape on the popover content resolves the promise with false", async () => {
    const { openAndAwait } = renderImperative();

    let pending!: Promise<boolean>;
    act(() => {
      pending = openAndAwait();
    });
    const root = getPopoverRoot();
    expect(root).not.toBeNull();

    // Radix listens for Escape via its DismissableLayer. Dispatch a
    // keydown on the content element; Radix catches it and calls
    // onOpenChange(false), which the popover converts to a cancel.
    act(() => {
      fireEvent.keyDown(root!, { key: "Escape", code: "Escape" });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getPopoverRoot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. No-provider fallback
// ---------------------------------------------------------------------------

describe("TugConfirmPopover – no-provider fallback", () => {
  it("clicking the confirm button resolves true even without a ResponderChainProvider", async () => {
    const confirmRef = React.createRef<TugConfirmPopoverHandle>();
    render(
      <TugConfirmPopover
        ref={confirmRef}
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      >
        <TugPushButton>Trigger</TugPushButton>
      </TugConfirmPopover>,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = confirmRef.current!.confirm();
    });
    expect(getPopoverRoot()).not.toBeNull();

    // With no manager in scope, clicking the button falls through to
    // the primary handler directly.
    const confirmBtn = getButtonByText("Confirm");
    expect(confirmBtn).not.toBeNull();
    act(() => {
      fireEvent.click(confirmBtn!);
    });

    const result = await pending;
    expect(result).toBe(true);
    expect(getPopoverRoot()).toBeNull();
  });

  it("clicking the cancel button resolves false without a provider", async () => {
    const confirmRef = React.createRef<TugConfirmPopoverHandle>();
    render(
      <TugConfirmPopover
        ref={confirmRef}
        message="Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      >
        <TugPushButton>Trigger</TugPushButton>
      </TugConfirmPopover>,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = confirmRef.current!.confirm();
    });

    const cancelBtn = getButtonByText("Cancel");
    expect(cancelBtn).not.toBeNull();
    act(() => {
      fireEvent.click(cancelBtn!);
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getPopoverRoot()).toBeNull();
  });
});
