/**
 * TugPopover unit tests — chain-native dismissal and imperative handle.
 *
 * TugPopover owns its open state internally and exposes an imperative
 * `TugPopoverHandle` ref for consumers that need to drive the popover
 * programmatically. Dismissal flows through the responder chain: the
 * inner `TugPopoverContentShell` (mounted only while the popover is
 * open) registers as a responder handling `cancelDialog` and
 * `dismissPopover`, both of which close the popover via the internal
 * context's `close` callback. The shell also subscribes to
 * `observeDispatch` while mounted so any external chain activity
 * dismisses the popover, with a self-sender filter that skips the
 * cancelDialog re-emission from the root's `handleOpenChange`.
 *
 * These tests cover:
 *
 * 1. Imperative `open()` / `close()` / `isOpen()` drive the popover.
 * 2. Dispatching `cancelDialog` through the chain closes an open
 *    popover via the responder handler.
 * 3. Dispatching `dismissPopover` through the chain closes an open
 *    popover via the responder handler.
 * 4. An unrelated chain dispatch while the popover is open closes it
 *    via the `observeDispatch` subscription.
 * 5. The responder is registered only while the popover is open —
 *    closing and reopening does not leak stale nodes.
 * 6. Standalone rendering (no ResponderChainProvider) still works
 *    via the imperative handle; chain-reactive features silently
 *    degrade.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import {
  TugPopover,
  TugPopoverTrigger,
  TugPopoverContent,
  useTugPopoverClose,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
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

/** Locate the portaled popover content element. Null when closed. */
function getPopoverContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tug-popover-content");
}

/**
 * Mount a TugPopover with a single anchor trigger and a small body.
 * Returns the ref handle and manager for test assertions.
 */
function renderPopover(): {
  manager: ResponderChainManager;
  popoverRef: React.RefObject<TugPopoverHandle | null>;
} {
  const popoverRef = React.createRef<TugPopoverHandle>();
  const { manager } = renderWithManager(
    <TugPopover ref={popoverRef} senderId="fixed-popover-sender">
      <TugPopoverTrigger>
        <TugPushButton>Anchor</TugPushButton>
      </TugPopoverTrigger>
      <TugPopoverContent>
        <div>Body</div>
      </TugPopoverContent>
    </TugPopover>,
  );
  return { manager, popoverRef };
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 1. Imperative handle
// ---------------------------------------------------------------------------

describe("TugPopover – imperative handle", () => {
  it("open() mounts the popover content and isOpen() reports true", () => {
    const { popoverRef } = renderPopover();

    expect(getPopoverContent()).toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(false);

    act(() => {
      popoverRef.current!.open();
    });

    expect(getPopoverContent()).not.toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(true);
  });

  it("close() unmounts the popover content and isOpen() reports false", () => {
    const { popoverRef } = renderPopover();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    act(() => {
      popoverRef.current!.close();
    });

    expect(getPopoverContent()).toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Chain-native dismissal
// ---------------------------------------------------------------------------

describe("TugPopover – chain-native dismissal", () => {
  it("dispatching cancelDialog through the chain closes the popover", () => {
    const { manager, popoverRef } = renderPopover();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "external-sender",
        phase: "discrete",
      });
    });

    expect(getPopoverContent()).toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(false);
  });

  it("dispatching dismissPopover through the chain closes the popover", () => {
    const { manager, popoverRef } = renderPopover();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.DISMISS_POPOVER,
        sender: "external-sender",
        phase: "discrete",
      });
    });

    expect(getPopoverContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. External dismissal via observeDispatch
// ---------------------------------------------------------------------------

describe("TugPopover – observeDispatch external dismissal", () => {
  it("an unrelated chain dispatch while open closes the popover", () => {
    const { manager, popoverRef } = renderPopover();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    // Any unrelated chain activity — here a bare showSettings dispatch
    // with no registered handler — dismisses the popover.
    act(() => {
      manager.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_SETTINGS, phase: "discrete" });
    });

    expect(getPopoverContent()).toBeNull();
  });

  it("dispatches originating from inside the popover do not dismiss", () => {
    // Form-content popovers (see gallery-popover's Form Content example)
    // contain controls that emit their own chain actions — a switch
    // toggle, an input commit, etc. Those dispatches must not
    // dismiss their own containing popover. The filter keys on
    // whether document.activeElement is inside the popover content:
    // if the user has focus on a control inside, the dispatch was
    // their interaction with the popover, not an external signal to
    // close it.
    const popoverRef = React.createRef<TugPopoverHandle>();
    const { manager } = renderWithManager(
      <TugPopover ref={popoverRef} senderId="fixed-popover-sender">
        <TugPopoverTrigger>
          <TugPushButton>Anchor</TugPushButton>
        </TugPopoverTrigger>
        <TugPopoverContent>
          <input data-testid="inner-input" placeholder="Name" />
        </TugPopoverContent>
      </TugPopover>,
    );

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    // Simulate focus landing on the form control inside the popover,
    // as it would after Radix's FocusScope moves focus on open or
    // the user clicks into the field.
    const innerInput = document.querySelector<HTMLInputElement>(
      '[data-testid="inner-input"]',
    );
    expect(innerInput).not.toBeNull();
    act(() => {
      innerInput!.focus();
    });
    expect(document.activeElement).toBe(innerInput);

    // Dispatch a chain action with an external sender. Under the old
    // "close on any non-self dispatch" rule this would dismiss; the
    // focus-inside-popover filter keeps the popover open.
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.TOGGLE,
        value: true,
        sender: "inner-switch-sender",
        phase: "discrete",
      });
    });

    expect(getPopoverContent()).not.toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Responder lifecycle — open/close/reopen does not leak nodes
// ---------------------------------------------------------------------------

describe("TugPopover – responder lifecycle", () => {
  it("closing and reopening the popover re-registers a fresh responder", () => {
    const { manager, popoverRef } = renderPopover();

    act(() => {
      popoverRef.current!.open();
    });

    // Close via chain dispatch, then reopen. The second open cycle
    // must again accept chain-native dismissal — if the responder
    // leaked or failed to re-register, the second close would not
    // land.
    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "external-sender",
        phase: "discrete",
      });
    });
    expect(getPopoverContent()).toBeNull();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    act(() => {
      manager.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: "external-sender",
        phase: "discrete",
      });
    });
    expect(getPopoverContent()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. useTugPopoverClose — explicit dismissal from nested controls
// ---------------------------------------------------------------------------

describe("TugPopover – useTugPopoverClose hook", () => {
  it("returns a function that closes the enclosing popover on invocation", () => {
    // A nested button that calls useTugPopoverClose() represents the
    // "Save Changes" pattern: a form-content popover button whose
    // intent is to commit whatever state the form holds and dismiss.
    // The hook dispatches cancelDialog through the chain; the shell's
    // own handler catches it and closes the popover via context.
    function InnerCloser() {
      const close = useTugPopoverClose();
      return (
        <button type="button" data-testid="inner-closer" onClick={close}>
          Close from inside
        </button>
      );
    }

    const popoverRef = React.createRef<TugPopoverHandle>();
    renderWithManager(
      <TugPopover ref={popoverRef} senderId="fixed-popover-sender">
        <TugPopoverTrigger>
          <TugPushButton>Anchor</TugPushButton>
        </TugPopoverTrigger>
        <TugPopoverContent>
          <InnerCloser />
        </TugPopoverContent>
      </TugPopover>,
    );

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    const closer = document.querySelector<HTMLButtonElement>(
      '[data-testid="inner-closer"]',
    );
    expect(closer).not.toBeNull();

    act(() => {
      closer!.click();
    });

    expect(getPopoverContent()).toBeNull();
    expect(popoverRef.current!.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. No-provider fallback
// ---------------------------------------------------------------------------

describe("TugPopover – no-provider fallback", () => {
  it("imperative open()/close() work without a ResponderChainProvider", () => {
    const popoverRef = React.createRef<TugPopoverHandle>();
    render(
      <TugPopover ref={popoverRef}>
        <TugPopoverTrigger>
          <TugPushButton>Anchor</TugPushButton>
        </TugPopoverTrigger>
        <TugPopoverContent>
          <div>Body</div>
        </TugPopoverContent>
      </TugPopover>,
    );

    expect(getPopoverContent()).toBeNull();

    act(() => {
      popoverRef.current!.open();
    });
    expect(getPopoverContent()).not.toBeNull();

    act(() => {
      popoverRef.current!.close();
    });
    expect(getPopoverContent()).toBeNull();
  });
});
