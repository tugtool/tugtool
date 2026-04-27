/**
 * TugCheckbox state preservation opt-in — first-consumer proof for the
 * Component State Preservation Protocol ([D13], [A9]).
 *
 * These tests pin the component-level contract visible to card
 * authors who set `componentStatePreservationKey`:
 *
 *   1. Without `componentStatePreservationKey`, the checkbox does not
 *      register with the card's registry and `bag.components` stays
 *      absent — opt-in is truly opt-in.
 *   2. With `componentStatePreservationKey` in uncontrolled mode, the
 *      checkbox captures its current `checked` state into
 *      `bag.components[componentStatePreservationKey]` and restores it
 *      on a fresh mount.
 *   3. With `componentStatePreservationKey` in controlled mode,
 *      restore dispatches a `toggle` action through the responder
 *      chain so the parent state owner updates. This is the
 *      best-effort path acknowledged in the plan — the parent is
 *      still the source of truth.
 *   4. `<ComponentStatePreservationScope prefix>` prefixing composes
 *      with the checkbox's own `componentStatePreservationKey`.
 */

import "../../../__tests__/setup-rtl";

import React, { useId, useState } from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

import { TugCheckbox } from "../tug-checkbox";
import { ComponentStatePreservationRegistry } from "../component-state-preservation-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";
import {
  CardComponentStatePreservationContext,
  ComponentStatePreservationScope,
} from "../use-component-state-preservation";
import { useResponderForm } from "../use-responder-form";
import { ResponderChainProvider } from "../responder-chain-provider";

function renderUnderCard(
  registry: ComponentStatePreservationRegistry,
  ui: React.ReactElement,
) {
  return render(
    <ResponderChainProvider>
      <CardComponentStatePreservationContext.Provider
        value={{ registry, prefix: "", treePath: [] }}
      >
        {ui}
      </CardComponentStatePreservationContext.Provider>
    </ResponderChainProvider>,
  );
}

function clickCheckbox(container: HTMLElement): void {
  const button = container.querySelector<HTMLButtonElement>(
    'button[data-slot="tug-checkbox"]',
  );
  if (!button) throw new Error("expected a tug-checkbox button");
  act(() => {
    fireEvent.click(button);
  });
}

function getCheckboxCheckedAttr(container: HTMLElement): string | null {
  const button = container.querySelector<HTMLButtonElement>(
    'button[data-slot="tug-checkbox"]',
  );
  if (!button) throw new Error("expected a tug-checkbox button");
  return button.getAttribute("data-state");
}

afterEach(() => {
  cleanup();
});

describe("TugCheckbox — state preservation opt-in", () => {
  test("no componentStatePreservationKey prop → no registration, no bag.components", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    renderUnderCard(registry, <TugCheckbox label="Maybe" />);
    expect(registry.keys().size).toBe(0);

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toBeUndefined();
  });

  test("uncontrolled opt-in captures checked = true after user click", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox componentStatePreservationKey="done" label="Done" />,
    );
    expect(registry.keys()).toEqual(new Set(["done"]));
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");

    clickCheckbox(container);
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ done: { checked: true } });
  });

  test("uncontrolled opt-in restores checked state on a fresh mount", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox componentStatePreservationKey="done" label="Done" />,
    );
    // Simulate a previously-saved bag being restored before user input.
    act(() => {
      orchestrator.restoreCardState("c", {
        components: { done: { checked: true } },
      });
    });
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    // And toggling once after restore flips it back off.
    clickCheckbox(container);
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");
  });

  test("defaultChecked seeds the uncontrolled mirror at mount", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox
        componentStatePreservationKey="done"
        defaultChecked={true}
        label="Done"
      />,
    );
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ done: { checked: true } });
  });

  test("controlled opt-in restores via responder-chain toggle dispatch", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);

    function Harness(): React.ReactElement {
      const [checked, setChecked] = useState(false);
      const cbId = useId();
      const { ResponderScope, responderRef } = useResponderForm({
        toggle: {
          [cbId]: setChecked,
        },
      });
      return (
        <ResponderScope>
          <div ref={responderRef as (el: HTMLDivElement | null) => void}>
            <TugCheckbox
              componentStatePreservationKey="done"
              senderId={cbId}
              label="Done"
              checked={checked}
            />
            <span data-testid="state">{checked ? "on" : "off"}</span>
          </div>
        </ResponderScope>
      );
    }

    const { container, getByTestId } = renderUnderCard(registry, <Harness />);
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");
    expect(getByTestId("state").textContent).toBe("off");

    // Simulate a saved bag being restored. The component should
    // dispatch a `toggle` through the chain and the harness's state
    // setter fires — parent wins and re-renders with checked=true.
    act(() => {
      orchestrator.restoreCardState("c", {
        components: { done: { checked: true } },
      });
    });
    expect(getByTestId("state").textContent).toBe("on");
    expect(getCheckboxCheckedAttr(container)).toBe("checked");
  });

  test("<ComponentStatePreservationScope prefix> composes with the checkbox componentStatePreservationKey", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <ComponentStatePreservationScope prefix="task-panel">
        <TugCheckbox componentStatePreservationKey="done" label="Done" />
      </ComponentStatePreservationScope>,
    );
    expect(registry.keys()).toEqual(new Set(["task-panel/done"]));

    clickCheckbox(container);
    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ "task-panel/done": { checked: true } });
  });
});
