/**
 * Shared bulletin icon set — the lucide glyphs both the deck-global
 * {@link bulletin} (`tug-bulletin.tsx`) and the pane-scoped
 * {@link TugPaneBulletin} (`tug-pane-bulletin.tsx`) hand to Sonner's `icons`
 * prop.
 *
 * Sonner ships its own filled triangle/circle glyphs for `warning`/`error`/
 * `success`; rendered next to the rest of tugdeck's lucide line icons they read
 * as foreign (the "bad icon"). Overriding `icons` swaps in the same lucide set
 * used everywhere else, at Sonner's 20px icon box and in `currentColor` — the
 * tone is already carried by the toast's left accent bar, so the glyph stays
 * the bulletin's foreground like every other lucide mark in the app. Keys left
 * unset (e.g. `loading`) fall back to Sonner's defaults.
 */

import React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

const ICON_SIZE = 20;

/** Sonner `icons` map: tone → lucide glyph, matching tugdeck's icon language. */
export const BULLETIN_ICONS: Partial<Record<string, React.ReactNode>> = {
  success: <CircleCheck size={ICON_SIZE} aria-hidden />,
  error: <CircleAlert size={ICON_SIZE} aria-hidden />,
  warning: <TriangleAlert size={ICON_SIZE} aria-hidden />,
  info: <Info size={ICON_SIZE} aria-hidden />,
};
