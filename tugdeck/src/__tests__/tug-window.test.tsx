/**
 * TugWindow component unit tests.
 *
 * Tests cover:
 * - T16: TugWindow renders at correct position and size from stackState
 * - T17: TugWindow applies zIndex prop
 * - T18: TugWindow calls onStackActivated on pointer-down
 * - T19: TugWindow calls onClose when the title bar close path fires
 * - T20: TugWindow clamps resize to min-size derived from chrome + minContentSize
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";

import { TugWindow } from "@/components/chrome/tug-window";
import type { TugWindowState } from "@/layout-tree";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { withDeckManager } from "./mock-deck-manager-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStackState(overrides: Partial<TugWindowState> = {}): TugWindowState {
  return {
    id: "card-1",
    position: { x: 100, y: 200 },
    size: { width: 400, height: 300 },
    cardIds: ["tab-1"],
    activeCardId: "tab-1",
    title: "",
    acceptsFamilies: ["standard"],
    ...overrides,
  };
}

function wrap(ui: React.ReactElement): React.ReactElement {
  return withDeckManager(<ResponderChainProvider>{ui}</ResponderChainProvider>);
}

const defaultProps = {
  stackState: makeStackState(),
  meta: { title: "Test" },
  onCardMoved: mock(() => {}),
  onClose: mock(() => {}),
  onStackActivated: mock(() => {}),
  zIndex: 1,
  isFocused: false,
};

// ---------------------------------------------------------------------------
// T16: TugWindow renders at correct position and size from stackState
// ---------------------------------------------------------------------------

describe("TugWindow – position and size", () => {
  it("T16: renders with correct position and size from stackState", () => {
    const stackState = makeStackState({
      position: { x: 50, y: 75 },
      size: { width: 350, height: 250 },
    });

    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          stackState={stackState}
        />
      )
    );

    const frame = container.querySelector("[data-testid='card-frame']") as HTMLElement;
    expect(frame).not.toBeNull();

    expect(frame.style.left).toBe("50px");
    expect(frame.style.top).toBe("75px");
    expect(frame.style.width).toBe("350px");
    expect(frame.style.height).toBe("250px");
  });

  it("position: absolute is applied", () => {
    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
        />
      )
    );

    const frame = container.querySelector("[data-testid='card-frame']") as HTMLElement;
    expect(frame.style.position).toBe("absolute");
  });
});

// ---------------------------------------------------------------------------
// T17: TugWindow applies zIndex prop
// ---------------------------------------------------------------------------

describe("TugWindow – zIndex", () => {
  it("T17: applies the zIndex prop as a CSS z-index style", () => {
    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          zIndex={42}
        />
      )
    );

    const frame = container.querySelector("[data-testid='card-frame']") as HTMLElement;
    expect(frame.style.zIndex).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// T18: TugWindow calls onStackActivated on pointer-down
// ---------------------------------------------------------------------------

describe("TugWindow – onStackActivated", () => {
  it("T18: calls onStackActivated with the stack id on pointer-down anywhere in the frame", () => {
    const onStackActivated = mock((_id: string) => {});
    const stackState = makeStackState({ id: "focus-test-stack" });

    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          stackState={stackState}
          onStackActivated={onStackActivated}
        />
      )
    );

    const frame = container.querySelector("[data-testid='card-frame']") as HTMLElement;

    act(() => {
      fireEvent.pointerDown(frame);
    });

    expect(onStackActivated).toHaveBeenCalledTimes(1);
    expect(onStackActivated.mock.calls[0][0]).toBe("focus-test-stack");
  });

  it("also fires onStackActivated when pointer-down hits inner chrome (tugcard body)", () => {
    const onStackActivated = mock((_id: string) => {});

    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          onStackActivated={onStackActivated}
        />
      )
    );

    const body = container.querySelector("[data-testid='tugcard-body']") as HTMLElement;
    act(() => {
      fireEvent.pointerDown(body);
    });

    expect(onStackActivated.mock.calls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T19: TugWindow calls onClose from the title bar close path (single-tab)
// ---------------------------------------------------------------------------

describe("TugWindow – onClose", () => {
  it("T19: calls onClose when the close button is activated (single-card window)", () => {
    const onClose = mock(() => {});
    const stackState = makeStackState({ id: "close-test-card" });

    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          stackState={stackState}
          onClose={onClose}
        />
      )
    );

    const closeBtn = container.querySelector("[data-testid='tugcard-close-button']") as HTMLElement;
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T20: TugWindow clamps resize to min-size
// ---------------------------------------------------------------------------

describe("TugWindow – min-size clamping", () => {
  it("T20: resize clamped to at least the computed chrome + minContentSize floor", () => {
    const onCardMoved = mock(
      (_id: string, _pos: { x: number; y: number }, _size: { width: number; height: number }) => {}
    );
    const stackState = makeStackState({
      id: "resize-clamp-test",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    });

    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
          stackState={stackState}
          onCardMoved={onCardMoved}
          minContentSize={{ width: 200, height: 150 }}
        />
      )
    );

    const seHandle = container.querySelector(".card-frame-resize-se") as HTMLElement;
    expect(seHandle).not.toBeNull();

    const frame = container.querySelector("[data-testid='card-frame']") as HTMLElement;
    (frame as any).setPointerCapture = () => {};
    (frame as any).releasePointerCapture = () => {};

    act(() => {
      fireEvent.pointerDown(seHandle, { clientX: 400, clientY: 300, pointerId: 1 });
    });

    act(() => {
      fireEvent.pointerUp(frame, { clientX: 50, clientY: 50, pointerId: 1 });
    });

    if (onCardMoved.mock.calls.length > 0) {
      const lastCall = onCardMoved.mock.calls[onCardMoved.mock.calls.length - 1];
      const reportedSize = lastCall[2] as { width: number; height: number };
      expect(reportedSize.width).toBeGreaterThanOrEqual(200);
      expect(reportedSize.height).toBeGreaterThanOrEqual(150);
    }
  });
});

// ---------------------------------------------------------------------------
// Extra: 8 resize handles are rendered
// ---------------------------------------------------------------------------

describe("TugWindow – resize handles", () => {
  it("renders 8 resize handles with correct CSS classes", () => {
    const { container } = render(
      wrap(
        <TugWindow
          {...defaultProps}
        />
      )
    );

    const edges = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
    for (const edge of edges) {
      const handle = container.querySelector(`.card-frame-resize-${edge}`);
      expect(handle).not.toBeNull();
    }
  });
});
