/**
 * React binding for the Lens rail's anchor side. Reads the `LensStore`
 * snapshot via `useSyncExternalStore` ([L02]) so a change made in
 * Settings (or a live tugbank push) re-renders the control.
 *
 * @module lib/lens-store/use-lens-anchor-side
 */

import { useSyncExternalStore } from "react";

import { lensStore } from "./lens-store";
import type { LensAnchorSide } from "./types";

/** Current Lens anchor side, reactive to store changes. */
export function useLensAnchorSide(): LensAnchorSide {
  return useSyncExternalStore(
    lensStore.subscribe,
    () => lensStore.getSnapshot().anchorSide,
  );
}
