/**
 * `dev-restore-sheet-gate.ts` — the restore-sheet reveal-gate constant + its
 * pure timing helper.
 *
 * Kept in a **non-component** module on purpose: `dev-restore-sheet.tsx`
 * exports the `DevRestoreSheetHost` component, and React Fast Refresh only
 * treats a module as a hot-swappable boundary when it exports components and
 * nothing else. Co-locating these value exports there would break that
 * boundary, so an edit to the sheet file would propagate to its importer (the
 * transcript host) and remount the whole transcript — a multi-second lock,
 * the very thing the HMR-never-reloads invariant forbids. Splitting them out
 * keeps the sheet file a clean refresh boundary.
 *
 * @module components/tugways/cards/dev-restore-sheet-gate
 */

/**
 * Reveal gate: a restore faster than this never presents the sheet — the
 * content just reveals once (redux [P09]). Deliberately tighter than
 * `REPLAY_SOFT_BUDGET_MS` (= 2000) so the sheet shows promptly on a
 * genuinely slow (ingest-bound) restore rather than after a longer silent
 * wait; with content-visibility the render is cheap, so a restore that
 * exceeds the gate is ingest-bound — exactly where the sheet + Cancel earn
 * their place.
 */
export const RESTORE_SHEET_GATE_MS = 500;

/**
 * Pure: how long to wait before presenting the sheet, given how long the
 * restore has already been running. At or past the gate → 0 (present now);
 * otherwise the remaining time to the gate. Extracted so the present
 * decision is unit-testable without timers or the DOM.
 */
export function restoreSheetRevealDelayMs(
  elapsedMs: number,
  gateMs: number,
): number {
  return Math.max(0, gateMs - elapsedMs);
}
