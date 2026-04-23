/**
 * TugCheckbox persistence opt-in — first-consumer proof for the
 * Component Persistence Protocol ([D13], [A9]).
 *
 * These tests pin the component-level contract visible to card
 * authors who set `persistKey`:
 *
 *   1. Without `persistKey`, the checkbox does not register with the
 *      card's registry and `bag.components` stays absent — opt-in is
 *      truly opt-in.
 *   2. With `persistKey` in uncontrolled mode, the checkbox captures
 *      its current `checked` state into `bag.components[persistKey]`
 *      and restores it on a fresh mount.
 *   3. With `persistKey` in controlled mode, restore dispatches a
 *      `toggle` action through the responder chain so the parent
 *      state owner updates. This is the best-effort path acknowledged
 *      in the plan — the parent is still the source of truth.
 *   4. `<PersistenceScope prefix>` prefixing composes with the
 *      checkbox's own `persistKey`.
 */

import "../../../__tests__/setup-rtl";

import React, { useId, useState } from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

import { TugCheckbox } from "../tug-checkbox";
import { ComponentPersistenceRegistry } from "../component-persistence-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";
import {
  CardComponentRegistryContext,
  PersistenceScope,
} from "../use-component-persistence";
import { useResponderForm } from "../use-responder-form";
import { ResponderChainProvider } from "../responder-chain-provider";

function renderUnderCard(
  registry: ComponentPersistenceRegistry,
  ui: React.ReactElement,
) {
  return render(
    <ResponderChainProvider>
      <CardComponentRegistryContext.Provider
        value={{ registry, prefix: "", treePath: [] }}
      >
        {ui}
      </CardComponentRegistryContext.Provider>
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

describe("TugCheckbox — persistence opt-in", () => {
  test("no persistKey prop → no registration, no bag.components", () => {
    const registry = new ComponentPersistenceRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    renderUnderCard(registry, <TugCheckbox label="Maybe" />);
    expect(registry.keys().size).toBe(0);

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toBeUndefined();
  });

  test("uncontrolled opt-in captures checked = true after user click", () => {
    const registry = new ComponentPersistenceRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox persistKey="done" label="Done" />,
    );
    expect(registry.keys()).toEqual(new Set(["done"]));
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");

    clickCheckbox(container);
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ done: { checked: true } });
  });

  test("uncontrolled opt-in restores checked state on a fresh mount", () => {
    const registry = new ComponentPersistenceRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox persistKey="done" label="Done" />,
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
    const registry = new ComponentPersistenceRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <TugCheckbox persistKey="done" defaultChecked={true} label="Done" />,
    );
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ done: { checked: true } });
  });

  test("controlled opt-in restores via responder-chain toggle dispatch", () => {
    const registry = new ComponentPersistenceRegistry();
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
              persistKey="done"
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

  test("<PersistenceScope prefix> composes with the checkbox persistKey", () => {
    const registry = new ComponentPersistenceRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      <PersistenceScope prefix="task-panel">
        <TugCheckbox persistKey="done" label="Done" />
      </PersistenceScope>,
    );
    expect(registry.keys()).toEqual(new Set(["task-panel/done"]));

    clickCheckbox(container);
    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ "task-panel/done": { checked: true } });
  });
});
