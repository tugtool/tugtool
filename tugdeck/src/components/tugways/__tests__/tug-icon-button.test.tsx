/**
 * TugIconButton tests.
 *
 * Pins the four invariants the primitive exists to enforce:
 *
 *  1. Renders `data-tug-focus="refuse"` and `data-slot="tug-icon-button"`
 *     so the chain's pointerdown promotion + browser focus shift are
 *     skipped and the button is greppable.
 *  2. Chain-action mode (`dispatch` prop) reaches the parent responder
 *     via `useControlDispatch`'s `sendToTarget` walk, with the original
 *     `value` payload preserved.
 *  3. Direct-action mode (`onClick`) fires when no `dispatch` is set.
 *  4. Mutual exclusivity: setting both produces a dev-mode warning;
 *     `dispatch` wins at runtime.
 *
 * Sender id fallback (auto-derived `useId()` when the caller's event
 * omits `sender`) is also pinned because handlers that disambiguate by
 * sender depend on it.
 *
 * Note: setup-rtl MUST be the first import per the project's RTL test
 * convention.
 */
import "../../../__tests__/setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { Trash2 } from "lucide-react";

import {
  ResponderChainContext,
  ResponderParentContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";
import type { ActionEvent, ActionHandler } from "@/components/tugways/responder-chain";
import type { TugAction } from "@/components/tugways/action-vocabulary";
import { TugIconButton } from "@/components/tugways/tug-icon-button";

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
 * Render a TugIconButton inside a manager that has a parent responder
 * registered with the supplied action handler. The dispatched events are
 * collected in an array for assertion.
 */
function renderWithManager(
  actionName: string,
  props: React.ComponentProps<typeof TugIconButton>,
): RenderResult {
  const manager = new ResponderChainManager();
  const dispatched: ActionEvent[] = [];
  const handler: ActionHandler = (event: ActionEvent) => {
    dispatched.push(event);
  };
  manager.register({
    id: "parent",
    parentId: null,
    actions: { [actionName]: handler },
  });
  const { container } = render(
    <ResponderChainContext.Provider value={manager}>
      <ResponderParentContext.Provider value="parent">
        <TugIconButton {...props} />
      </ResponderParentContext.Provider>
    </ResponderChainContext.Provider>,
  );
  return { manager, dispatched, container };
}

// ---------------------------------------------------------------------------
// Static markup invariants
// ---------------------------------------------------------------------------

describe("TugIconButton – markup", () => {
  it("renders data-tug-focus='refuse' so the chain skips first-responder promotion on click", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" />,
    );
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("data-tug-focus")).toBe("refuse");
  });

  it("renders data-slot='tug-icon-button' so consumers can scope CSS without reaching into TugButton internals", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" />,
    );
    const btn = container.querySelector("button");
    expect(btn!.getAttribute("data-slot")).toBe("tug-icon-button");
  });

  it("forwards aria-label to the underlying button", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget session 12345678" />,
    );
    const btn = container.querySelector("button");
    expect(btn!.getAttribute("aria-label")).toBe("Forget session 12345678");
  });

  it("renders the icon node inside the button", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 data-testid="trash-icon" />} aria-label="Forget" />,
    );
    expect(container.querySelector('[data-testid="trash-icon"]')).not.toBeNull();
  });

  it("size='sm' (default) maps to TugButton's icon-sm sizing", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.classList.contains("tug-button-icon-sm")).toBe(true);
  });

  it("size='md' maps to TugButton's icon-md sizing", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" size="md" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.classList.contains("tug-button-icon-md")).toBe(true);
  });

  it("tone='default' (default) maps to TugButton role=action (ghost-action class)", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Action" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.classList.contains("tug-button-ghost-action")).toBe(true);
  });

  it("tone='danger' maps to TugButton role=danger (ghost-danger class)", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" tone="danger" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.classList.contains("tug-button-ghost-danger")).toBe(true);
  });

  it("disabled prop produces an HTML-disabled button", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" disabled />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("forwards className alongside the tug-icon-button class", () => {
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" className="my-custom-class" />,
    );
    const btn = container.querySelector("button")!;
    expect(btn.classList.contains("tug-icon-button")).toBe(true);
    expect(btn.classList.contains("my-custom-class")).toBe(true);
  });

  it("forwards ref to the underlying button element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<TugIconButton ref={ref} icon={<Trash2 />} aria-label="Forget" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

// ---------------------------------------------------------------------------
// Chain-action mode
// ---------------------------------------------------------------------------

describe("TugIconButton – chain-action mode", () => {
  it("clicking dispatches the provided ActionEvent to the parent responder", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget session abcd1234",
      dispatch: event,
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toMatchObject({
      action: "forget-session",
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    });
  });

  it("preserves the caller's sender when explicitly set on the dispatch event", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      sender: "explicit-sender-id",
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(dispatched[0].sender).toBe("explicit-sender-id");
  });

  it("auto-fills sender from useId() fallback when the dispatch event omits it", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    // The exact id is React-implementation-defined (e.g. ":r0:") — assert
    // only that *some* sender was filled in, not the specific value.
    expect(dispatched[0].sender).toBeDefined();
    expect(typeof dispatched[0].sender).toBe("string");
    expect((dispatched[0].sender as string).length).toBeGreaterThan(0);
  });

  it("uses a caller-supplied senderId when both senderId prop is set and dispatch.sender is omitted", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
      senderId: "deterministic-sender",
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(dispatched[0].sender).toBe("deterministic-sender");
  });

  it("does not dispatch when disabled", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
      disabled: true,
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(dispatched.length).toBe(0);
  });

  it("does not crash when rendered outside a ResponderChainProvider — chain dispatch becomes a no-op", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Forget" dispatch={event} />,
    );
    // Click without a provider should not throw — useControlDispatch
    // returns a no-op when manager or parent are absent.
    expect(() => {
      act(() => {
        fireEvent.click(container.querySelector("button")!);
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Direct-action mode
// ---------------------------------------------------------------------------

describe("TugIconButton – direct-action mode", () => {
  it("clicking fires the onClick callback when no dispatch is provided", () => {
    const handler = mock(() => {});
    const { container } = render(
      <TugIconButton icon={<Trash2 />} aria-label="Custom" onClick={handler} />,
    );
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const handler = mock(() => {});
    const { container } = render(
      <TugIconButton
        icon={<Trash2 />}
        aria-label="Custom"
        onClick={handler}
        disabled
      />,
    );
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    expect(handler).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Mode mutual exclusivity
// ---------------------------------------------------------------------------

describe("TugIconButton – dispatch + onClick mutual exclusivity", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("dispatch wins at runtime when both dispatch and onClick are set; onClick is ignored", () => {
    const onClickHandler = mock(() => {});
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    const { dispatched, container } = renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
      onClick: onClickHandler,
    });
    act(() => {
      fireEvent.click(container.querySelector("button")!);
    });
    // Chain dispatched, direct-action handler did not fire.
    expect(dispatched.length).toBe(1);
    expect(onClickHandler).toHaveBeenCalledTimes(0);
  });

  // Helper: filter out unrelated warnings emitted by the responder chain
  // and other surrounding infrastructure so the assertions pin
  // TugIconButton's own warning specifically.
  function tugIconButtonWarnings(): string[] {
    const calls = warnSpy.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>;
    return calls
      .map((call) => call[0])
      .filter((arg): arg is string => typeof arg === "string")
      .filter((msg: string) => msg.includes("TugIconButton"));
  }

  it("logs a dev-mode console warning when both dispatch and onClick are set", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
      onClick: () => {},
    });
    const ours = tugIconButtonWarnings();
    expect(ours.length).toBeGreaterThanOrEqual(1);
    expect(ours[0]).toContain("mutually exclusive");
  });

  it("does not warn when only dispatch is set", () => {
    const event: ActionEvent = {
      action: asAction("forget-session"),
      value: { sessionId: "abcd1234" },
      phase: "discrete",
    };
    renderWithManager("forget-session", {
      icon: <Trash2 />,
      "aria-label": "Forget",
      dispatch: event,
    });
    expect(tugIconButtonWarnings().length).toBe(0);
  });

  it("does not warn when only onClick is set", () => {
    render(
      <TugIconButton
        icon={<Trash2 />}
        aria-label="Custom"
        onClick={() => {}}
      />,
    );
    expect(tugIconButtonWarnings().length).toBe(0);
  });
});
