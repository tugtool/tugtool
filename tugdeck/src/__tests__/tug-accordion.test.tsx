/**
 * TugAccordion unit tests — A2.4 chain dispatch coverage.
 *
 * Tests cover:
 * - Single-mode accordion: clicking a trigger dispatches toggleSection
 *   with a string payload (the opened item's value).
 * - Single-mode collapse-all: clicking the open item when collapsible
 *   dispatches toggleSection with an empty-string sentinel.
 * - Multi-mode accordion: clicking a trigger dispatches toggleSection
 *   with a string[] payload (the full set of currently open ids).
 * - senderId prop is honored: an explicit senderId flows through to
 *   the dispatched event; omitted senderId gets a stable useId()-derived
 *   fallback.
 * - Sender id remains stable across multiple interactions on the same
 *   accordion instance (gensym'd once per mount).
 * - Multiple accordions in the same provider disambiguate by sender id.
 *
 * These tests drive the chain via a real ResponderChainManager + an
 * `observeDispatch` observer — not by stubbing the dispatch layer.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { ResponderChainContext, ResponderParentContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render UI inside a controlled ResponderChainManager and attach an
 * `observeDispatch` observer that captures every chain dispatch. Returns
 * the container, the manager, and an array of captured events (mutated
 * in place as dispatches fire).
 */
function renderWithChainObserver(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  manager.register({ id: "root", parentId: null, actions: {} });
  const dispatched: Array<{ event: ActionEvent; handled: boolean }> = [];
  manager.observeDispatch((event, handled) => {
    dispatched.push({ event, handled });
  });
  const result = render(
    <ResponderChainContext.Provider value={manager}><ResponderParentContext.Provider value="root">
      {ui}
    </ResponderParentContext.Provider></ResponderChainContext.Provider>
  );
  return { ...result, manager, dispatched };
}

/** Click an accordion trigger by its item value via querySelector. */
function clickTriggerByValue(container: HTMLElement, value: string): void {
  const item = container.querySelector(`[data-slot='tug-accordion-item'][data-state][value]`);
  // Radix doesn't expose `value` on the item element directly; instead
  // each item's trigger is findable by walking from the item container.
  // We use the label text as a stable selector here since the test fixtures
  // set predictable trigger content.
  void item; // silence unused warning; fallback below
  const triggers = Array.from(
    container.querySelectorAll<HTMLButtonElement>(".tug-accordion-trigger"),
  );
  const match = triggers.find((btn) => btn.textContent?.includes(value));
  if (!match) {
    throw new Error(`No accordion trigger found containing text "${value}"`);
  }
  fireEvent.click(match);
}

/** Filter captured events down to toggleSection dispatches only. */
function toggleSectionEvents(
  dispatched: Array<{ event: ActionEvent; handled: boolean }>,
): ActionEvent[] {
  return dispatched.filter((d) => d.event.action === "toggle-section").map((d) => d.event);
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Single mode
// ---------------------------------------------------------------------------

describe("TugAccordion – single mode chain dispatch (A2.4)", () => {
  it("clicking a trigger dispatches toggleSection with the item value as a string", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion type="single" collapsible senderId="acc-single-a">
        <TugAccordionItem value="one" trigger="One">
          <p>one-body</p>
        </TugAccordionItem>
        <TugAccordionItem value="two" trigger="Two">
          <p>two-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "One");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      action: TUG_ACTIONS.TOGGLE_SECTION,
      value: "one",
      sender: "acc-single-a",
      phase: "discrete",
    });
  });

  it("clicking the open item in a collapsible single-mode accordion dispatches the empty-string sentinel", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion
        type="single"
        collapsible
        defaultValue="one"
        senderId="acc-single-collapse"
      >
        <TugAccordionItem value="one" trigger="One">
          <p>one-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    // The item is open by default (defaultValue="one"). Clicking its
    // trigger should collapse it; the dispatch payload is "" because
    // Radix reports "no open item" as an empty string.
    clickTriggerByValue(container, "One");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      action: TUG_ACTIONS.TOGGLE_SECTION,
      value: "",
      sender: "acc-single-collapse",
      phase: "discrete",
    });
  });
});

// ---------------------------------------------------------------------------
// Multi mode
// ---------------------------------------------------------------------------

describe("TugAccordion – multi mode chain dispatch (A2.4)", () => {
  it("clicking a trigger dispatches toggleSection with a string[] payload of the currently open ids", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion type="multiple" senderId="acc-multi-a">
        <TugAccordionItem value="alpha" trigger="Alpha">
          <p>alpha-body</p>
        </TugAccordionItem>
        <TugAccordionItem value="beta" trigger="Beta">
          <p>beta-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "Alpha");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("toggle-section");
    expect(events[0].sender).toBe("acc-multi-a");
    expect(Array.isArray(events[0].value)).toBe(true);
    expect(events[0].value).toEqual(["alpha"]);
  });

  it("opening a second item in multi-mode dispatches with both ids in the payload array", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion
        type="multiple"
        defaultValue={["alpha"]}
        senderId="acc-multi-b"
      >
        <TugAccordionItem value="alpha" trigger="Alpha">
          <p>alpha-body</p>
        </TugAccordionItem>
        <TugAccordionItem value="beta" trigger="Beta">
          <p>beta-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "Beta");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0].value).toEqual(["alpha", "beta"]);
  });

  it("closing an item in multi-mode dispatches with the remaining open ids", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion
        type="multiple"
        defaultValue={["alpha", "beta"]}
        senderId="acc-multi-c"
      >
        <TugAccordionItem value="alpha" trigger="Alpha">
          <p>alpha-body</p>
        </TugAccordionItem>
        <TugAccordionItem value="beta" trigger="Beta">
          <p>beta-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "Alpha");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0].value).toEqual(["beta"]);
  });
});

// ---------------------------------------------------------------------------
// senderId behavior
// ---------------------------------------------------------------------------

describe("TugAccordion – senderId prop", () => {
  it("explicit senderId prop flows through to the dispatched event", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion type="single" collapsible senderId="my-explicit-sender">
        <TugAccordionItem value="x" trigger="X">
          <p>x-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "X");

    const events = toggleSectionEvents(dispatched);
    expect(events[0].sender).toBe("my-explicit-sender");
  });

  it("omitted senderId gets a stable useId-derived fallback that persists across interactions", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugAccordion type="single" collapsible>
        <TugAccordionItem value="x" trigger="X">
          <p>x-body</p>
        </TugAccordionItem>
        <TugAccordionItem value="y" trigger="Y">
          <p>y-body</p>
        </TugAccordionItem>
      </TugAccordion>
    );

    clickTriggerByValue(container, "X");
    clickTriggerByValue(container, "Y");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(2);
    // Both dispatches should carry the same auto-derived sender id.
    expect(events[0].sender).toBe(events[1].sender);
    // The fallback is a non-empty string.
    expect(typeof events[0].sender).toBe("string");
    expect((events[0].sender as string).length).toBeGreaterThan(0);
  });

  it("two accordions in the same tree dispatch with distinct auto-derived sender ids", () => {
    const { container, dispatched } = renderWithChainObserver(
      <>
        <TugAccordion type="single" collapsible>
          <TugAccordionItem value="a1" trigger="A1">
            <p>a1-body</p>
          </TugAccordionItem>
        </TugAccordion>
        <TugAccordion type="single" collapsible>
          <TugAccordionItem value="b1" trigger="B1">
            <p>b1-body</p>
          </TugAccordionItem>
        </TugAccordion>
      </>
    );

    clickTriggerByValue(container, "A1");
    clickTriggerByValue(container, "B1");

    const events = toggleSectionEvents(dispatched);
    expect(events.length).toBe(2);
    // Each accordion uses its own useId() fallback, so the two dispatches
    // must carry different senders — otherwise a parent responder couldn't
    // tell them apart via a useResponderForm binding.
    expect(events[0].sender).not.toBe(events[1].sender);
  });
});
