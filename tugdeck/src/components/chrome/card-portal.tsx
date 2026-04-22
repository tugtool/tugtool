/**
 * CardPortal — renders `children` into a stable intermediate "slot" DOM
 * element, and moves that slot between host pane content elements via
 * `appendChild` as the portal's `hostStackId` (pane id; or the registered
 * host element for that id) changes.
 *
 * Why the intermediate slot: `createPortal(children, container)` unmounts
 * children when `container` changes. React treats a different container as
 * a different mount point. To preserve identity across cross-pane moves,
 * the portal's container must be stable.
 *
 * The slot (`display: contents`) adds no layout box; its children render as
 * if they were direct children of whichever host element the slot is
 * currently parented to. Moving the slot with `appendChild` preserves every
 * descendant DOM node and its listeners / focus state. React's portal
 * container (the slot) never changes, so React never unmounts children.
 *
 * Mount ordering: on first render, `children` mount into the slot
 * immediately — but the slot itself is detached from the document tree.
 * The slot gets parented to the host pane's content element in
 * `useLayoutEffect` post-commit. In the common case (the host pane has
 * already registered its content element with `pane-content-registry`
 * by the time the portal mounts), the attach happens in the same commit,
 * so children are reachable from `document.body` by the end of the
 * commit. In the rarer case where the portal mounts before its host
 * registers (a layout tree where CardPortal races its own TugPane's
 * `useLayoutEffect`), the slot stays detached until the content-registry
 * subscriber fires on a later commit. Consumers must not assume
 * descendants are laid out, measurable, or reachable via `document`
 * queries on the very first render — wait for a post-commit effect.
 *
 * ## Teardown contract
 *
 * When a host `TugPane` unmounts (with or without its cards also
 * unmounting in the same commit), the slot is detached from the
 * now-defunct content element **before** React removes the content
 * element's DOM subtree. The chain:
 *
 *   1. `TugPane`'s `useLayoutEffect` cleanup fires
 *      `paneContentRegistry.unregister(paneId)`.
 *   2. The registry's `notify(paneId)` is synchronous — every subscriber
 *      runs in the same tick as the `unregister` call. This synchronous
 *      fan-out is load-bearing and is pinned as a contract in
 *      `pane-content-registry.ts`.
 *   3. `CardPortal`'s subscribed `attachToCurrentHost` sees `host === null`
 *      and calls `slot.parentNode.removeChild(slot)`, detaching the slot
 *      from the content element.
 *   4. React removes the content element's DOM subtree. The slot is no
 *      longer part of that subtree, so React's unmount of `CardPortal`'s
 *      children (if it happens in the same commit) still finds the slot
 *      as their portal container — just living in a detached state.
 *   5. `CardPortal`'s own `useLayoutEffect` cleanup (on an unmounting
 *      `CardHost`) later calls `slot.parentNode.removeChild(slot)`
 *      guarded by `if (slot.parentNode)` — no-op when the subscriber
 *      already detached in step 3.
 *
 * This ordering means `CardHost`'s effect cleanups (scroll /
 * `selectionchange` listener removal via `useCardDirtyState`) never
 * leave the slot attached to a DOM subtree that is about to be removed.
 * A post-DOM-removal `selectionchange` (the browser collapsing a
 * selection whose anchor was inside the removed subtree) cannot cause a
 * save-after-destroy because `useCardDirtyState`'s cleanup defensively
 * clears the debounce timer.
 *
 * An earlier draft of this contract proposed an explicit
 * `onHostGone(cb)` subscription on the registry. It was considered and
 * rejected: the synchronous-`notify` + per-hook-cleanup combination
 * already closes the window the API would have addressed, and a second
 * subscription channel would complicate the mental model without
 * tightening any invariant.
 *
 * @module components/chrome/card-portal
 */

import { useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import * as paneContentRegistry from "./pane-content-registry";

export interface CardPortalProps {
  /** The pane id whose content element should host this portal's DOM output. */
  hostStackId: string;
  /** The content to render into the host pane's content element. */
  children: React.ReactNode;
}

/**
 * Create the stable slot div once per CardPortal instance (lazy init).
 * `display: contents` makes the slot itself invisible in layout — its
 * children render as direct children of the host element.
 */
function createSlot(): HTMLDivElement {
  const d = document.createElement("div");
  d.style.display = "contents";
  d.setAttribute("data-card-portal-slot", "true");
  return d;
}

/**
 * Portal children into the host pane's content element via a stable slot.
 *
 * Lifecycle:
 *   1. On mount: create slot (detached from DOM), portal children into it.
 *   2. useLayoutEffect attaches slot to the current host element (if any).
 *   3. On hostStackId change: cleanup removes slot from old host; new effect
 *      attaches slot to new host. Children stay mounted throughout.
 *   4. Registry updates (same hostStackId, different element): subscriber
 *      callback re-attaches the slot. Children stay mounted.
 *   5. On unmount: slot is removed from whatever host it was last attached to.
 */
export function CardPortal({ hostStackId, children }: CardPortalProps): React.ReactElement {
  const [slot] = useState(createSlot);

  useLayoutEffect(() => {
    function attachToCurrentHost() {
      const host = paneContentRegistry.getElement(hostStackId);
      if (!host) {
        // No host registered — detach slot so the orphan DOM is not visible.
        if (slot.parentNode) slot.parentNode.removeChild(slot);
        return;
      }
      if (slot.parentNode === host) return;
      host.appendChild(slot);
    }

    attachToCurrentHost();
    const unsubscribe = paneContentRegistry.subscribe(hostStackId, attachToCurrentHost);

    return () => {
      unsubscribe();
      if (slot.parentNode) slot.parentNode.removeChild(slot);
    };
  }, [hostStackId, slot]);

  return createPortal(children, slot) as React.ReactElement;
}
