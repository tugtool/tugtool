/**
 * use-atom-chip-img-props — React hook that returns chip `<img>` props
 * and re-derives them when the user's editor font preference or the
 * transcript's magnification changes.
 *
 * Two pieces of state drive the chip bake:
 *
 *  1. **Editor font family** — the user's preferred editor font stack
 *     (Hack / Inter / Plex Sans) lives as module state in
 *     `tug-atom-img.ts`, last set via {@link setAtomFont} by the
 *     editor settings store. The hook subscribes through
 *     {@link subscribeAtomFont} / {@link getAtomFontSnapshot} so the
 *     chip re-bakes when the user picks a different font.
 *
 *  2. **Transcript magnification** — fanned through
 *     {@link TranscriptMagnificationContext} from the transcript host
 *     ([tide-card-transcript.tsx](../components/tugways/cards/tide-card-transcript.tsx)),
 *     which subscribes to `ResponseSettingsStore`. The hook computes
 *     the chip's pixel size via {@link chipFontSizeForMagnification}
 *     (12px base × magnification, floored at 9px) and passes it as
 *     `fontSize` to the bake.
 *
 * The editor surface — `createAtomImgElement` in the CM6 widget —
 * does *not* consume this hook. It reads module state directly so its
 * chips track the editor's *own* font size, not the transcript's
 * magnification.
 *
 * Returns `null` when `path` is undefined or empty — matches
 * {@link composeAtomChipImgProps}'s defensive null-on-empty contract.
 * Consumers can splat the non-null result onto an `<img>` directly.
 *
 * @module lib/use-atom-chip-img-props
 */

import * as React from "react";

import {
  chipFontSizeForMagnification,
  composeAtomChipImgProps,
  getAtomFontSnapshot,
  subscribeAtomFont,
  type AtomChipImgProps,
} from "./tug-atom-img";
import { TranscriptMagnificationContext } from "./transcript-magnification-context";

/**
 * React hook returning the chip `<img>` props for a path, re-derived
 * on editor-font changes and transcript-magnification changes. See
 * module docstring for the L02 + context-fanout rationale.
 */
export function useAtomChipImgProps(
  type: string,
  path: string | undefined,
): AtomChipImgProps | null {
  // [L02] Subscribing forces a re-render when the editor settings
  // store fires `setAtomFont`; the bake below then reads the fresh
  // family from the snapshot.
  const fontSnapshot = React.useSyncExternalStore(
    subscribeAtomFont,
    getAtomFontSnapshot,
  );
  // Transcript magnification (default 1.0 when no provider is
  // mounted — gallery surfaces and other unmagnified renderers).
  const magnification = React.useContext(TranscriptMagnificationContext);
  return React.useMemo(() => {
    if (path === undefined) return null;
    return composeAtomChipImgProps(type, path, {
      fontFamily: fontSnapshot.family,
      fontSize: chipFontSizeForMagnification(magnification),
    });
  }, [type, path, fontSnapshot, magnification]);
}
