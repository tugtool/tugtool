/**
 * CardPortal — renders `children` into a stable intermediate "slot" DOM
 * element, and moves that slot between host stack content elements via
 * `appendChild` as the portal's `hostStackId` (or the registered host element
 * for that id) changes.
 *
 * Why the intermediate slot: `createPortal(children, container)` unmounts
 * children when `container` changes. React treats a different container as
 * a different mount point. To preserve identity across cross-stack moves
 * (the whole point of Step 11.6.1a), the portal's container must be stable.
 *
 * The slot (`display: contents`) adds no layout box; its children render as
 * if they were direct children of whichever host element the slot is
 * currently parented to. Moving the slot with `appendChild` preserves every
 * descendant DOM node and its listeners / focus state. React's portal
 * container (the slot) never changes, so React never unmounts children.
 *
 * @module components/chrome/card-portal
 */

import { useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import * as registry from "./card-content-registry";

export interface CardPortalProps {
  /** The stackId whose content element should host this portal's DOM output. */
  hostStackId: string;
  /** The content to render into the host stack's content element. */
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
 * Portal children into the host stack's content element via a stable slot.
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
      const host = registry.getElement(hostStackId);
      if (!host) {
        // No host registered — detach slot so the orphan DOM is not visible.
        if (slot.parentNode) slot.parentNode.removeChild(slot);
        return;
      }
      if (slot.parentNode === host) return;
      host.appendChild(slot);
    }

    attachToCurrentHost();
    const unsubscribe = registry.subscribe(hostStackId, attachToCurrentHost);

    return () => {
      unsubscribe();
      if (slot.parentNode) slot.parentNode.removeChild(slot);
    };
  }, [hostStackId, slot]);

  return createPortal(children, slot) as React.ReactElement;
}
