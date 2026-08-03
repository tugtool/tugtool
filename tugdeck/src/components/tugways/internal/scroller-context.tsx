/**
 * `ScrollerContext` — publishes a typed follow-bottom handle to
 * descendants.
 *
 * A body-kind affordance several layers inside a scrolling host
 * sometimes needs to release the host's auto-follow-bottom lock: when
 * the user collapses a Bash hunk or flips a diff view mode, the cell
 * grows or shrinks, and a host that is following the bottom would pin
 * the cue off-screen — violating "interacting with a control does not
 * move that control out of view." Previously the affordance signalled
 * this by dispatching a bubbling `tug-disengage-follow-bottom`
 * `CustomEvent` that the host's scroll container caught: untyped
 * action-at-a-distance with no record of who fired it.
 *
 * This context replaces that event with a typed, logged funnel. The
 * scrolling host (`TugListView`) publishes a {@link Scroller} façade;
 * a descendant reads it via `useScroller()` and calls
 * `disengage("block-fold")`. The façade routes to `SmartScroll.engage`
 * / `disengage`, which record the `source` to the deck trace.
 *
 * The published value is a stable façade object the host creates once
 * (via `useRef`) whose methods delegate to its live `SmartScroll`
 * instance and no-op while that instance is `null` (pre-mount /
 * post-dispose). Because the façade identity never changes, the
 * context never churns — no consumer re-renders on a scroll event.
 *
 * The context default is {@link NOOP_SCROLLER}: a host-less
 * composition (standalone gallery, unit test, any tree with no
 * scrolling host above) gets a callable no-op, so `useScroller()`
 * never returns `null` and consumers need no guard.
 *
 * Laws:
 *  - [L02] the context value is a stable imperative handle, not store
 *    state — follow-bottom intent never round-trips through React's
 *    render cycle.
 *  - [L06] the façade drives `scrollTop` policy through `SmartScroll`,
 *    a DOM-appearance owner; no React state is crossed.
 *  - [L07] the façade delegates to the live `SmartScroll` instance,
 *    read at call time — never a stale reference captured at publish.
 *  - [L19] component-authoring guide — single-file context primitive
 *    with this docstring and named exports.
 *
 * @module components/tugways/internal/scroller-context
 */

import React from "react";

/**
 * Typed follow-bottom handle published to descendants of a scrolling
 * host. Methods take a short, stable `source` tag ("block-fold",
 * "diff-view-toggle", ...) that the host routes to the deck trace so a
 * follow-bottom regression can be attributed to its trigger.
 */
export interface Scroller {
  /** Engage auto-follow-bottom — pin to the live edge as content grows. */
  engage(source: string): void;
  /** Release auto-follow-bottom — stop pinning to the live edge. */
  disengage(source: string): void;
  /**
   * True when the user's position, judged against the live geometry OR
   * the geometry they were last shown, is the bottom. A consumer whose
   * own machinery disengaged follow-bottom (an inline dialog's scope)
   * consults this before re-engaging at its close: still settled at
   * the bottom is the attributed arrival that licenses `engage`; a
   * user who scrolled away keeps the released state they chose.
   * Delegates to `SmartScroll.isSettledAtBottom`.
   */
  isSettledAtBottom(): boolean;
}

/**
 * Context default — a callable no-op {@link Scroller}. Used when no
 * `ScrollerProvider` is above (standalone gallery, unit tests, any
 * tree with no scrolling host). Frozen so it can't be mutated and
 * shared as a single module constant so its identity is stable.
 */
export const NOOP_SCROLLER: Scroller = Object.freeze({
  engage: () => {},
  disengage: () => {},
  // No scrolling host means no bottom to be settled at — a consumer
  // gating a re-engage on this correctly never engages.
  isSettledAtBottom: () => false,
});

const ScrollerContext = React.createContext<Scroller>(NOOP_SCROLLER);

export interface ScrollerProviderProps {
  /**
   * The follow-bottom façade — typically a stable object the host
   * creates once (`useRef`) whose methods delegate to its live
   * `SmartScroll`. Keep it reference-stable: the provider re-publishes
   * on every change, and a churning value would re-render every
   * consumer.
   */
  scroller: Scroller;
  children?: React.ReactNode;
}

/**
 * Publish a {@link Scroller} façade to descendants. A scrolling host
 * (`TugListView`) wraps its rendered cells with
 * `<ScrollerProvider scroller={facade}>` so any descendant — a
 * body-kind affordance several layers deep — can release follow-bottom
 * without a ref threaded through every prop.
 */
export const ScrollerProvider: React.FC<ScrollerProviderProps> = ({
  scroller,
  children,
}) => {
  return (
    <ScrollerContext.Provider value={scroller}>
      {children}
    </ScrollerContext.Provider>
  );
};

/**
 * Read the {@link Scroller} façade from context. Returns the host's
 * façade when a provider is above, the no-op {@link NOOP_SCROLLER}
 * otherwise — always callable, never `null`.
 */
export function useScroller(): Scroller {
  return React.useContext(ScrollerContext);
}

// ---- Element registry ----
//
// The same façade, reachable from outside React. The focus engine's reveal
// (`focus-reveal.ts`) discovers scrollports by walking the DOM, not by sitting
// in a component tree, so it cannot read the context — but it must still
// release follow-bottom cooperatively before writing `scrollTop`. A host
// registers its scroll container here alongside the provider; the map is weak,
// so an unmounted host's entry goes with it even if `detach` never runs.

const scrollerByElement = new WeakMap<HTMLElement, Scroller>();

/**
 * Bind `element` (a scroll container) to its {@link Scroller} façade for
 * DOM-side lookup. Returns the detach function — call it on unmount.
 */
export function attachScrollerElement(
  element: HTMLElement,
  scroller: Scroller,
): () => void {
  scrollerByElement.set(element, scroller);
  return () => {
    if (scrollerByElement.get(element) === scroller) {
      scrollerByElement.delete(element);
    }
  };
}

/**
 * The {@link Scroller} façade bound to `element`, or `null` when the element is
 * a plain overflow box with no host façade behind it.
 */
export function scrollerForElement(element: HTMLElement): Scroller | null {
  return scrollerByElement.get(element) ?? null;
}
