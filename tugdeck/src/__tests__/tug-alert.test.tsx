/**
 * TugAlert unit tests — chain-native confirm/cancel wiring.
 *
 * TugAlert exposes an imperative Promise API via
 * `alertRef.current.alert(options)` (and a singleton variant via
 * `TugAlertProvider` + `useTugAlert()`). Internally the component
 * registers as a responder with `confirmDialog` and `cancelDialog`
 * handlers that resolve the pending promise and close; the confirm
 * and cancel buttons dispatch those actions through the chain, the
 * dispatch walks from the innermost responder (promoted by the
 * pointerdown pathway to the alert's `.tug-alert-content` element),
 * and lands back on the alert's own handler.
 *
 * Unlike TugConfirmPopover, TugAlert is modal and does NOT subscribe
 * to `manager.observeDispatch` for external dismissal. Tests
 * verify this explicitly: an unrelated chain dispatch while the
 * alert is open leaves the alert open and the pending promise
 * unresolved.
 *
 * Test coverage:
 *
 * 1. Chain-dispatched confirmDialog / cancelDialog resolve the
 *    promise and close the alert.
 * 2. Radix Escape-via-DismissableLayer and Cmd+. both resolve with
 *    false.
 * 3. External chain activity does NOT dismiss the modal alert.
 * 4. No-provider fallback: clicking the buttons still resolves the
 *    promise (via the short-circuit in the onClick handlers).
 * 5. TugAlertProvider / useTugAlert singleton pattern still works
 *    end-to-end on top of the chain wiring.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

import {
  TugAlert,
  TugAlertProvider,
  useTugAlert,
  type TugAlertHandle,
} from "@/components/tugways/tug-alert";
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
 * Locate the portaled `.tug-alert-content` element. Returns null when
 * the alert is not mounted (Radix unmounts on close).
 */
function getAlertContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tug-alert-content");
}

/** Locate a button inside the portaled alert by visible label. */
function getButtonByText(label: string): HTMLButtonElement | null {
  const root = getAlertContent();
  if (!root) return null;
  const buttons = root.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) return btn;
  }
  return null;
}

/**
 * Mount an inline TugAlert with a local ref and return the ref and
 * the manager so the test can drive chain dispatches or inspect DOM.
 */
function renderInlineAlert(): {
  manager: ResponderChainManager;
  alertRef: React.RefObject<TugAlertHandle | null>;
} {
  const alertRef = React.createRef<TugAlertHandle>();
  const { manager } = renderWithManager(
    <TugAlert
      ref={alertRef}
      title="Are you sure?"
      confirmLabel="OK"
      cancelLabel="Cancel"
      senderId="fixed-sender"
    />,
  );
  return { manager, alertRef };
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. Chain-dispatched confirm / cancel resolve the promise
// ---------------------------------------------------------------------------

describe("TugAlert – chain dispatch resolves the alert() promise", () => {
  it("dispatching confirmDialog resolves the promise with true and closes", async () => {
    const { manager, alertRef } = renderInlineAlert();

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    expect(getAlertContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CONFIRM_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });

    const result = await pending;
    expect(result).toBe(true);
    expect(getAlertContent()).toBeNull();
  });

  it("dispatching cancelDialog resolves the promise with false and closes", async () => {
    const { manager, alertRef } = renderInlineAlert();

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    expect(getAlertContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getAlertContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Radix dismissal paths
// ---------------------------------------------------------------------------

describe("TugAlert – Radix dismissal routes to cancel", () => {
  it("pressing Escape on the alert content resolves with false", async () => {
    const { alertRef } = renderInlineAlert();

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    const root = getAlertContent();
    expect(root).not.toBeNull();

    act(() => {
      fireEvent.keyDown(root!, { key: "Escape", code: "Escape" });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getAlertContent()).toBeNull();
  });

  it("pressing Cmd+. on the alert content resolves with false", async () => {
    const { alertRef } = renderInlineAlert();

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    const root = getAlertContent();
    expect(root).not.toBeNull();

    // The inline onKeyDown handler intercepts Cmd+. and converts it
    // to a cancel via handleOpenChange(false).
    act(() => {
      fireEvent.keyDown(root!, { key: ".", code: "Period", metaKey: true });
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getAlertContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Modal semantics — no observeDispatch
// ---------------------------------------------------------------------------

describe("TugAlert – modal semantics (no external auto-dismiss)", () => {
  it("an unrelated chain dispatch while open does NOT dismiss the alert", async () => {
    const { manager, alertRef } = renderInlineAlert();

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    expect(getAlertContent()).not.toBeNull();

    // A bare unrelated dispatch would dismiss a TugConfirmPopover via
    // its observeDispatch subscription. TugAlert is modal and
    // deliberately does not subscribe, so the alert stays open.
    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    expect(getAlertContent()).not.toBeNull();

    // Clean up the pending promise so the test doesn't leak an
    // unresolved promise. Dispatch cancel through the chain to close.
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });
    const result = await pending;
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. No-provider fallback
// ---------------------------------------------------------------------------

describe("TugAlert – no-provider fallback", () => {
  it("clicking the confirm button resolves with true without a provider", async () => {
    const alertRef = React.createRef<TugAlertHandle>();
    render(
      <TugAlert
        ref={alertRef}
        title="Are you sure?"
        confirmLabel="OK"
        cancelLabel="Cancel"
      />,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    const confirmBtn = getButtonByText("OK");
    expect(confirmBtn).not.toBeNull();
    act(() => {
      fireEvent.click(confirmBtn!);
    });

    const result = await pending;
    expect(result).toBe(true);
    expect(getAlertContent()).toBeNull();
  });

  it("clicking the cancel button resolves with false without a provider", async () => {
    const alertRef = React.createRef<TugAlertHandle>();
    render(
      <TugAlert
        ref={alertRef}
        title="Are you sure?"
        confirmLabel="OK"
        cancelLabel="Cancel"
      />,
    );

    let pending!: Promise<boolean>;
    act(() => {
      pending = alertRef.current!.alert();
    });
    const cancelBtn = getButtonByText("Cancel");
    expect(cancelBtn).not.toBeNull();
    act(() => {
      fireEvent.click(cancelBtn!);
    });

    const result = await pending;
    expect(result).toBe(false);
    expect(getAlertContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. TugAlertProvider + useTugAlert singleton pattern
// ---------------------------------------------------------------------------

describe("TugAlert – TugAlertProvider + useTugAlert singleton", () => {
  it("showAlert resolves true when confirmDialog dispatches through the chain", async () => {
    // Capture the showAlert function via a consumer component so we
    // can call it from the test body.
    let capturedShowAlert:
      | ((opts?: { title?: string }) => Promise<boolean>)
      | null = null;

    function Consumer() {
      const showAlert = useTugAlert();
      capturedShowAlert = showAlert;
      return null;
    }

    const manager = new ResponderChainManager();
    render(
      <ResponderChainContext.Provider value={manager}>
        <TugAlertProvider>
          <Consumer />
        </TugAlertProvider>
      </ResponderChainContext.Provider>,
    );

    expect(capturedShowAlert).not.toBeNull();

    let pending!: Promise<boolean>;
    act(() => {
      pending = capturedShowAlert!({ title: "Confirmed?" });
    });
    expect(getAlertContent()).not.toBeNull();

    // The singleton's own senderId is an internal useId() value we
    // cannot predict from the test. Dispatch confirmDialog without a
    // sender — the alert's handler runs regardless because the chain
    // walks from the alert (promoted as first responder via the
    // button-click DOM walk) and matches the action name. For this
    // test, no pointerdown has fired so first responder is unset; we
    // dispatch directly via sendToTarget is not available here, so we
    // instead click the rendered confirm button.
    const confirmBtn = getButtonByText("OK");
    expect(confirmBtn).not.toBeNull();
    act(() => {
      fireEvent.click(confirmBtn!);
    });

    const result = await pending;
    expect(result).toBe(true);
    expect(getAlertContent()).toBeNull();
  });
});
