/**
 * `useOuterScrollOnModifierWheel` — Cmd/Ctrl-wheel bypasses an inner
 * block scroller and routes the wheel delta to the outer scrollport.
 *
 * **Why this hook exists.** Inner block scrollers (FileBlock's CM6
 * scrollport, DiffBlock's hunks region, TerminalBlock's virtualized
 * scroller) capture wheel events as soon as the cursor enters them.
 * For a user skimming a long transcript past a tool result, this is
 * a stutter — the outer card scrollport stops moving until the cursor
 * leaves the inner region. The escape hatch is to hold a modifier
 * key while wheeling: the wheel delta routes straight to the outer
 * scrollport, regardless of where the cursor sits.
 *
 * **What the hook does.** Attaches a capture-phase, non-passive
 * `wheel` listener on the inner-scrollport DOM node. On every wheel
 * event it checks whether `event.metaKey` (macOS) or `event.ctrlKey`
 * (Win/Linux) is held. When set:
 *
 *   1. `event.preventDefault()` — stops the browser from delivering
 *      the event to the inner scroller's native handler.
 *   2. `event.stopPropagation()` — stops the event from bubbling
 *      anywhere else (the outer would otherwise receive a duplicate
 *      via natural bubbling).
 *   3. `outerScrollport.scrollBy({ top: event.deltaY, behavior: "auto" })`
 *      — synchronously moves the outer scrollport by the same delta
 *      the inner would have received.
 *
 * Without the modifier, the listener does nothing — the event
 * proceeds through the normal browser handling, which means the
 * inner captures until exhausted, then bubbles to the outer (current
 * behavior, preserved).
 *
 * **Two-form API.** The same routing logic is exposed via two
 * surfaces because not every consumer has a stable inner-scrollport
 * DOM node:
 *
 *  - `useOuterScrollOnModifierWheel({ innerRef, outerScrollportRef })`
 *    is the canonical hook for React shells whose inner scrollport is
 *    a stable element under their tree (FileBlock's CM6 view, DiffBlock's
 *    root). Listener registration runs in `useLayoutEffect` so it's live
 *    before the first paint a user could plausibly wheel against.
 *  - `attachOuterScrollOnModifierWheel(innerEl, getOuter): cleanup`
 *    is the imperative form for components whose inner scrollport
 *    comes and goes inside an imperative renderer (TerminalBlock's
 *    virtualized scroller is recreated on every `renderTerminal`
 *    call, so attaching once in a hook would target a stale element
 *    after the first re-render). Imperative callers invoke this from
 *    inside their renderer with the freshly-created scroller and
 *    bundle the returned cleanup into their existing teardown path.
 *
 * Both call paths share the same `wheelRouter` factory so the
 * routing contract is identical regardless of which form a consumer
 * picks. Identifying which form to use:
 *
 *   - inner scrollport DOM node is stable across renders → use the hook
 *   - inner scrollport DOM node is rebuilt inside imperative code →
 *     use the imperative form alongside the renderer's own setup
 *
 * **Why a non-passive listener.** Modern browsers default new wheel
 * listeners to `{ passive: true }`, which disallows `preventDefault`.
 * The hook needs to call `preventDefault` on the Cmd-wheel hit path,
 * so it registers with `{ capture: true, passive: false }`. This is
 * the *only* place in the body-kind stack that touches wheel events;
 * scroll-position concerns live in `usePositionStableClick` and the
 * scrollport-level tail spacer, and neither overlaps with wheel
 * delivery.
 *
 * **Cmd-click / Cmd-+/- coexistence.** The listener is wheel-specific.
 * `keydown` for Cmd-+ / Cmd-- (browser zoom) and `mousedown` /
 * `click` for Cmd-click (new-tab) are untouched. The wheel handler
 * also doesn't preventDefault on non-modifier scroll, so trackpad
 * panning and shift-wheel (horizontal pan) keep their browser-native
 * behavior.
 *
 * **Browser parity.** macOS uses `metaKey` for Cmd. Windows / Linux
 * use `ctrlKey` for the corresponding modifier (browsers historically
 * use Ctrl for the cross-platform "primary modifier" role). Listening
 * for both covers Tug's primary deployment targets.
 *
 * **Outer-scrollport refresh.** The outer scrollport is read from the
 * passed ref (or getter) at *event time*, not at hook-mount time.
 * This matters for compositions where the outer scrollport mounts
 * after the body kind (rare but legal) or is replaced by a context-
 * driven node change. A stale closure would route Cmd-wheel into a
 * defunct element; reading the ref on each event guarantees the live
 * node receives the scroll write.
 *
 * Laws:
 *  - [L03] The capture-phase listener is registered in `useLayoutEffect`
 *    so it's live before the first paint a user could plausibly wheel
 *    against. The imperative form attaches synchronously inside the
 *    renderer's call-stack which is itself driven by `useLayoutEffect`.
 *    Same beat-in-React-time pattern.
 *  - [L05] No `requestAnimationFrame`. The scroll write happens
 *    synchronously inside the wheel handler — the wheel event is
 *    itself the temporal trigger; deferring to a rAF tick would
 *    introduce visible scroll lag without buying anything.
 *  - [L06] Appearance state (scroll position) flows through the DOM
 *    via `scrollBy`, never round-tripping through React state. No
 *    `useState`, no derived values, no render dependency on a scroll
 *    quantity.
 *  - [L07] The wheel handler reads `event.metaKey`, `event.ctrlKey`,
 *    `event.deltaY` from the live event object — never closed over.
 *    The scrollport reference is read via `scrollportRef.current` (hook)
 *    or `getOuter()` (imperative) on every event. No stale closures.
 *  - [L19] Standalone module under `internal/`, exports the hook +
 *    its options interface + the imperative attach function, this
 *    docstring covering the contract.
 *  - [L22] N/A — no external-state store. The hook is event-driven
 *    plumbing, not a binding.
 *  - [L23] Preserves user-visible state: the inner scroller's
 *    scrollTop is untouched on Cmd-wheel (the inner doesn't see the
 *    event), the outer's scrollTop adjusts by the user-requested
 *    delta. Both invariants survive.
 *  - [L24] Wheel-routing decision = inline event-handler computation,
 *    not state. Scroll position = appearance, DOM-backed. No new
 *    React state. Zone boundaries respected.
 *
 * @module components/tugways/internal/use-outer-scroll-on-modifier-wheel
 */

import React from "react";

export interface UseOuterScrollOnModifierWheelOptions {
  /**
   * Ref to the inner scrollport DOM node — the element whose wheel
   * events should be bypassed on the Cmd/Ctrl-wheel path. Typically
   * a CM6 `.cm-scroller`, the terminal virtualized scroller, or any
   * other inner block scroller. The hook degrades to a no-op when
   * the ref is null at mount time.
   *
   * For body kinds whose inner scrollport is recreated by imperative
   * code (TerminalBlock), prefer {@link attachOuterScrollOnModifierWheel}
   * instead — a hook with a stale-by-design ref would target the wrong
   * element after the renderer rebuilds it.
   */
  innerRef: React.RefObject<HTMLElement | null>;

  /**
   * Ref to the outer scrollport whose `scrollTop` will receive the
   * Cmd/Ctrl-wheel delta. Pass an object-ref whose current value is
   * the scrollport node — typically wrap `useOuterScrollport()` in
   * a `useRef` that's updated in `useLayoutEffect`, or use a
   * dedicated ref the owner already tracks. The hook degrades to a
   * silent no-op when the ref is null at event time (standalone
   * composition with no outer scrollport).
   */
  outerScrollportRef: React.RefObject<HTMLElement | null>;
}

/**
 * Returns true when the event carries a Cmd/Ctrl modifier — the
 * routing trigger. Split out so tests can pin the modifier set
 * directly without faking a full `WheelEvent`.
 */
export function hasRoutingModifier(event: WheelEvent): boolean {
  return event.metaKey === true || event.ctrlKey === true;
}

/**
 * Build a wheel-event handler that, on a Cmd/Ctrl-wheel hit, routes
 * the delta to whatever DOM node `getOuter` returns at event time.
 * Pure factory — no DOM or React access in the construction path;
 * the closure captures only `getOuter`, which itself reads live.
 */
function wheelRouter(
  getOuter: () => HTMLElement | null,
): (event: WheelEvent) => void {
  return (event: WheelEvent): void => {
    if (!hasRoutingModifier(event)) return;
    const outer = getOuter();
    if (outer === null) return;
    event.preventDefault();
    event.stopPropagation();
    outer.scrollBy({ top: event.deltaY, behavior: "auto" });
  };
}

/**
 * Attach a Cmd/Ctrl-wheel routing listener to `inner` and return the
 * cleanup. Imperative form — for components whose inner scrollport
 * DOM node is recreated by an imperative renderer (TerminalBlock)
 * and therefore can't be addressed through a stable React ref.
 *
 * `getOuter` is called on every wheel hit so a context-driven outer
 * change is picked up without re-attaching the listener.
 */
export function attachOuterScrollOnModifierWheel(
  inner: HTMLElement,
  getOuter: () => HTMLElement | null,
): () => void {
  const onWheel = wheelRouter(getOuter);
  inner.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    inner.removeEventListener("wheel", onWheel, { capture: true });
  };
}

/**
 * Attach the Cmd/Ctrl-wheel routing listener to the inner scrollport
 * referenced by `innerRef`. See module docstring for the routing
 * contract, browser parity, and tuglaws compliance notes.
 */
export function useOuterScrollOnModifierWheel(
  options: UseOuterScrollOnModifierWheelOptions,
): void {
  const { innerRef, outerScrollportRef } = options;

  React.useLayoutEffect(() => {
    const inner = innerRef.current;
    if (inner === null) return;
    return attachOuterScrollOnModifierWheel(
      inner,
      () => outerScrollportRef.current,
    );
  }, [innerRef, outerScrollportRef]);
}
