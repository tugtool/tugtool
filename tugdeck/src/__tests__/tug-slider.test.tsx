/**
 * TugSlider unit tests — A2.6 chain dispatch phase coverage.
 *
 * Tests cover the phase disambiguation that the A2.6 migration
 * introduces: begin / change / commit for pointer drags, discrete
 * for keyboard interactions, and no double-dispatch on keyboard
 * (Radix fires both onValueChange and onValueCommit for each
 * keystroke — handleSliderCommit must no-op when draggingRef is
 * false, otherwise every keyboard step would emit twice).
 *
 * Scenarios:
 *   1. Keyboard-only (no prior pointerdown): exactly one dispatch
 *      with phase "discrete". handleSliderCommit no-ops.
 *   2. Pointerdown only: one dispatch with phase "begin" carrying
 *      the current (pre-change) value.
 *   3. Pointerdown + keyboard step (simulated drag): the ordered
 *      sequence begin → change → commit, with begin carrying the
 *      current value and change/commit carrying the new value.
 *   4. Disabled slider swallows pointerdown — no "begin" dispatch.
 *   5. Explicit senderId prop flows through to every phase.
 *   6. Auto-derived senderId (omitted prop) is stable across phases
 *      of a single drag.
 *   7. Nested TugValueInput inherits the slider's sender id so the
 *      parent can bind one setter for both drag and text-edit paths.
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

import { TugSlider } from "@/components/tugways/tug-slider";
import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";

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
  const dispatched: Array<{ event: ActionEvent; handled: boolean }> = [];
  manager.observeDispatch((event, handled) => {
    dispatched.push({ event, handled });
  });
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>
  );
  return { ...result, manager, dispatched };
}

/** Filter captured events down to setValue dispatches only. */
function setValueEvents(
  dispatched: Array<{ event: ActionEvent; handled: boolean }>,
): ActionEvent[] {
  return dispatched.filter((d) => d.event.action === "setValue").map((d) => d.event);
}

/** Locate the Radix slider root span inside a TugSlider render. */
function getSliderRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(".tug-slider-root");
  if (!root) throw new Error("no .tug-slider-root found in container");
  return root;
}

/** Locate the Radix slider thumb — the element that takes keyboard focus. */
function getSliderThumb(container: HTMLElement): HTMLElement {
  const thumb = container.querySelector<HTMLElement>(".tug-slider-thumb");
  if (!thumb) throw new Error("no .tug-slider-thumb found in container");
  return thumb;
}

/** Locate the nested TugValueInput element for senderId-propagation tests. */
function getNestedValueInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("input.tug-value-input");
  if (!input) throw new Error("no nested .tug-value-input found");
  return input;
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Keyboard-only (no prior pointerdown) → phase "discrete", no double-commit
// ---------------------------------------------------------------------------

describe("TugSlider – keyboard interaction (A2.6)", () => {
  it("keyboard ArrowRight with no prior pointerdown dispatches exactly once as phase 'discrete'", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={50}
        senderId="slider-kbd"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const thumb = getSliderThumb(container);
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const events = setValueEvents(dispatched);
    // If handleSliderCommit failed to gate on draggingRef, this would be
    // 2 events (one for onValueChange, one duplicated by onValueCommit).
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      action: "setValue",
      sender: "slider-kbd",
      phase: "discrete",
    });
    expect(typeof events[0].value).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Pointerdown → phase "begin" carrying the pre-change value
// ---------------------------------------------------------------------------

describe("TugSlider – pointer drag begin (A2.6)", () => {
  it("pointerdown on the slider root dispatches phase 'begin' with the current value", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={42}
        senderId="slider-begin"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { button: 0 });

    const events = setValueEvents(dispatched);
    // At minimum we expect the first event to be "begin" with value=42.
    // Radix may or may not fire onValueChange on a bare pointerdown in
    // happy-dom (no getBoundingClientRect geometry), so we assert the
    // head of the sequence rather than the full length.
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({
      action: "setValue",
      value: 42,
      sender: "slider-begin",
      phase: "begin",
    });
  });
});

// ---------------------------------------------------------------------------
// Full drag sequence: begin → change → commit
// ---------------------------------------------------------------------------

describe("TugSlider – full drag sequence (A2.6)", () => {
  it("pointerdown + keyboard step yields ordered begin → change → commit dispatches", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={50}
        senderId="slider-drag"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);

    // Simulate a drag by flipping draggingRef on with pointerdown,
    // then using a keyboard step to drive a Radix onValueChange +
    // onValueCommit pair. Since draggingRef is now true,
    // handleSliderChange uses "change" and handleSliderCommit fires
    // instead of no-opping, yielding the full begin/change/commit
    // sequence in one synthetic interaction.
    fireEvent.pointerDown(root, { button: 0 });
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const events = setValueEvents(dispatched);
    // Expect at least: begin, change, commit in order. Radix also
    // fires onValueChange from its own pointerdown handler (computing
    // position from bounding rect), so "change" can appear before the
    // keyboard step; either way, the phase sequence head/tail is
    // begin → ... → commit.
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Head of the sequence is begin@50 — our handler fires first with
    // the prop value, before Radix's internal pointerdown mutates
    // state.
    expect(events[0]).toMatchObject({
      phase: "begin",
      value: 50,
      sender: "slider-drag",
    });

    // The tail must be a commit dispatch — otherwise the keyboard-path
    // no-op gate is misfiring and no commit was emitted.
    const lastCommitIdx = events.map((e) => e.phase).lastIndexOf("commit");
    expect(lastCommitIdx).toBeGreaterThan(0);

    // There must be at least one "change" dispatch between begin and
    // commit. (Value content is not asserted — happy-dom returns a
    // 0×0 bounding rect so Radix's position math snaps to the minimum;
    // what matters for A2.6 is the phase sequence, not the numeric
    // trajectory, which happens deterministically in a real browser.)
    const changeIdx = events.findIndex((e) => e.phase === "change");
    expect(changeIdx).toBeGreaterThan(0);
    expect(changeIdx).toBeLessThan(lastCommitIdx);

    // All events share the same sender and all are setValue.
    for (const e of events) {
      expect(e.sender).toBe("slider-drag");
      expect(e.action).toBe("setValue");
    }

    // All phase values after "begin" must be numbers (payload shape).
    for (const e of events) {
      expect(typeof e.value).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// Disabled slider swallows pointerdown
// ---------------------------------------------------------------------------

describe("TugSlider – disabled (A2.6)", () => {
  it("disabled slider does not dispatch 'begin' on pointerdown", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={30}
        senderId="slider-disabled"
        min={0}
        max={100}
        step={1}
        showValue={false}
        disabled
      />
    );

    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { button: 0 });

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// senderId behavior
// ---------------------------------------------------------------------------

describe("TugSlider – senderId prop (A2.6)", () => {
  it("omitted senderId produces a stable auto-derived id across phases of a single drag", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={10}
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);
    fireEvent.pointerDown(root, { button: 0 });
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const events = setValueEvents(dispatched);
    expect(events.length).toBeGreaterThanOrEqual(1);
    // Every dispatch in a single drag must carry the same sender id.
    const firstSender = events[0].sender;
    expect(typeof firstSender).toBe("string");
    expect((firstSender as string).length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.sender).toBe(firstSender);
    }
  });

  it("two sliders in the same tree dispatch with distinct auto-derived sender ids", () => {
    const { container, dispatched } = renderWithChainObserver(
      <>
        <TugSlider value={10} min={0} max={100} step={1} showValue={false} />
        <TugSlider value={20} min={0} max={100} step={1} showValue={false} />
      </>
    );

    const roots = container.querySelectorAll<HTMLElement>(".tug-slider-root");
    expect(roots.length).toBe(2);
    fireEvent.pointerDown(roots[0], { button: 0 });
    fireEvent.pointerDown(roots[1], { button: 0 });

    // Each pointerdown may generate multiple dispatches (our "begin"
    // plus Radix's own onValueChange from the pointerdown hit-test),
    // so we can't index by event position. Instead, collapse senders
    // across all dispatches — two sliders must produce two distinct
    // sender ids so a parent responder can disambiguate them.
    const uniqueSenders = new Set(setValueEvents(dispatched).map((e) => e.sender));
    expect(uniqueSenders.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Nested TugValueInput inherits the slider's sender id
// ---------------------------------------------------------------------------

describe("TugSlider – nested TugValueInput sender propagation (A2.6)", () => {
  it("committing a new value in the nested input dispatches with the slider's sender id", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={50}
        senderId="slider-with-input"
        min={0}
        max={100}
        step={1}
        /* showValue defaults to true → nested TugValueInput renders */
      />
    );

    const input = getNestedValueInput(container);

    // Drive the imperative-DOM commit flow: focus (enters edit mode),
    // set the value directly on the DOM element (input is uncontrolled
    // and TugValueInput reads input.value in onBlur), then blur to
    // trigger the commit handler.
    fireEvent.focus(input);
    input.value = "75";
    fireEvent.blur(input);

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      action: "setValue",
      value: 75,
      sender: "slider-with-input",
      phase: "discrete",
    });
  });
});
