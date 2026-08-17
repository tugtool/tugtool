/**
 * useOpenMenuClaim — a menu shell's standing claim that it is on screen.
 *
 * One line in every shell that raises a menu:
 *
 * ```tsx
 * useOpenMenuClaim(open);
 * ```
 *
 * The claim goes up while `open` is true and comes down on close and on
 * unmount alike, so a shell torn down mid-menu (a row unmounting under an
 * open context menu) cannot leave a stale one standing. What reads it is
 * `TugTooltip`, which opens no bubble while any menu is up — see
 * `lib/open-menu-registry` for why that is a declared fact rather than a
 * query for `.tug-menu-content` in the document.
 *
 * `useLayoutEffect` per [L03]: the claim is in place before the paint that
 * shows the menu, so a hover that lands in the same frame is already gated.
 *
 * @module components/tugways/use-open-menu-claim
 */

import { useLayoutEffect } from "react";

import { registerOpenMenu } from "@/lib/open-menu-registry";

/** Claim "a menu is open" for as long as `open` holds. */
export function useOpenMenuClaim(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return;
    return registerOpenMenu();
  }, [open]);
}
