/**
 * `useCompanionPopupBinding` unit tests.
 *
 * Per `tugplan-tide-popup-bindings.md` Step 4 / [D05] / (#companion-binding).
 * The hook subscribes to document-level `focusout` / `focusin` events
 * (capture phase) and fires `onShouldDismiss` exactly on the
 * was-inside → now-outside transition of `document.activeElement`
 * relative to the owner element's subtree. Reads of activeElement are
 * deferred one microtask past the focus event so sibling-to-sibling
 * moves inside the owner do not falsely fire dismiss.
 *
 * This file tests the hook in isolation against happy-dom DOM —
 * pure-DOM-helper territory per the project's happy-dom scoping rule
 * (no event-ordering across React renders; just focus events firing
 * within one render's effect lifecycle, mediated by happy-dom and
 * Node's microtask queue). The CompletionOverlay → real-CM6 view
 * integration is covered separately in
 * `tug-text-editor-completion-overlay.test.tsx`.
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { useCompanionPopupBinding } from "@/components/tugways/use-companion-popup-binding";

afterEach(() => {
  cleanup();
});

/**
 * A tiny consumer that mounts the hook with a fixed `ownerEl` and
 * records `onShouldDismiss` calls into a shared counter.
 */
function FixedOwner({
  ownerEl,
  countRef,
}: {
  ownerEl: HTMLElement | null;
  countRef: { current: number };
}) {
  useCompanionPopupBinding({
    ownerEl,
    onShouldDismiss: () => {
      countRef.current += 1;
    },
  });
  return null;
}

/**
 * A consumer that re-renders with new ownerEl values when the parent
 * passes a new prop. Used for the "ownerEl change re-subscribes" test.
 */
function SwitchableOwner({
  ownerEl,
  countRef,
  callbackRef,
}: {
  ownerEl: HTMLElement | null;
  countRef: { current: number };
  callbackRef: { current: () => void };
}) {
  useCompanionPopupBinding({
    ownerEl,
    onShouldDismiss: () => {
      callbackRef.current();
      countRef.current += 1;
    },
  });
  return null;
}

/**
 * Drain the microtask queue. The hook's checkFocus runs via
 * `queueMicrotask`; tests assert the result after the queue drains.
 * `await Promise.resolve()` schedules a continuation in the microtask
 * queue, which runs after every prior microtask — including those
 * queued by `queueMicrotask`.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Test 1 — out-of-subtree transition fires onShouldDismiss
// ---------------------------------------------------------------------------

describe("useCompanionPopupBinding — out-of-subtree focus transition", () => {
  it("fires onShouldDismiss when focus moves from inside to outside the owner", async () => {
    const owner = document.createElement("div");
    owner.tabIndex = 0;
    const inside = document.createElement("button");
    inside.textContent = "inside";
    owner.appendChild(inside);
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(owner);
    document.body.appendChild(outside);

    const countRef = { current: 0 };
    inside.focus();
    expect(document.activeElement).toBe(inside);

    render(<FixedOwner ownerEl={owner} countRef={countRef} />);

    // Move focus outside the owner subtree.
    outside.focus();
    expect(document.activeElement).toBe(outside);
    await flushMicrotasks();

    expect(countRef.current).toBe(1);

    document.body.removeChild(owner);
    document.body.removeChild(outside);
  });

  it("fires once per outside transition, re-arming when focus returns", async () => {
    const owner = document.createElement("div");
    const inside = document.createElement("button");
    owner.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(owner);
    document.body.appendChild(outside);

    const countRef = { current: 0 };
    inside.focus();
    render(<FixedOwner ownerEl={owner} countRef={countRef} />);

    // First outside transition.
    outside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(1);

    // Re-enter; no dismiss.
    inside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(1);

    // Second outside transition; counter increments.
    outside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(2);

    document.body.removeChild(owner);
    document.body.removeChild(outside);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — in-subtree focus transition does NOT fire
// ---------------------------------------------------------------------------

describe("useCompanionPopupBinding — in-subtree focus transition", () => {
  it("does NOT fire onShouldDismiss when focus moves between two siblings inside the owner", async () => {
    const owner = document.createElement("div");
    const childA = document.createElement("button");
    childA.textContent = "A";
    const childB = document.createElement("button");
    childB.textContent = "B";
    owner.appendChild(childA);
    owner.appendChild(childB);
    document.body.appendChild(owner);

    const countRef = { current: 0 };
    childA.focus();
    render(<FixedOwner ownerEl={owner} countRef={countRef} />);

    // In-subtree move: focusout fires on A before focusin on B.
    // The microtask defer reads activeElement after the transition
    // has settled (B), so nowInside === true and no dismiss fires.
    childB.focus();
    await flushMicrotasks();

    expect(countRef.current).toBe(0);

    document.body.removeChild(owner);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — ownerEl change re-subscribes (old element listeners go;
//          new element's listeners take effect)
// ---------------------------------------------------------------------------

describe("useCompanionPopupBinding — ownerEl change", () => {
  it("re-subscribes when ownerEl identity changes", async () => {
    const ownerA = document.createElement("div");
    const insideA = document.createElement("button");
    ownerA.appendChild(insideA);

    const ownerB = document.createElement("div");
    const insideB = document.createElement("button");
    ownerB.appendChild(insideB);

    const outside = document.createElement("button");

    document.body.appendChild(ownerA);
    document.body.appendChild(ownerB);
    document.body.appendChild(outside);

    const countRef = { current: 0 };
    const callbackRef = { current: () => {} };

    // Initial mount with ownerA. Focus goes inside ownerA so the
    // hook initializes isFocusedInside = true for ownerA.
    insideA.focus();
    const result = render(
      <SwitchableOwner
        ownerEl={ownerA}
        countRef={countRef}
        callbackRef={callbackRef}
      />,
    );

    // While ownerA is the owner, moving focus outside ownerA fires.
    outside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(1);

    // Re-render with ownerB. The hook tears down ownerA's effect
    // and installs ownerB's. Pre-condition: focus is currently
    // outside both ownerA AND ownerB (it's on `outside`), so the
    // new ownerB-bound hook initializes isFocusedInside = false.
    result.rerender(
      <SwitchableOwner
        ownerEl={ownerB}
        countRef={countRef}
        callbackRef={callbackRef}
      />,
    );

    // Focus moves into ownerB (inside) — no dismiss (re-arm).
    insideB.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(1);

    // Focus moves out of ownerB → dismiss for ownerB. Counter to 2.
    outside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(2);

    // Sanity: focusing inside the OLD ownerA must NOT fire — the
    // old subscription is torn down. We verify by moving focus into
    // ownerA (so ownerB sees focus go outside) and observing that
    // only ownerB's logic matters: the move from outside → ownerA
    // means relative to ownerB, focus was already outside (no
    // change), so no dismiss. Counter stays at 2.
    insideA.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(2);

    document.body.removeChild(ownerA);
    document.body.removeChild(ownerB);
    document.body.removeChild(outside);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — ownerEl === null is a no-op
// ---------------------------------------------------------------------------

describe("useCompanionPopupBinding — null ownerEl", () => {
  it("installs no listeners when ownerEl is null", async () => {
    // Spy on document.addEventListener for capture-phase focusout/focusin.
    const original = document.addEventListener;
    const captured: Array<{ type: string }> = [];
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      const capture =
        typeof options === "object" && options !== null
          ? options.capture === true
          : options === true;
      if (capture && (type === "focusout" || type === "focusin")) {
        captured.push({ type });
      }
      return original.call(document, type, listener, options);
    }) as typeof document.addEventListener;

    try {
      const countRef = { current: 0 };
      render(<FixedOwner ownerEl={null} countRef={countRef} />);

      // No focus subscriptions installed by the hook.
      expect(captured.find((c) => c.type === "focusout")).toBeUndefined();
      expect(captured.find((c) => c.type === "focusin")).toBeUndefined();

      // Synthesize a focus event; nothing should observe it.
      const button = document.createElement("button");
      document.body.appendChild(button);
      button.focus();
      await flushMicrotasks();
      expect(countRef.current).toBe(0);
      document.body.removeChild(button);
    } finally {
      document.addEventListener = original;
    }
  });

  it("recovers when ownerEl becomes non-null on a later render", async () => {
    const owner = document.createElement("div");
    const inside = document.createElement("button");
    owner.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(owner);
    document.body.appendChild(outside);

    const countRef = { current: 0 };
    const callbackRef = { current: () => {} };

    // Initial mount: ownerEl is null. No listeners.
    const result = render(
      <SwitchableOwner
        ownerEl={null}
        countRef={countRef}
        callbackRef={callbackRef}
      />,
    );

    // Re-render with the real owner. Focus is currently nowhere
    // specific (might be body), so isFocusedInside initializes as
    // false. Move focus inside, then outside, then verify dismiss.
    result.rerender(
      <SwitchableOwner
        ownerEl={owner}
        countRef={countRef}
        callbackRef={callbackRef}
      />,
    );

    inside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(0);

    outside.focus();
    await flushMicrotasks();
    expect(countRef.current).toBe(1);

    document.body.removeChild(owner);
    document.body.removeChild(outside);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — onShouldDismiss callback identity changes do NOT re-subscribe
// ---------------------------------------------------------------------------

describe("useCompanionPopupBinding — onShouldDismiss closure stability ([L07])", () => {
  it("does not re-install document listeners when only the callback identity changes", async () => {
    // Re-rendering with a fresh function identity for onShouldDismiss
    // must NOT tear down and re-install the document-level listeners.
    // Per [L07], the callback is held in a ref and read live at fire
    // time. We assert by counting addEventListener calls across a
    // re-render that changes the callback reference.

    const owner = document.createElement("div");
    const inside = document.createElement("button");
    owner.appendChild(inside);
    const outside = document.createElement("button");
    document.body.appendChild(owner);
    document.body.appendChild(outside);

    const original = document.addEventListener;
    let installs = 0;
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      const capture =
        typeof options === "object" && options !== null
          ? options.capture === true
          : options === true;
      if (capture && (type === "focusout" || type === "focusin")) {
        installs += 1;
      }
      return original.call(document, type, listener, options);
    }) as typeof document.addEventListener;

    try {
      const callRecords: string[] = [];

      function Harness({ tag }: { tag: string }) {
        const callbackRef = useRef<() => void>(() => {});
        callbackRef.current = () => {
          callRecords.push(tag);
        };
        useCompanionPopupBinding({
          ownerEl: owner,
          onShouldDismiss: () => callbackRef.current(),
        });
        return null;
      }

      inside.focus();
      const result = render(<Harness tag="A" />);
      const installsAfterMount = installs;
      expect(installsAfterMount).toBe(2); // focusout + focusin

      // Re-render with a new tag. The callback closure inside the
      // hook is stable (it reads callbackRef.current); the option
      // identity changes per render, but the effect dep is `ownerEl`
      // (which is the same reference) so the effect must NOT re-run.
      result.rerender(<Harness tag="B" />);
      expect(installs).toBe(installsAfterMount);

      // When the dismiss fires, it calls the LATEST tag.
      outside.focus();
      await flushMicrotasks();
      expect(callRecords).toEqual(["B"]);
    } finally {
      document.addEventListener = original;
      document.body.removeChild(owner);
      document.body.removeChild(outside);
    }
  });
});
