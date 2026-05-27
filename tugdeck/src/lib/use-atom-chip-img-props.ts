/**
 * use-atom-chip-img-props — React hook that returns chip `<img>` props
 * and re-derives them when the user's editor font preference changes.
 *
 * The atom-chip rendering pipeline reads its font family + size from
 * module-level state in `tug-atom-img.ts` ({@link setAtomFont}-managed).
 * A bare React render of `<img src={composeAtomChipImgProps(...).src}>`
 * would bake the SVG once with whatever module state was current at
 * mount time, and never refresh — so the chip's font wouldn't track a
 * later settings change. The editor's CM6 widget side-steps this via
 * `regenerateAtoms()`, but React surfaces have no such hook.
 *
 * This hook subscribes the component to {@link subscribeAtomFont} via
 * `useSyncExternalStore` per [L02] so it re-renders on every font
 * change, and re-derives the chip props with the fresh module state
 * inside that render.
 *
 * Returns `null` when `path` is undefined or empty — matches
 * {@link composeAtomChipImgProps}'s defensive null-on-empty contract.
 * Consumers can splat the non-null result onto an `<img>` directly.
 *
 * @module lib/use-atom-chip-img-props
 */

import * as React from "react";

import {
  composeAtomChipImgProps,
  getAtomFontSnapshot,
  subscribeAtomFont,
  type AtomChipImgProps,
} from "./tug-atom-img";

/**
 * React hook returning the chip `<img>` props for a path, re-derived
 * on atom-font changes. See module docstring for the L02 subscription
 * rationale.
 */
export function useAtomChipImgProps(
  type: string,
  path: string | undefined,
): AtomChipImgProps | null {
  // [L02] Subscribing forces a re-render when the editor settings
  // store fires `setAtomFont`; the bake below then reads the fresh
  // module state via `composeAtomChipImgProps` → `buildAtomSVGDataUri`.
  // The snapshot value itself isn't used directly — the subscription
  // is what gates the rerender.
  const snapshot = React.useSyncExternalStore(subscribeAtomFont, getAtomFontSnapshot);
  return React.useMemo(
    () => (path === undefined ? null : composeAtomChipImgProps(type, path)),
    // Re-bake on path / type / font-snapshot change. `snapshot` is
    // reference-stable until a real font change, so this dep doesn't
    // churn on idempotent re-applies.
    [type, path, snapshot],
  );
}
