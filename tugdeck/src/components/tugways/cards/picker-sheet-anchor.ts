/**
 * picker-sheet-anchor.ts — where the Z4B picker sheets rest.
 *
 * Mode / Model / Effort are opened by chips in the Z4B row at the bottom of the
 * card, so they bottom-anchor above the Session card's view slot — resting just
 * over the Z2 status bar and rising from it — rather than dropping from the pane
 * title bar at the far end of the card. The same anchor the Changes and History
 * shades rise from, so while the find bar is open all three surfaces clear it.
 *
 * A host without a view slot (the settings session card body) matches nothing
 * and falls back to the sheet's default top anchor.
 *
 * @module components/tugways/cards/picker-sheet-anchor
 */

/** Selector for the element whose bottom edge the picker sheets sit above. */
export const PICKER_SHEET_ANCHOR = ".session-view-slot";
