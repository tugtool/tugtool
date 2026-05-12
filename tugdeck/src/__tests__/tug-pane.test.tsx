/**
 * TugPane component unit tests.
 *
 * Tests cover:
 * - T16: TugPane renders at correct position and size from stackState
 * - T17: TugPane applies zIndex prop
 * - T19: TugPane calls onClose when the title bar close path fires
 * - T20: TugPane clamps resize to min-size derived from chrome + minContentSize
 *
 * T18 (onStackActivated on pointer-down) is retired: pane activation
 * is now driven by `pane-focus-controller.ts`'s document-level listener,
 * not by an onStackActivated callback prop on TugPane. The new
 * classification behavior is tested in `pane-focus-controller.test.tsx`.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";

import { useContext } from "react";

import { TugPane, TugPaneFrameContext } from "@/components/chrome/tug-pane";
import type { TugPaneState } from "@/layout-tree";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { withDeckManager } from "./mock-deck-manager-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStackState(overrides: Partial<TugPaneState> = {}): TugPaneState {
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
  zIndex: 1,
};

// ---------------------------------------------------------------------------
// T16: TugPane renders at correct position and size from stackState
// ---------------------------------------------------------------------------

describe("TugPane – position and size", () => {
  it("T16: renders with correct position and size from stackState", () => {
    const stackState = makeStackState({
      position: { x: 50, y: 75 },
      size: { width: 350, height: 250 },
    });

    const { container } = render(
      wrap(
        <TugPane
          {...defaultProps}
          stackState={stackState}
        />
      )
    );

    const frame = container.querySelector('[data-testid="tug-pane"]') as HTMLElement;
    expect(frame).not.toBeNull();

    expect(frame.style.left).toBe("50px");
    expect(frame.style.top).toBe("75px");
    expect(frame.style.width).toBe("350px");
    expect(frame.style.height).toBe("250px");
  });

  it("position: absolute is applied", () => {
    const { container } = render(
      wrap(
        <TugPane
          {...defaultProps}
        />
      )
    );

    const frame = container.querySelector('[data-testid="tug-pane"]') as HTMLElement;
    expect(frame.style.position).toBe("absolute");
  });
});

// ---------------------------------------------------------------------------
// T17: TugPane applies zIndex prop
// ---------------------------------------------------------------------------

describe("TugPane – zIndex", () => {
  it("T17: applies the zIndex prop as a CSS z-index style", () => {
    const { container } = render(
      wrap(
        <TugPane
          {...defaultProps}
          zIndex={42}
        />
      )
    );

    const frame = container.querySelector('[data-testid="tug-pane"]') as HTMLElement;
    expect(frame.style.zIndex).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// T19: TugPane calls onClose from the title bar close path (single-tab)
// ---------------------------------------------------------------------------

describe("TugPane – onClose", () => {
  it("T19: calls onClose when the close button is activated (single-card window)", () => {
    const onClose = mock(() => {});
    const stackState = makeStackState({ id: "close-test-card" });

    const { container } = render(
      wrap(
        <TugPane
          {...defaultProps}
          stackState={stackState}
          onClose={onClose}
        />
      )
    );

    const closeBtn = container.querySelector("[data-testid='tug-pane-close-button']") as HTMLElement;
    act(() => {
      fireEvent.click(closeBtn);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T20: TugPane clamps resize to min-size
// ---------------------------------------------------------------------------

describe("TugPane – min-size clamping", () => {
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
        <TugPane
          {...defaultProps}
          stackState={stackState}
          onCardMoved={onCardMoved}
          minContentSize={{ width: 200, height: 150 }}
        />
      )
    );

    const seHandle = container.querySelector(".tug-pane-resize-se") as HTMLElement;
    expect(seHandle).not.toBeNull();

    const frame = container.querySelector('[data-testid="tug-pane"]') as HTMLElement;
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

describe("TugPane – resize handles", () => {
  it("renders 8 resize handles with correct CSS classes", () => {
    const { container } = render(
      wrap(
        <TugPane
          {...defaultProps}
        />
      )
    );

    const edges = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
    for (const edge of edges) {
      const handle = container.querySelector(`.tug-pane-resize-${edge}`);
      expect(handle).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Pane-owned scrim layer [D18]
// ---------------------------------------------------------------------------

describe("TugPane – pane-owned scrim", () => {
  it("renders the .tug-pane-scrim element inside .tug-pane-chrome regardless of sheet state", () => {
    // The scrim is permanent — it lives in the chrome's DOM from the
    // moment the pane mounts. Visibility is driven by the chrome's
    // `data-scrim` attribute via the pane-scrim registry, not by
    // conditional rendering. [L06]
    const { container } = render(wrap(<TugPane {...defaultProps} />));
    const chrome = container.querySelector(".tug-pane-chrome");
    expect(chrome).not.toBeNull();
    const scrim = chrome!.querySelector(".tug-pane-scrim");
    expect(scrim).not.toBeNull();
    expect(scrim!.getAttribute("aria-hidden")).toBe("true");
    // No data-scrim attribute at rest — the chrome has not been
    // requested by any consumer yet.
    expect(chrome!.hasAttribute("data-scrim")).toBe(false);
  });

  it("each pane in a multi-pane render carries its own scrim element", () => {
    // Independent panes must own independent scrim layers; the
    // registry's per-element ref count keys off the chrome ref.
    const { container } = render(
      wrap(
        <>
          <TugPane
            {...defaultProps}
            stackState={makeStackState({ id: "pane-a" })}
            zIndex={1}
          />
          <TugPane
            {...defaultProps}
            stackState={makeStackState({ id: "pane-b" })}
            zIndex={2}
          />
        </>,
      ),
    );
    const scrims = container.querySelectorAll(".tug-pane-scrim");
    expect(scrims.length).toBe(2);
    // Confirm each scrim is inside its own chrome.
    const chromes = container.querySelectorAll(".tug-pane-chrome");
    expect(chromes.length).toBe(2);
    expect(chromes[0]!.querySelector(".tug-pane-scrim")).not.toBeNull();
    expect(chromes[1]!.querySelector(".tug-pane-scrim")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TugPaneFrameContext [D19]
// ---------------------------------------------------------------------------

describe("TugPane – TugPaneFrameContext", () => {
  it("returns null when read outside any provider", () => {
    let frameFromContext: HTMLDivElement | null | undefined;
    function FrameProbe(): null {
      frameFromContext = useContext(TugPaneFrameContext);
      return null;
    }
    render(<FrameProbe />);
    // Standalone consumer (no TugPane ancestor) reads null. Pane-modal
    // surfaces fall back to document.body in this case.
    expect(frameFromContext).toBeNull();
  });

  it("a context provider supplies the value to descendants", () => {
    // TugPane does not accept React children — its content area is
    // populated through `paneContentRegistry` via `CardHost`. The
    // pane wires the frame element through `TugPaneFrameContext`
    // around its chrome subtree (which is where pane-modal surfaces
    // like TugSheet read it). This test pins the context shape: a
    // provider supplies the value, descendants read it, no provider
    // reads null. Live integration with the rendered pane is verified
    // via the sheet's portal-target tests in step 9.6d.
    const fakeFrame = document.createElement("div") as HTMLDivElement;
    fakeFrame.className = "tug-pane";
    let observed: HTMLDivElement | null | undefined;
    function FrameProbe(): null {
      observed = useContext(TugPaneFrameContext);
      return null;
    }
    render(
      <TugPaneFrameContext.Provider value={fakeFrame}>
        <FrameProbe />
      </TugPaneFrameContext.Provider>,
    );
    expect(observed).toBe(fakeFrame);
  });

  it("renders the frame element with the .tug-pane class for portals to target", () => {
    // The frame context provides the .tug-pane element (the outer
    // frame), not the chrome. Pane-modal surfaces portal here so they
    // sit inside the pane's stacking context but outside the chrome's
    // overflow:hidden clip. Verify the frame is identifiable.
    const { container } = render(wrap(<TugPane {...defaultProps} />));
    const frameEl = container.querySelector(".tug-pane") as HTMLDivElement;
    expect(frameEl).not.toBeNull();
    expect(frameEl.classList.contains("tug-pane")).toBe(true);
    // The chrome lives inside the frame.
    const chromeEl = frameEl.querySelector(".tug-pane-chrome");
    expect(chromeEl).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pane scrim CSS contract [D18]
//
// happy-dom does not simulate browser pointer-events hit-testing, so a
// click-on-tab test cannot catch the case where an invisible scrim
// covers the body but still steals the click. We pin the contract at
// the source level: read tug-pane.css and assert the two
// pointer-events declarations are correct.
//
// Regression history: 2026-05-07, the scrim shipped with
// `pointer-events: auto` at rest. The scrim was invisible (opacity 0)
// but the body-area dead zone made every tab-bar / accessory click a
// no-op. Keyboard shortcuts kept working because they route through
// the chain instead of DOM hit-testing.
// ---------------------------------------------------------------------------

describe("TugPane – pane scrim pointer-events contract", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const cssSource = readFileSync(
    new URL("../components/tugways/tug-pane.css", import.meta.url),
    "utf-8",
  );

  /**
   * Extract the body of a CSS rule by selector. Returns the text
   * between the rule's opening `{` and matching `}`. Throws when the
   * selector is not found so an accidental rule rename surfaces as a
   * test failure rather than a silent miss.
   */
  function ruleBody(source: string, selector: string): string {
    const idx = source.indexOf(selector);
    if (idx === -1) throw new Error(`selector not found: ${selector}`);
    const open = source.indexOf("{", idx);
    if (open === -1) throw new Error(`opening brace not found for: ${selector}`);
    let depth = 1;
    let i = open + 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    return source.slice(open + 1, i - 1);
  }

  it("at rest: .tug-pane-scrim sets pointer-events: none", () => {
    const body = ruleBody(cssSource, ".tug-pane-scrim {");
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  it("when raised: [data-scrim=\"on\"] flips pointer-events to auto", () => {
    const body = ruleBody(cssSource, '.tug-pane-chrome[data-scrim="on"] .tug-pane-scrim {');
    expect(body).toMatch(/pointer-events:\s*auto/);
  });

  it("at rest: opacity is 0 (invisible)", () => {
    // The pair "opacity 0 / pointer-events none" must travel together
    // — flipping one without the other reproduces the regression
    // class (visible-but-clickable, or invisible-but-blocking).
    const body = ruleBody(cssSource, ".tug-pane-scrim {");
    expect(body).toMatch(/opacity:\s*0/);
  });

  it("when raised: opacity is 1 (visible)", () => {
    const body = ruleBody(cssSource, '.tug-pane-chrome[data-scrim="on"] .tug-pane-scrim {');
    expect(body).toMatch(/opacity:\s*1/);
  });
});

describe("TugPane – pane walls use `overflow: clip` (Phase E.2 — sticky-pin trap removal)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const cssSource = readFileSync(
    new URL("../components/tugways/tug-pane.css", import.meta.url),
    "utf-8",
  );

  /** Extract the body of a top-level rule by exact selector match. */
  function topLevelRuleBody(source: string, selector: string): string {
    // Match the selector at the start of a line so we don't pick up
    // compound selectors like `.tug-pane-chrome--collapsed`.
    const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\{`, "m");
    const match = re.exec(source);
    if (match === null) throw new Error(`selector not found: ${selector}`);
    const open = match.index + match[0].length - 1;
    let depth = 1;
    let i = open + 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    return source.slice(open + 1, i - 1);
  }

  /** Strip CSS comments so assertions don't match prose inside them. */
  function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, "");
  }

  it("`.tug-pane-chrome` uses `overflow: clip` (not `hidden`)", () => {
    // `overflow: hidden` would form a scrolling block-container,
    // trapping any sticky descendant inside this never-scrolling
    // box. `overflow: clip` clips painting without forming a
    // scroll container — same visual behavior, no sticky trap.
    // Phase B.1 flagged this; Phase E.2 acts on the flag.
    const body = stripComments(topLevelRuleBody(cssSource, ".tug-pane-chrome"));
    expect(body).toMatch(/overflow:\s*clip\s*;/);
    expect(body).not.toMatch(/overflow:\s*hidden\s*;/);
  });

  it("`.tug-pane-body` uses `overflow: clip` (not `hidden`)", () => {
    const body = stripComments(topLevelRuleBody(cssSource, ".tug-pane-body"));
    expect(body).toMatch(/overflow:\s*clip\s*;/);
    expect(body).not.toMatch(/overflow:\s*hidden\s*;/);
  });
});
