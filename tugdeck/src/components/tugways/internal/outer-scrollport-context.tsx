/**
 * `OuterScrollportContext` — publishes the nearest outer scrollport DOM
 * node to descendants.
 *
 * The outer scrollport is the scrollable ancestor whose `scrollTop`
 * adjustment compensates for height changes inside a body kind so the
 * click target stays under the user's cursor. For tide cards this is
 * the transcript scrollport (`.tug-list-view`); for other surfaces it
 * may be a pane scrollport or an ad-hoc div. The provider is published
 * by whoever owns the actual scrollable element; consumers read it via
 * `useOuterScrollport()` and pass it into `usePositionStableClick`.
 *
 * The value is `null` when no provider is above — standalone gallery,
 * unit tests, or any composition that does not need scroll-position
 * compensation. Consumers branch on the null and skip the adjustment.
 *
 * Laws:
 *  - [L06] the published value is a DOM node, not React state. Position
 *    compensation flows through direct `scrollTop` writes, never
 *    round-tripping through React's render cycle.
 *  - [L19] component-authoring guide — single-file context primitive
 *    with this docstring and named exports.
 *  - [L20] no component-token surface — this is infrastructure plumbing
 *    for the position-stable click hook, not a styled component.
 *
 * @module components/tugways/internal/outer-scrollport-context
 */

import React from "react";

/**
 * Context value: the outer scrollport DOM node, or `null` when no
 * provider is above. Body-kind affordances read this via the hook
 * below and pass the node into `usePositionStableClick`.
 */
const OuterScrollportContext = React.createContext<HTMLElement | null>(null);

export interface OuterScrollportProviderProps {
  /**
   * The scrollport DOM node — typically passed via the same ref that
   * the owning component holds for its own scroll-position logic. The
   * provider re-publishes whenever this value changes.
   */
  scrollport: HTMLElement | null;
  children?: React.ReactNode;
}

/**
 * Publish the given scrollport to descendants. Owners pass their
 * scrollport node (often a ref-tracked DOM element) directly into the
 * `scrollport` prop; the provider re-publishes on every change.
 *
 * Composition: an owner like `TugListView` wraps its rendered children
 * with `<OuterScrollportProvider scrollport={scrollContainerEl}>` so
 * any descendant (a body-kind affordance several layers deep) can
 * walk up via context without dragging a ref through every prop.
 */
export const OuterScrollportProvider: React.FC<
  OuterScrollportProviderProps
> = ({ scrollport, children }) => {
  return (
    <OuterScrollportContext.Provider value={scrollport}>
      {children}
    </OuterScrollportContext.Provider>
  );
};

/**
 * Read the outer scrollport from context. Returns the node when a
 * provider is above, `null` otherwise. Consumers branch on the null
 * (standalone composition, gallery, test harness) and skip scroll
 * compensation.
 */
export function useOuterScrollport(): HTMLElement | null {
  return React.useContext(OuterScrollportContext);
}
