/**
 * TugSheetStackingContext — popup-elevation signal for popups-in-sheets.
 *
 * Sheets and popup-class primitives both portal to `<CanvasOverlayRoot />`
 * (per [D01]/[D02]). Without elevation, a popup opened from a control inside
 * a sheet would stack BEHIND the sheet because tokens decide ordering and
 * the popup's `--tug-z-overlay-popup` (9200) is below the sheet's
 * `--tug-z-overlay-dialog` (9400). The context lets descendant popups know
 * "you are rendered inside a sheet" so they swap to elevated tokens
 * (`--tug-z-overlay-popup-in-dialog: 9500`,
 * `--tug-z-overlay-menu-in-dialog: 9600`) and visually sit above the sheet.
 *
 * Provider: `TugSheetContent` wraps its rendered content (inside the
 * canvas-tier portal) with `<TugSheetStackingContext.Provider value={true}>`.
 *
 * Consumers: popup-class primitives that portal into the canvas overlay
 * root read this context and toggle a `tug-popup-in-dialog` /
 * `tug-menu-in-dialog` class on their portaled content element. CSS rules
 * in `tug-popover.css` / `tug-menu.css` map those classes to the elevated
 * tokens. Wired in [Step 5](#step-5).
 *
 * Default value `false` so a popup rendered outside any sheet keeps its
 * canvas-tier z-tokens unchanged.
 *
 * State-zone classification per [L24]: this is *structure* zone — a
 * component-identity / hierarchy signal propagated through React context.
 *
 * @module components/tugways/tug-sheet-stacking-context
 */

import { createContext } from "react";

/**
 * Boolean signal: `true` when the consumer subtree is rendered inside a
 * `<TugSheetContent>` (post-portal). Default `false` so consumers outside
 * any sheet keep their canvas-tier z-tokens unchanged.
 */
export const TugSheetStackingContext = createContext<boolean>(false);
