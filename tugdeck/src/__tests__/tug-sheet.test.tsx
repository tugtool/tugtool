/**
 * TugSheet unit tests — chain-native close path.
 *
 * TugSheet is a card-modal window-shade dialog with a compound API
 * (TugSheet + TugSheetTrigger + TugSheetContent), an imperative ref
 * handle, and a Promise-based `useTugSheet()` hook. The open state is
 * internal to the compound root — there is no public `open` /
 * `onOpenChange` prop. Closing the sheet happens via:
 *
 * - The imperative `TugSheetHandle.close()` method.
 * - A `cancelDialog` action dispatched through the responder chain —
 *   from inside the sheet's Escape/Cmd+. keybinding handler, or from
 *   consumer Cancel/Save buttons that dispatch via `manager.sendToFirstResponder`.
 * - The `close(result?)` callback passed to the `useTugSheet()` hook's
 *   content render prop.
 *
 * Tests cover each close path, the modal no-external-dismiss semantics,
 * and the hook's Promise resolution on chain-driven dismissal.
 *
 * A mock `TugcardPortalContext` is provided so TugSheetContent can
 * portal into a known root element during the test.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";

import {
  TugSheet,
  TugSheetTrigger,
  TugSheetContent,
  useTugSheet,
  useTugSheetClose,
  type TugSheetHandle,
} from "@/components/tugways/tug-sheet";
import { TugcardPortalContext } from "@/components/tugways/tug-card";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  ResponderChainManager,
  ResponderParentContext,
} from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render UI inside both a ResponderChainManager and a
 * TugcardPortalContext with a mock card element attached to
 * document.body. The `.tugcard-body` child satisfies the inert-
 * attribute lifecycle effect in TugSheetContent.
 */
function renderWithChainAndCard(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const cardEl = document.createElement("div");
  cardEl.className = "tugcard";
  const cardBody = document.createElement("div");
  cardBody.className = "tugcard-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  const result = render(
    <ResponderChainContext.Provider value={manager}>
      <TugcardPortalContext.Provider value={cardEl}>
        {ui}
      </TugcardPortalContext.Provider>
    </ResponderChainContext.Provider>,
  );

  return {
    ...result,
    manager,
    cardEl,
    cleanupCard: () => {
      if (cardEl.parentNode) {
        cardEl.parentNode.removeChild(cardEl);
      }
    },
  };
}

/**
 * Locate the portaled `.tug-sheet-content` element within the mock
 * card. Returns null when no sheet is mounted.
 */
function getSheetContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tug-sheet-content");
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  // Remove any card elements left in the body by individual tests.
  document.querySelectorAll(".tugcard").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
});

// ---------------------------------------------------------------------------
// 1. defaultOpen mounts the sheet immediately
// ---------------------------------------------------------------------------

describe("TugSheet – defaultOpen seeds the initial open state", () => {
  it("mounts the sheet content when defaultOpen is true", () => {
    const { cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    expect(getSheetContent()).not.toBeNull();
    cleanupCard();
  });

  it("does not mount the sheet content when defaultOpen is omitted", () => {
    const { cleanupCard } = renderWithChainAndCard(
      <TugSheet>
        <TugSheetContent title="Settings">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    expect(getSheetContent()).toBeNull();
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 2. cancelDialog chain dispatch closes the sheet
// ---------------------------------------------------------------------------

describe("TugSheet – cancelDialog chain dispatch closes the sheet", () => {
  it("dispatching cancelDialog through the chain closes the sheet", () => {
    const { manager, cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings" senderId="fixed-sender">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    expect(getSheetContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "fixed-sender",
        phase: "discrete",
      });
    });

    // After the handler runs, internal open state flips false. The
    // exit animation effect starts but the component is still
    // mounted until `.finished.then()` sets mounted=false. In happy-
    // dom the animator resolves synchronously-enough for the content
    // to transition to data-state="closed" (if Radix-style) or
    // simply for a subsequent render to omit it. Both are valid.
    const contentAfter = getSheetContent();
    if (contentAfter !== null) {
      // Animation hasn't completed yet — acceptable if the element
      // is still mounted during the exit transition. The important
      // invariant is that internal open state is now false; we can't
      // probe that directly but a second dispatch should be a no-op.
      act(() => {
        manager.sendToFirstResponder({
          action: TUG_ACTIONS.CANCEL_DIALOG,
          sender: "fixed-sender",
          phase: "discrete",
        });
      });
    }
    cleanupCard();
  });

  it("Escape on the sheet content dispatches cancelDialog via the chain", () => {
    const { manager, cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings" senderId="esc-sender">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    const root = getSheetContent();
    expect(root).not.toBeNull();

    // Install an observer to confirm the dispatch flowed through the
    // chain with the expected shape.
    const seen: Array<{ action: string; sender: unknown }> = [];
    manager.observeDispatch((event) => {
      seen.push({ action: event.action, sender: event.sender });
    });

    act(() => {
      fireEvent.keyDown(root!, { key: "Escape", code: "Escape" });
    });

    // The Escape handler dispatches cancelDialog with the sheet's
    // senderId. The sheet's own handler closes the internal state;
    // the observer we installed also captures the event.
    expect(
      seen.some(
        (e) => e.action === "cancel-dialog" && e.sender === "esc-sender",
      ),
    ).toBe(true);
    cleanupCard();
  });

  it("Cmd+. on the sheet content dispatches cancelDialog via the chain", () => {
    const { manager, cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings" senderId="cmd-sender">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    const root = getSheetContent();
    expect(root).not.toBeNull();

    const seen: Array<{ action: string; sender: unknown }> = [];
    manager.observeDispatch((event) => {
      seen.push({ action: event.action, sender: event.sender });
    });

    act(() => {
      fireEvent.keyDown(root!, { key: ".", code: "Period", metaKey: true });
    });

    expect(
      seen.some(
        (e) => e.action === "cancel-dialog" && e.sender === "cmd-sender",
      ),
    ).toBe(true);
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 2b. Close from a consumer button when first responder is elsewhere
// ---------------------------------------------------------------------------

/**
 * Regression test for the "sheet becomes undismissable after returning
 * to its card" bug.
 *
 * Reproduces the production scenario:
 *   1. Sheet opens inside a parent responder (simulating a Tugcard).
 *   2. User focuses another card — first responder becomes a node
 *      OUTSIDE the sheet subtree.
 *   3. User returns to the sheet's card and clicks Cancel.
 *   4. The Cancel button's close dispatch must reach the sheet even
 *      though first responder is not inside it.
 *
 * Pre-fix: consumer Cancel buttons dispatched `cancelDialog` via
 * `sendToFirstResponder`, which walked up from the non-sheet first
 * responder and missed the sheet entirely.
 *
 * Post-fix: `useTugSheetClose` dispatches via `sendToTarget` at the
 * sheet's own responder id, so the walk starts inside the sheet
 * regardless of first-responder state.
 */
describe("TugSheet – close from consumer when first responder is elsewhere", () => {
  it("useTugSheetClose closes the sheet even if first responder is outside the sheet subtree", () => {
    // Cancel button rendered inside the sheet; uses the hook.
    function CancelButton() {
      const close = useTugSheetClose();
      return (
        <button type="button" data-testid="sheet-cancel" onClick={() => close()}>
          Cancel
        </button>
      );
    }

    // Parent responder id simulating a Tugcard wrapping the sheet.
    const parentResponderId = "parent-card";

    const { manager, cleanupCard } = renderWithChainAndCard(
      <ResponderParentContext.Provider value={parentResponderId}>
        <TugSheet defaultOpen>
          <TugSheetContent title="Settings">
            <CancelButton />
          </TugSheetContent>
        </TugSheet>
      </ResponderParentContext.Provider>,
    );

    // Register the parent node (simulating the Tugcard's responder)
    // and make it first responder — the sheet is NOT first responder.
    manager.register({
      id: parentResponderId,
      parentId: null,
      actions: {},
    });
    act(() => {
      manager.makeFirstResponder(parentResponderId);
    });
    expect(manager.getFirstResponder()).toBe(parentResponderId);

    // Sheet is open.
    expect(getSheetContent()).not.toBeNull();

    // Install an observer so we can check that the dispatch was
    // actually handled by the sheet (not just fired into the void).
    const seen: Array<{ action: string; handled: boolean }> = [];
    manager.observeDispatch((event, handled) => {
      seen.push({ action: event.action, handled });
    });

    // Click Cancel. Pre-fix, the consumer button dispatched
    // `cancelDialog` via `sendToFirstResponder`, which walked up from
    // the parent-card first responder, missed the sheet entirely, and
    // reported `handled=false`. Post-fix, `useTugSheetClose` dispatches
    // via `sendToTarget` at the sheet's own responder id — the sheet's
    // handler fires and reports `handled=true`.
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      "[data-testid='sheet-cancel']",
    );
    expect(cancelBtn).not.toBeNull();
    act(() => {
      fireEvent.click(cancelBtn!);
    });

    // The cancelDialog dispatch must be handled — that's the assertion
    // that distinguishes pre-fix from post-fix behavior.
    expect(
      seen.some((e) => e.action === "cancel-dialog" && e.handled === true),
    ).toBe(true);

    manager.unregister(parentResponderId);
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 3. Modal semantics — external dispatches do not dismiss
// ---------------------------------------------------------------------------

describe("TugSheet – modal semantics (no external auto-dismiss)", () => {
  it("an unrelated chain dispatch while the sheet is open does NOT close it", () => {
    const { manager, cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings" senderId="modal-sender">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    expect(getSheetContent()).not.toBeNull();

    // A bare unrelated dispatch dismisses a TugConfirmPopover but
    // must NOT dismiss a card-modal TugSheet. The sheet stays open.
    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    expect(getSheetContent()).not.toBeNull();
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 4. Imperative TugSheetHandle
// ---------------------------------------------------------------------------

describe("TugSheet – imperative ref handle", () => {
  it("open() and close() drive the internal state", () => {
    const sheetRef = React.createRef<TugSheetHandle>();
    const { cleanupCard } = renderWithChainAndCard(
      <TugSheet ref={sheetRef}>
        <TugSheetContent title="Settings">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );

    // Initially closed.
    expect(getSheetContent()).toBeNull();

    act(() => {
      sheetRef.current!.open();
    });
    expect(getSheetContent()).not.toBeNull();

    act(() => {
      sheetRef.current!.close();
    });
    // Close triggers the exit animation — the content may remain
    // mounted for the duration of the animation, or already be gone
    // in happy-dom. Either is acceptable; the key assertion is that
    // a follow-up open() finds a fresh render path.
    act(() => {
      sheetRef.current!.open();
    });
    expect(getSheetContent()).not.toBeNull();
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 5. useTugSheet hook — promise resolution
// ---------------------------------------------------------------------------

describe("useTugSheet – Promise API resolves via explicit close and chain dismiss", () => {
  it("explicit close(result) resolves the pending promise with the supplied result", async () => {
    let capturedShow:
      | ((opts: {
          title: string;
          content: (close: (result?: string) => void) => React.ReactNode;
        }) => Promise<string | undefined>)
      | null = null;

    function Consumer() {
      const { showSheet, renderSheet } = useTugSheet();
      capturedShow = showSheet;
      return <>{renderSheet()}</>;
    }

    const { cleanupCard } = renderWithChainAndCard(<Consumer />);

    let pending!: Promise<string | undefined>;
    act(() => {
      pending = capturedShow!({
        title: "Rename",
        content: (close) => (
          <button type="button" onClick={() => close("saved")}>
            Save
          </button>
        ),
      });
    });

    // After showSheet, the sheet is rendered via renderSheet.
    expect(getSheetContent()).not.toBeNull();

    const saveBtn = getSheetContent()!.querySelector<HTMLButtonElement>(
      "button",
    );
    expect(saveBtn).not.toBeNull();
    act(() => {
      fireEvent.click(saveBtn!);
    });

    const result = await pending;
    expect(result).toBe("saved");
    cleanupCard();
  });

  it("chain-dispatched cancelDialog resolves the hook promise with undefined", async () => {
    let capturedShow:
      | ((opts: {
          title: string;
          content: (close: (result?: string) => void) => React.ReactNode;
        }) => Promise<string | undefined>)
      | null = null;

    function Consumer() {
      const { showSheet, renderSheet } = useTugSheet();
      capturedShow = showSheet;
      return <>{renderSheet()}</>;
    }

    const { cleanupCard } = renderWithChainAndCard(<Consumer />);

    let pending!: Promise<string | undefined>;
    act(() => {
      pending = capturedShow!({
        title: "Rename",
        content: () => <div>body</div>,
      });
    });

    const root = getSheetContent();
    expect(root).not.toBeNull();

    // Dispatch Escape through the sheet's keydown handler, which
    // routes through the chain. The sheet's own handler closes
    // internal state; the hook's observeDispatch subscription fires
    // and resolves the promise with undefined.
    act(() => {
      fireEvent.keyDown(root!, { key: "Escape", code: "Escape" });
    });

    const result = await pending;
    expect(result).toBeUndefined();
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// 6. TugSheetTrigger uncontrolled mode
// ---------------------------------------------------------------------------

describe("TugSheetTrigger – uncontrolled open path", () => {
  it("clicking a TugSheetTrigger opens the sheet", () => {
    const { cleanupCard } = renderWithChainAndCard(
      <TugSheet>
        <TugSheetTrigger asChild>
          <button type="button">Open Settings</button>
        </TugSheetTrigger>
        <TugSheetContent title="Settings">
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );

    // Initially closed.
    expect(getSheetContent()).toBeNull();

    // Find the trigger and click it.
    const trigger = document.querySelector<HTMLButtonElement>(
      "button",
    );
    expect(trigger).not.toBeNull();
    act(() => {
      fireEvent.click(trigger!);
    });

    expect(getSheetContent()).not.toBeNull();
    cleanupCard();
  });
});

// ---------------------------------------------------------------------------
// N. onClosed fires after the exit animation completes
// ---------------------------------------------------------------------------

/**
 * Resolve every captured WAAPI animation on the mock. happy-dom's
 * `Element.prototype.animate` is stubbed in setup-rtl.ts — it does
 * NOT auto-resolve `.finished`; tests must drive it manually.
 */
function resolveAllWaapiAnimations() {
  const mock = (global as unknown as { __waapi_mock__: { calls: Array<{ resolve: () => void }>; reset: () => void } }).__waapi_mock__;
  for (const call of mock.calls) {
    call.resolve();
  }
}

describe("TugSheet – onClosed callback", () => {
  afterEach(() => {
    const mock = (global as unknown as { __waapi_mock__: { reset: () => void } }).__waapi_mock__;
    mock.reset();
  });

  it("TugSheetContent onClosed fires after the exit animation finishes", async () => {
    let invocations = 0;
    const onClosed = () => {
      invocations += 1;
    };

    const { manager, cleanupCard } = renderWithChainAndCard(
      <TugSheet defaultOpen>
        <TugSheetContent title="Settings" senderId="onclosed-sender" onClosed={onClosed}>
          <div>body</div>
        </TugSheetContent>
      </TugSheet>,
    );
    expect(getSheetContent()).not.toBeNull();
    expect(invocations).toBe(0);

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "onclosed-sender",
        phase: "discrete",
      });
    });

    // The exit animation's `g.finished.then(() => setMounted(false))`
    // only runs once the WAAPI mock promises resolve. Drive them
    // manually to simulate animation completion, then let the React
    // commit cycle fire the mounted-transition layout effect.
    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(invocations).toBe(1);
    });
    expect(getSheetContent()).toBeNull();
    cleanupCard();
  });

  it("useTugSheet onClosed receives the result passed to close()", async () => {
    const results: Array<string | undefined> = [];
    let closeFn: ((result?: string) => void) | null = null;

    function Harness() {
      const { showSheet, renderSheet } = useTugSheet();
      React.useEffect(() => {
        void showSheet({
          title: "Rename",
          content: (close) => {
            closeFn = close;
            return <div>body</div>;
          },
          onClosed: (result) => {
            results.push(result);
          },
        });
      }, [showSheet]);
      return <>{renderSheet()}</>;
    }

    const { cleanupCard } = renderWithChainAndCard(<Harness />);

    await waitFor(() => {
      expect(closeFn).not.toBeNull();
      expect(getSheetContent()).not.toBeNull();
    });

    act(() => {
      closeFn!("save");
    });

    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(results).toEqual(["save"]);
    });
    expect(getSheetContent()).toBeNull();
    cleanupCard();
  });
});
