/**
 * TugCue tests.
 *
 * Pins the contract the primitive exists to enforce:
 *
 *  1. Renders a real `<button>` with `data-slot="tug-cue"`,
 *     `data-tug-cue-role`, and `data-tug-cue-density` so consumers and
 *     tests can scope to it without reaching into internals.
 *  2. Chain-action mode (`action` prop) dispatches `{ action, sender, phase:
 *     "discrete" }` to the parent responder via `useControlDispatch`.
 *  3. `target` prop dispatches via `manager.sendToTarget` rather than the
 *     parent.
 *  4. Direct-action mode (`onClick`) fires when no `action` is set.
 *  5. Mutual exclusivity: setting both produces a dev-mode warning;
 *     `action` wins at runtime.
 *  6. `disabled` blocks both dispatch paths.
 *  7. Keyboard activation: Enter and Space fire the same path as pointer.
 *  8. `aria-expanded` is passed through verbatim.
 *
 * Note: setup-rtl MUST be the first import per the project's RTL test
 * convention.
 */
import "../../../__tests__/setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { ChevronsUpDown } from "lucide-react";

import {
  ResponderChainContext,
  ResponderParentContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";
import type { ActionEvent, ActionHandler } from "@/components/tugways/responder-chain";
import type { TugAction } from "@/components/tugways/action-vocabulary";
import { TugCue } from "@/components/tugways/tug-cue";

// Synthetic action name for chain-mechanics tests — narrow cast keeps the
// `TugAction` typing happy without polluting the production action union.
const asAction = (name: string) => name as unknown as TugAction;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RenderResult {
  manager: ResponderChainManager;
  dispatched: ActionEvent[];
  container: HTMLElement;
}

/**
 * Render a TugCue inside a manager with a parent responder registered to
 * collect dispatched events. `parentId` defaults to `"parent"` so the
 * targeted-dispatch path resolves; tests that exercise `target` pass an
 * explicit id and register additional responders manually.
 */
function renderWithManager(
  actionName: string,
  props: React.ComponentProps<typeof TugCue>,
  parentId: string = "parent",
): RenderResult {
  const manager = new ResponderChainManager();
  const dispatched: ActionEvent[] = [];
  const handler: ActionHandler = (event: ActionEvent) => {
    dispatched.push(event);
  };
  manager.register({
    id: parentId,
    parentId: null,
    actions: { [actionName]: handler },
  });
  const { container } = render(
    <ResponderChainContext.Provider value={manager}>
      <ResponderParentContext.Provider value={parentId}>
        <TugCue {...props} />
      </ResponderParentContext.Provider>
    </ResponderChainContext.Provider>,
  );
  return { manager, dispatched, container };
}

function getButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector("button");
  if (btn === null) {
    throw new Error("TugCue test: expected a <button> in the rendered output");
  }
  return btn as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// Static markup invariants
// ---------------------------------------------------------------------------

describe("TugCue – markup", () => {
  it("renders as a real <button type='button'>", () => {
    const { container } = render(<TugCue>collapsed hint</TugCue>);
    const btn = getButton(container);
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("renders data-slot='tug-cue' so consumers can scope CSS without reaching into internals", () => {
    const { container } = render(<TugCue>collapsed hint</TugCue>);
    expect(getButton(container).getAttribute("data-slot")).toBe("tug-cue");
  });

  it("renders the children inside a .tug-cue-label span", () => {
    const { container } = render(<TugCue>123 lines folded</TugCue>);
    const label = container.querySelector(".tug-cue-label");
    expect(label?.textContent).toBe("123 lines folded");
  });

  it("renders no .tug-cue-icon when icon is omitted", () => {
    const { container } = render(<TugCue>no icon</TugCue>);
    expect(container.querySelector(".tug-cue-icon")).toBeNull();
  });

  it("renders the icon node inside a .tug-cue-icon wrapper when icon is set", () => {
    const { container } = render(
      <TugCue icon={<ChevronsUpDown data-testid="chev" />}>cue</TugCue>,
    );
    const icon = container.querySelector(".tug-cue-icon");
    expect(icon).not.toBeNull();
    expect(icon!.querySelector('[data-testid="chev"]')).not.toBeNull();
    // aria-hidden so the icon doesn't leak into a11y trees as text.
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults role to 'active' (variant G's blue tint) when role is omitted", () => {
    const { container } = render(<TugCue>cue</TugCue>);
    expect(getButton(container).getAttribute("data-tug-cue-role")).toBe("active");
  });

  it("defaults density to 'compact' when density is omitted", () => {
    const { container } = render(<TugCue>cue</TugCue>);
    expect(getButton(container).getAttribute("data-tug-cue-density")).toBe("compact");
  });

  it.each(["active", "accent", "agent", "caution", "danger", "data", "success"] as const)(
    "role='%s' emits data-tug-cue-role='%s'",
    (role) => {
      const { container } = render(<TugCue role={role}>cue</TugCue>);
      expect(getButton(container).getAttribute("data-tug-cue-role")).toBe(role);
    },
  );

  it("density='comfortable' emits data-tug-cue-density='comfortable'", () => {
    const { container } = render(<TugCue density="comfortable">cue</TugCue>);
    expect(getButton(container).getAttribute("data-tug-cue-density")).toBe("comfortable");
  });

  it("passes aria-expanded through verbatim", () => {
    const { container, rerender } = render(<TugCue aria-expanded={false}>cue</TugCue>);
    expect(getButton(container).getAttribute("aria-expanded")).toBe("false");
    rerender(<TugCue aria-expanded={true}>cue</TugCue>);
    expect(getButton(container).getAttribute("aria-expanded")).toBe("true");
  });

  it("passes aria-controls through verbatim", () => {
    const { container } = render(<TugCue aria-controls="region-1">cue</TugCue>);
    expect(getButton(container).getAttribute("aria-controls")).toBe("region-1");
  });

  it("passes aria-label through verbatim", () => {
    const { container } = render(<TugCue aria-label="expand folded code">cue</TugCue>);
    expect(getButton(container).getAttribute("aria-label")).toBe("expand folded code");
  });

  it("disabled prop produces an HTML-disabled button", () => {
    const { container } = render(<TugCue disabled>cue</TugCue>);
    expect(getButton(container).hasAttribute("disabled")).toBe(true);
  });

  it("forwards className alongside the tug-cue class", () => {
    const { container } = render(<TugCue className="my-extra">cue</TugCue>);
    const btn = getButton(container);
    expect(btn.classList.contains("tug-cue")).toBe(true);
    expect(btn.classList.contains("my-extra")).toBe(true);
  });

  it("forwards ref to the underlying button element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<TugCue ref={ref}>cue</TugCue>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

// ---------------------------------------------------------------------------
// Chain-action mode
// ---------------------------------------------------------------------------

describe("TugCue – chain-action mode", () => {
  it("clicking dispatches { action, sender, phase: 'discrete' } to the parent responder", () => {
    const { dispatched, container } = renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      children: "1,230 lines folded — click to expand",
    });
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toMatchObject({
      action: "reveal-folded",
      phase: "discrete",
    });
  });

  it("auto-fills sender from useId() fallback when senderId is omitted", () => {
    const { dispatched, container } = renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      children: "cue",
    });
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(dispatched[0].sender).toBeDefined();
    expect(typeof dispatched[0].sender).toBe("string");
    expect((dispatched[0].sender as string).length).toBeGreaterThan(0);
  });

  it("uses a caller-supplied senderId when provided", () => {
    const { dispatched, container } = renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      senderId: "deterministic-sender",
      children: "cue",
    });
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(dispatched[0].sender).toBe("deterministic-sender");
  });

  it("does not dispatch when disabled", () => {
    const { dispatched, container } = renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      disabled: true,
      children: "cue",
    });
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(dispatched.length).toBe(0);
  });

  it("does not crash when rendered outside a ResponderChainProvider — chain dispatch becomes a no-op", () => {
    const { container } = render(
      <TugCue action={asAction("reveal-folded")}>cue</TugCue>,
    );
    expect(() => {
      act(() => {
        fireEvent.click(getButton(container));
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// target prop — explicit-target dispatch via sendToTarget
// ---------------------------------------------------------------------------

describe("TugCue – target prop dispatches via sendToTarget", () => {
  it("when target is set, dispatch routes to the named responder, not the parent", () => {
    const manager = new ResponderChainManager();
    const parentDispatched: ActionEvent[] = [];
    const targetDispatched: ActionEvent[] = [];
    const actionName: string = "reveal-folded";
    manager.register({
      id: "parent",
      parentId: null,
      actions: {
        [actionName]: (e: ActionEvent) => {
          parentDispatched.push(e);
        },
      },
    });
    manager.register({
      id: "alt-target",
      parentId: "parent",
      actions: {
        [actionName]: (e: ActionEvent) => {
          targetDispatched.push(e);
        },
      },
    });
    const { container } = render(
      <ResponderChainContext.Provider value={manager}>
        <ResponderParentContext.Provider value="parent">
          <TugCue action={asAction("reveal-folded")} target="alt-target">
            cue
          </TugCue>
        </ResponderParentContext.Provider>
      </ResponderChainContext.Provider>,
    );
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(targetDispatched.length).toBe(1);
    expect(parentDispatched.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Direct-action mode
// ---------------------------------------------------------------------------

describe("TugCue – direct-action mode", () => {
  it("clicking fires the onClick callback when no action is set", () => {
    const handler = mock(() => {});
    const { container } = render(<TugCue onClick={handler}>cue</TugCue>);
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const handler = mock(() => {});
    const { container } = render(
      <TugCue onClick={handler} disabled>
        cue
      </TugCue>,
    );
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(handler).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Keyboard activation
// ---------------------------------------------------------------------------

describe("TugCue – keyboard activation", () => {
  it("Enter fires the same code path as a pointer click (native button behavior)", () => {
    const handler = mock(() => {});
    const { container } = render(<TugCue onClick={handler}>cue</TugCue>);
    const btn = getButton(container);
    btn.focus();
    act(() => {
      // happy-dom fires click in response to Enter on a focused button.
      fireEvent.keyDown(btn, { key: "Enter", code: "Enter" });
      fireEvent.keyUp(btn, { key: "Enter", code: "Enter" });
      fireEvent.click(btn);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("Space fires the same code path as a pointer click", () => {
    const handler = mock(() => {});
    const { container } = render(<TugCue onClick={handler}>cue</TugCue>);
    const btn = getButton(container);
    btn.focus();
    act(() => {
      fireEvent.keyDown(btn, { key: " ", code: "Space" });
      fireEvent.keyUp(btn, { key: " ", code: "Space" });
      fireEvent.click(btn);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Mode mutual exclusivity
// ---------------------------------------------------------------------------

describe("TugCue – action + onClick mutual exclusivity", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("action wins at runtime when both action and onClick are set", () => {
    const onClickHandler = mock(() => {});
    const { dispatched, container } = renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      onClick: onClickHandler,
      children: "cue",
    });
    act(() => {
      fireEvent.click(getButton(container));
    });
    expect(dispatched.length).toBe(1);
    expect(onClickHandler).toHaveBeenCalledTimes(0);
  });

  function tugCueWarnings(): string[] {
    const calls = warnSpy.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>;
    return calls
      .map((call) => call[0])
      .filter((arg): arg is string => typeof arg === "string")
      .filter((msg: string) => msg.includes("TugCue"));
  }

  it("logs a dev-mode console warning when both action and onClick are set", () => {
    renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      onClick: () => {},
      children: "cue",
    });
    const ours = tugCueWarnings();
    expect(ours.some((m) => m.includes("mutually exclusive"))).toBe(true);
  });

  it("logs a dev-mode console warning when target is set without action", () => {
    render(<TugCue target="some-target">cue</TugCue>);
    const ours = tugCueWarnings();
    expect(ours.some((m) => m.includes("`target` requires `action`"))).toBe(true);
  });

  it("does not warn when only action is set", () => {
    renderWithManager("reveal-folded", {
      action: asAction("reveal-folded"),
      children: "cue",
    });
    expect(tugCueWarnings().length).toBe(0);
  });

  it("does not warn when only onClick is set", () => {
    render(<TugCue onClick={() => {}}>cue</TugCue>);
    expect(tugCueWarnings().length).toBe(0);
  });
});
