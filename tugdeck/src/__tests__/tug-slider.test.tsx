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

import React, { useState } from "react";
import { describe, it, expect, afterAll, afterEach, beforeAll } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";

import { TugSlider } from "@/components/tugways/tug-slider";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { ResponderChainContext, ResponderParentContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

// ---------------------------------------------------------------------------
// happy-dom geometry stub
// ---------------------------------------------------------------------------
//
// Radix slider uses `getBoundingClientRect()` on its track element to map
// pointer clientX values into the min..max value range. happy-dom returns
// a 0×0 rect for every element, so without a stub Radix's hit-testing
// collapses to 0 and tests can't assert concrete numeric payloads on
// `"change"` / `"commit"` dispatches.
//
// The stub installs a 200×20 rect at (0,0) on Element.prototype for the
// duration of this test file. With that geometry, a `fireEvent.pointerDown`
// carrying `clientX: 150` lands at 75% of the track, which Radix maps to
// value=75 for a 0..100 range. Restored in afterAll so subsequent test
// files see the default happy-dom behavior.
//
// Only this file needs the stub — other A2 tests don't exercise Radix
// slider geometry. Installing in setup-rtl would affect 71 other files,
// some of which may have implicit dependencies on the 0×0 default.

const STUB_RECT: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 200,
  bottom: 20,
  width: 200,
  height: 20,
  toJSON() {
    return this;
  },
};

let originalGetBoundingClientRect: (() => DOMRect) | undefined;

beforeAll(() => {
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return STUB_RECT;
  };
});

afterAll(() => {
  if (originalGetBoundingClientRect) {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  }
});

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

/** Filter captured events down to setValue dispatches only. */
function setValueEvents(
  dispatched: Array<{ event: ActionEvent; handled: boolean }>,
): ActionEvent[] {
  return dispatched.filter((d) => d.event.action === "set-value").map((d) => d.event);
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

/**
 * StatefulSlider — TugSlider test wrapper with a unary setter bound
 * into useResponderForm's setValueNumber slot. Every phase (begin /
 * change / commit / discrete / cancel) calls setState with the
 * dispatched value, matching how real consumers (e.g. gallery-slider)
 * wire TugSlider as a value picker.
 *
 * The slider value is semantic data, not appearance: Radix's thumb
 * position reads from the controlled `value` prop through React's
 * render cycle, so parent state must update on every change for the
 * thumb to actually move. This is not an L06 violation — L06 is
 * about ephemeral visual effects (hover, focus), not about semantic
 * data flowing through React.
 */
function StatefulSlider({
  initialValue,
  senderId,
  min,
  max,
  step,
  showValue,
}: {
  initialValue: number;
  senderId: string;
  min: number;
  max: number;
  step: number;
  showValue?: boolean;
}) {
  const [v, setV] = useState(initialValue);
  const { ResponderScope, responderRef } = useResponderForm({
    setValueNumber: {
      [senderId]: (value) => setV(value),
    },
  });
  return (
    <ResponderScope>
      <div ref={responderRef as (el: Element | null) => void}>
        <TugSlider
          value={v}
          senderId={senderId}
          min={min}
          max={max}
          step={step}
          showValue={showValue}
        />
      </div>
    </ResponderScope>
  );
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
      action: TUG_ACTIONS.SET_VALUE,
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
    // clientX=100 → 50% of the 200-px stubbed track → Radix hit-test
    // value = 50. "begin" still carries 42 (the prop), because our
    // handler runs with the pre-change state snapshot.
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });

    const events = setValueEvents(dispatched);
    expect(events.length).toBeGreaterThanOrEqual(1);
    // The first dispatch is begin@42 — our handler fires synchronously
    // on pointerdown with the prop value.
    expect(events[0]).toMatchObject({
      action: TUG_ACTIONS.SET_VALUE,
      value: 42,
      sender: "slider-begin",
      phase: "begin",
    });
    // The follow-up "change" dispatch carries Radix's hit-test result
    // (value=50 from the stubbed 200-px geometry), proving that the
    // "change" path flows actual numeric payloads through the chain.
    const firstChange = events.find((e) => e.phase === "change");
    expect(firstChange?.value).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Full drag sequence: begin → change → commit
// ---------------------------------------------------------------------------

describe("TugSlider – drag hit-test (A2.6)", () => {
  it("pointerdown with clientX dispatches begin@current then change@hittest", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={50}
        senderId="slider-hittest"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    // clientX=150 on the 200-px stubbed track = 75% → Radix hit-tests
    // this to value=75 via its internal pointerdown handler.
    fireEvent.pointerDown(root, { button: 0, clientX: 150 });

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(2);

    // 1. begin@50 — synchronous from our onPointerDown handler,
    //    fires BEFORE Radix's internal pointerdown mutates state.
    expect(events[0]).toMatchObject({
      phase: "begin",
      value: 50,
      sender: "slider-hittest",
    });

    // 2. change@75 — Radix's pointerdown hit-test maps clientX=150 to
    //    75% of the 0..100 range. draggingRef is now true, so the
    //    dispatch carries "change" (not "discrete"). This is the
    //    load-bearing test for phase disambiguation: if onPointerDown
    //    forgot to set draggingRef, this would be "discrete" instead.
    expect(events[1]).toMatchObject({
      phase: "change",
      value: 75,
      sender: "slider-hittest",
    });
  });
});

// ---------------------------------------------------------------------------
// draggingRef leak-recovery
// ---------------------------------------------------------------------------

describe("TugSlider – window pointercancel → cancel phase (A2.6 hardening)", () => {
  it("a window pointercancel during an active drag dispatches phase 'cancel' with the pre-drag value", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={40}
        senderId="slider-pointer-cancel"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    // Begin a drag. clientX=100 on the stubbed 200-px track → Radix
    // hit-tests to 50; our change@50 fires.
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });

    // OS aborts the gesture — window pointercancel fires without a
    // preceding pointerup. The listener should dispatch cancel@40
    // (the pre-drag value snapshot).
    window.dispatchEvent(new Event("pointercancel"));

    const events = setValueEvents(dispatched);
    // Expect tail to be cancel@40. Earlier events are begin/change
    // from the pointerdown.
    const cancel = events.find((e) => e.phase === "cancel");
    expect(cancel).toBeDefined();
    expect(cancel).toMatchObject({
      phase: "cancel",
      value: 40,
      sender: "slider-pointer-cancel",
    });
  });

  it("a window pointerup during an active drag does NOT dispatch cancel (normal release)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={40}
        senderId="slider-pointer-release"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });
    window.dispatchEvent(new Event("pointerup"));

    const events = setValueEvents(dispatched);
    // pointerup must NOT dispatch cancel — it's a normal release.
    // Radix handles commit via its own onValueCommit path.
    const cancel = events.find((e) => e.phase === "cancel");
    expect(cancel).toBeUndefined();
  });
});

describe("TugSlider – draggingRef leak recovery (A2.6)", () => {
  it("window pointerup after pointerdown clears the drag flag so a later keyboard step dispatches 'discrete'", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={50}
        senderId="slider-leak"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);

    // Simulate the leak scenario: pointerdown starts a drag, but
    // instead of Radix's onValueCommit firing (as it would for a
    // release inside the slider), the pointerup happens at the
    // window level — e.g. the user dragged outside the browser
    // window and released. Our window-level safety-net listener
    // should clear draggingRef even though Radix never fired a
    // commit for this pointer interaction.
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });
    // Simulate a bare window pointerup that Radix does NOT see as a
    // slider interaction commit. fireEvent.pointerUp(window) doesn't
    // work directly, so dispatch a PointerEvent through the window.
    window.dispatchEvent(new Event("pointerup"));

    // Now press a keyboard arrow. If the leak was unhandled,
    // draggingRef would still be true and this would dispatch
    // `change + commit`. With the safety net, draggingRef is false
    // and the keyboard step is a single `discrete` dispatch.
    const eventsBeforeKbd = setValueEvents(dispatched).length;
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const newEvents = setValueEvents(dispatched).slice(eventsBeforeKbd);
    // Keyboard ArrowRight fires onValueChange once; since draggingRef
    // is now false, it dispatches phase "discrete" and the follow-up
    // onValueCommit no-ops. Exactly one new event.
    expect(newEvents.length).toBe(1);
    expect(newEvents[0]).toMatchObject({
      phase: "discrete",
      sender: "slider-leak",
    });
  });
});

// ---------------------------------------------------------------------------
// Escape-mid-drag cancel phase
// ---------------------------------------------------------------------------

describe("TugSlider – Escape-mid-drag cancel (A2.6)", () => {
  it("Escape during drag dispatches phase 'cancel' with the pre-drag value", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={40}
        senderId="slider-cancel"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);

    // Begin the drag. pointerdown hit-tests to 50% of the 200-px
    // stubbed track → value=50.
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });
    // Press Escape on the focused thumb while the drag is active.
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "Escape" });

    const events = setValueEvents(dispatched);
    // Expected sequence:
    //   1. begin@40 (pointerdown, pre-drag snapshot)
    //   2. change@50 (Radix hit-test)
    //   3. cancel@40 (Escape during drag — carries the begin value
    //      so a parent can roll back from the 50 live preview).
    expect(events.length).toBe(3);
    expect(events[0]).toMatchObject({ phase: "begin", value: 40 });
    expect(events[1]).toMatchObject({ phase: "change", value: 50 });
    expect(events[2]).toMatchObject({
      phase: "cancel",
      value: 40,
      sender: "slider-cancel",
    });
  });

  it("after Escape-cancel, a subsequent keyboard step dispatches a single 'discrete' (no stale drag state)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={40}
        senderId="slider-post-cancel"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);

    fireEvent.pointerDown(root, { button: 0, clientX: 100 });
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "Escape" });

    // After the cancel, draggingRef must be false. A fresh keyboard
    // step should dispatch exactly one "discrete" event — not a
    // "change + commit" pair from a stale drag flag.
    const beforeKbd = setValueEvents(dispatched).length;
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    const newEvents = setValueEvents(dispatched).slice(beforeKbd);

    expect(newEvents.length).toBe(1);
    expect(newEvents[0]).toMatchObject({
      phase: "discrete",
      sender: "slider-post-cancel",
    });
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
    fireEvent.pointerDown(root, { button: 0, clientX: 100 });

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(0);
  });

  it("disabled slider does not dispatch on keyboard arrow (second safety net)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={30}
        senderId="slider-disabled-kbd"
        min={0}
        max={100}
        step={1}
        showValue={false}
        disabled
      />
    );

    const thumb = getSliderThumb(container);
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "Escape" });

    // Radix itself refuses to fire onValueChange for disabled, but
    // our handleSliderChange / handleSliderCommit / handleThumbKeyDown
    // also guard on effectiveDisabled as a defence-in-depth safety
    // net. Even if Radix ever regresses, a disabled slider stays
    // silent.
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
      action: TUG_ACTIONS.SET_VALUE,
      value: 75,
      sender: "slider-with-input",
      phase: "discrete",
    });
  });

  it("blurring the nested input without editing dispatches nothing (no spurious no-op commits)", () => {
    const { container, dispatched } = renderWithChainObserver(
      <TugSlider
        value={50}
        senderId="slider-no-op"
        min={0}
        max={100}
        step={1}
      />
    );

    const input = getNestedValueInput(container);
    // Focus enters edit mode, blur triggers onBlur — but the input
    // value wasn't touched, so parsed === value and the dispatch
    // must be suppressed by the equality guard.
    fireEvent.focus(input);
    fireEvent.blur(input);

    const events = setValueEvents(dispatched);
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Keyboard step during in-progress drag
// ---------------------------------------------------------------------------

describe("TugSlider – keyboard step during in-progress drag (A2.6)", () => {
  it("keyboard step after pointerdown commits the drag then dispatches discrete", () => {
    const { container, dispatched } = renderWithChainObserver(
      <StatefulSlider
        initialValue={50}
        senderId="slider-drag-kbd"
        min={0}
        max={100}
        step={1}
        showValue={false}
      />
    );

    const root = getSliderRoot(container);
    const thumb = getSliderThumb(container);

    fireEvent.pointerDown(root, { button: 0, clientX: 150 });
    fireEvent.focus(thumb);
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    const events = setValueEvents(dispatched);

    // Observed sequence: [begin@50, change@75, commit@76, discrete@76]
    //
    // Radix's keyboard step handler calls `updateValues(next, ..., { commit: true })`,
    // which fires `onValueCommit` SYNCHRONOUSLY inside the setValues
    // updater — before React flushes the state change and the
    // subsequent `onValueChange` runs. So the keyboard step produces:
    //
    //   a. onValueCommit(76) → our handleSliderCommit sees
    //      draggingRef=true (still held from pointerdown) → dispatches
    //      commit@76 and clears draggingRef.
    //   b. onValueChange(76) → our handleSliderChange now sees
    //      draggingRef=false → dispatches discrete@76.
    //
    // Radix is reading from the *latest committed prop* (75, because
    // the wrapper setState on change@75) when it handles the keyboard
    // step, so the step goes 75 → 76. This is the correct
    // end-state for a mid-drag keyboard step: the drag concludes at
    // the keyboard value, and any further keyboard input is treated
    // as discrete.
    expect(events.length).toBe(4);
    expect(events[0]).toMatchObject({ phase: "begin", value: 50 });
    expect(events[1]).toMatchObject({ phase: "change", value: 75 });
    expect(events[2]).toMatchObject({ phase: "commit", value: 76 });
    expect(events[3]).toMatchObject({ phase: "discrete", value: 76 });

    for (const e of events) {
      expect(e.sender).toBe("slider-drag-kbd");
      expect(e.action).toBe("set-value");
    }
  });
});
