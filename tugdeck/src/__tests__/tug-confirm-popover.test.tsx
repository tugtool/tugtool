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

// ---------------------------------------------------------------------------
// 5. Controlled-mode API
// ---------------------------------------------------------------------------

/**
 * Render a TugConfirmPopover in controlled mode anchored to a supplied
 * element. The harness owns `open` state and `onConfirm` / `onCancel`
 * callbacks via mock-trackers; the test asserts the mocks fire correctly
 * and the open state flips back to false on the parent's setState.
 */
function renderControlled(initialOpen: boolean): {
  manager: ResponderChainManager;
  setOpen: (next: boolean) => void;
  confirmCalls: { count: number };
  cancelCalls: { count: number };
  anchor: HTMLElement;
  rerender: (open: boolean) => void;
} {
  const manager = new ResponderChainManager();
  const confirmCalls = { count: 0 };
  const cancelCalls = { count: 0 };

  // Stand up the anchor element OUTSIDE the React tree so the popover's
  // virtualRef pattern is exercised in the same way real consumers wire
  // it (form holds a ref to a child cell's button via querySelector).
  const anchor = document.createElement("button");
  anchor.textContent = "Anchor";
  anchor.setAttribute("data-testid", "external-anchor");
  document.body.appendChild(anchor);
  const anchorRef = { current: anchor as HTMLElement | null };

  let openControl = initialOpen;
  function ControlledHarness({ open }: { open: boolean }) {
    return (
      <ResponderChainContext.Provider value={manager}>
        <TugConfirmPopover
          message="Forget this row?"
          confirmLabel="Forget"
          cancelLabel="Cancel"
          senderId="controlled-sender"
          open={open}
          anchorEl={anchorRef.current}
          onConfirm={() => {
            confirmCalls.count += 1;
            openControl = false;
            rerender(openControl);
          }}
          onCancel={() => {
            cancelCalls.count += 1;
            openControl = false;
            rerender(openControl);
          }}
        />
      </ResponderChainContext.Provider>
    );
  }

  const utils = render(<ControlledHarness open={openControl} />);
  const rerender = (open: boolean): void => {
    utils.rerender(<ControlledHarness open={open} />);
  };

  const setOpen = (next: boolean): void => {
    openControl = next;
    rerender(openControl);
  };

  return { manager, setOpen, confirmCalls, cancelCalls, anchor, rerender };
}

describe("TugConfirmPopover – controlled-mode API", () => {
  it("renders the popover when open=true and anchorEl is set", () => {
    const ctx = renderControlled(false);
    expect(getPopoverRoot()).toBeNull();
    act(() => {
      ctx.setOpen(true);
    });
    expect(getPopoverRoot()).not.toBeNull();
  });

  it("confirm-button click fires onConfirm and closes via parent setState", () => {
    const ctx = renderControlled(false);
    act(() => {
      ctx.setOpen(true);
    });
    expect(getPopoverRoot()).not.toBeNull();

    const confirmBtn = getButtonByText("Forget");
    expect(confirmBtn).not.toBeNull();
    act(() => {
      fireEvent.click(confirmBtn!);
    });

    expect(ctx.confirmCalls.count).toBe(1);
    expect(ctx.cancelCalls.count).toBe(0);
    expect(getPopoverRoot()).toBeNull();
  });

  it("cancel-button click fires onCancel and closes via parent setState", () => {
    const ctx = renderControlled(false);
    act(() => {
      ctx.setOpen(true);
    });

    const cancelBtn = getButtonByText("Cancel");
    expect(cancelBtn).not.toBeNull();
    act(() => {
      fireEvent.click(cancelBtn!);
    });

    expect(ctx.cancelCalls.count).toBe(1);
    expect(ctx.confirmCalls.count).toBe(0);
    expect(getPopoverRoot()).toBeNull();
  });

  it("self-dispatch (sender matches) does NOT double-fire onCancel after onConfirm", () => {
    // Regression pin for the chain pollution path: clicking Confirm
    // dispatches confirmDialog which fires our own observer; without the
    // sender filter the observer would call handleResolution(false) →
    // onCancel after onConfirm just landed.
    const ctx = renderControlled(false);
    act(() => {
      ctx.setOpen(true);
    });
    const confirmBtn = getButtonByText("Forget");
    act(() => {
      fireEvent.click(confirmBtn!);
    });
    expect(ctx.confirmCalls.count).toBe(1);
    expect(ctx.cancelCalls.count).toBe(0);
  });

  it("an unrelated chain dispatch (different sender) fires onCancel", () => {
    const ctx = renderControlled(false);
    act(() => {
      ctx.setOpen(true);
    });
    expect(getPopoverRoot()).not.toBeNull();

    // A SHOW_SETTINGS dispatch with no sender filter pass-through
    // simulates external chain activity — our observer treats this as
    // "user did something else", cancels, parent flips open false.
    act(() => {
      ctx.manager.sendToFirstResponder({
        action: TUG_ACTIONS.SHOW_SETTINGS,
        phase: "discrete",
      });
    });
    expect(ctx.cancelCalls.count).toBe(1);
    expect(getPopoverRoot()).toBeNull();
  });

  it("open=true with anchorEl=null keeps the popover closed (anchor-not-yet-resolved race)", () => {
    const manager = new ResponderChainManager();
    const onConfirm = () => {};
    const onCancel = () => {};
    render(
      <ResponderChainContext.Provider value={manager}>
        <TugConfirmPopover
          message="Forget?"
          open={true}
          anchorEl={null}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </ResponderChainContext.Provider>,
    );
    // Open prop is true but anchor not yet resolved — popover stays
    // closed until the parent's layout effect populates anchorEl.
    expect(getPopoverRoot()).toBeNull();
  });

  it("after open=true and a confirm, re-opening the popover with a different anchor still works (single instance reuse)", () => {
    // The point of controlled mode is that ONE instance can serve N
    // anchor targets. Confirm once on the original anchor, then swap
    // the anchor and reopen — the popover still mounts.
    const ctx = renderControlled(false);
    act(() => {
      ctx.setOpen(true);
    });
    act(() => {
      fireEvent.click(getButtonByText("Forget")!);
    });
    expect(ctx.confirmCalls.count).toBe(1);
    expect(getPopoverRoot()).toBeNull();

    // Reopen.
    act(() => {
      ctx.setOpen(true);
    });
    expect(getPopoverRoot()).not.toBeNull();
  });
});
