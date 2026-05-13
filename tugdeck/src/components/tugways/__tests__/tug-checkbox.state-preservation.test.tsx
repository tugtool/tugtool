/**
 * TugCheckbox state preservation opt-in — first-consumer proof for the
 * Component State Preservation Protocol ([D13], [A9]).
 *
 * These tests pin the component-level contract visible to card authors
 * who set `componentStatePreservationKey`:
 *
 *   1. Without `componentStatePreservationKey`, the checkbox does not
 *      register with the card's registry and `bag.components` stays
 *      absent — opt-in is truly opt-in.
 *   2. With `componentStatePreservationKey` in uncontrolled mode, the
 *      checkbox captures its current `checked` state into
 *      `bag.components[componentStatePreservationKey]`.
 *   3. With `componentStatePreservationKey` in uncontrolled mode, a
 *      saved bag delivered through the context's
 *      `getSavedComponentState` accessor seeds the checkbox's
 *      `useState` initializer so it mounts already in the saved state
 *      — no toggle flicker, no post-mount apply.
 *   4. `<ComponentStatePreservationScope prefix>` prefixing composes
 *      with the checkbox's own `componentStatePreservationKey`.
 *
 * After Phase E.8 the restore half is handled at mount-time via
 * `useSavedComponentState`; there is no orchestrator.restoreCardState
 * to call from tests. The "fresh mount with saved state" case is now
 * driven by configuring the context value's
 * `getSavedComponentState` accessor before render.
 */

import "../../../__tests__/setup-rtl";

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

import { TugCheckbox } from "../tug-checkbox";
import { ComponentStatePreservationRegistry } from "../component-state-preservation-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";
import {
  CardComponentStatePreservationContext,
  ComponentStatePreservationScope,
} from "../use-component-state-preservation";
import { ResponderChainProvider } from "../responder-chain-provider";

function renderUnderCard(
  registry: ComponentStatePreservationRegistry,
  savedComponentState: Record<string, unknown>,
  ui: React.ReactElement,
) {
  return render(
    <ResponderChainProvider>
      <CardComponentStatePreservationContext.Provider
        value={{
          registry,
          prefix: "",
          treePath: [],
          getSavedComponentState: (scopedKey: string): unknown =>
            savedComponentState[scopedKey],
          getSavedRegionScroll: () => undefined,
          subscribe: () => () => {},
        }}
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

    renderUnderCard(registry, {}, <TugCheckbox label="Maybe" />);
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
      {},
      <TugCheckbox componentStatePreservationKey="done" label="Done" />,
    );
    expect(registry.keys()).toEqual(new Set(["done"]));
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");

    clickCheckbox(container);
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ done: { checked: true } });
  });

  test("uncontrolled opt-in mounts in saved state when the context carries a saved value", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);

    // Saved bag delivered through the context — the checkbox reads it
    // synchronously in `useState`'s initializer, so the very first
    // paint reflects the saved value (no flicker, no apply effect).
    const { container } = renderUnderCard(
      registry,
      { done: { checked: true } },
      <TugCheckbox componentStatePreservationKey="done" label="Done" />,
    );
    expect(getCheckboxCheckedAttr(container)).toBe("checked");

    // And toggling once after mount flips it back off.
    clickCheckbox(container);
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");
  });

  test("defaultChecked seeds the uncontrolled mirror at mount when no saved value is present", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      {},
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

  test("a saved value wins over defaultChecked at mount", () => {
    const registry = new ComponentStatePreservationRegistry();

    const { container } = renderUnderCard(
      registry,
      { done: { checked: false } },
      <TugCheckbox
        componentStatePreservationKey="done"
        defaultChecked={true}
        label="Done"
      />,
    );
    // Saved state ("unchecked") wins over `defaultChecked={true}` —
    // the user explicitly unchecked this control before saving.
    expect(getCheckboxCheckedAttr(container)).toBe("unchecked");
  });

  test("<ComponentStatePreservationScope prefix> composes with the checkbox componentStatePreservationKey", () => {
    const registry = new ComponentStatePreservationRegistry();
    const orchestrator = new CardStateOrchestrator(() => registry);
    orchestrator.registerAssembler("c", { capture: () => ({}) });

    const { container } = renderUnderCard(
      registry,
      {},
      <ComponentStatePreservationScope prefix="task-panel">
        <TugCheckbox componentStatePreservationKey="done" label="Done" />
      </ComponentStatePreservationScope>,
    );
    expect(registry.keys()).toEqual(new Set(["task-panel/done"]));

    clickCheckbox(container);
    const bag = orchestrator.captureCardState("c");
    expect(bag.components).toEqual({ "task-panel/done": { checked: true } });
  });

  test("scoped saved values land in the right slot at mount", () => {
    const registry = new ComponentStatePreservationRegistry();

    const { container } = renderUnderCard(
      registry,
      { "task-panel/done": { checked: true } },
      <ComponentStatePreservationScope prefix="task-panel">
        <TugCheckbox componentStatePreservationKey="done" label="Done" />
      </ComponentStatePreservationScope>,
    );
    expect(getCheckboxCheckedAttr(container)).toBe("checked");
  });
});
