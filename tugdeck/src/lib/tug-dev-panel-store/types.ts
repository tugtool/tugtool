/**
 * Public types for `TugDevPanelStore` — the persistent dev inspector
 * surface triggered from Tug.app's Developer menu (Opt-Cmd-/).
 *
 * The panel is a framework: it owns visibility, the active inspector
 * tab, and the currently-selected card. Each inspector tab renders
 * read-only against its own data sources (e.g. the per-card
 * `CodeSessionStore` for the telemetry tab).
 *
 * Conformance:
 *   - [L02] external store; React reads via `useSyncExternalStore`.
 *   - State persists across HMR / reloads via tugbank under the
 *     `dev.tugtool.dev-panel` domain — never `localStorage`.
 *
 * @module lib/tug-dev-panel-store/types
 */

/**
 * Inspector tab identifiers. Currently only `telemetry`; future tabs
 * (lifecycle, transport, replay, events log, propertystore tree)
 * extend this union without re-architecting the framework.
 */
export type TugDevPanelTabId = "telemetry";

/**
 * Default tab landed on when no persisted value is present.
 */
export const DEFAULT_DEV_PANEL_TAB: TugDevPanelTabId = "telemetry";

/**
 * Set of valid tab ids — used by the reducer to reject unrecognized
 * persisted values from a future-shape tugbank entry.
 */
export const VALID_DEV_PANEL_TABS: ReadonlySet<TugDevPanelTabId> = new Set([
  "telemetry",
]);

/**
 * Public snapshot returned by `TugDevPanelStore.getSnapshot()`. Stable
 * reference between dispatches that produce no change.
 */
export interface TugDevPanelSnapshot {
  /** Whether the panel is currently visible. Toggled via DOM per [L06]. */
  open: boolean;
  /** The active inspector tab. */
  activeTab: TugDevPanelTabId;
  /**
   * Card whose store the active inspector reads. `null` when no card
   * is selected (e.g. no cards open yet, or the previously-selected
   * card has been closed). The inspector handles the null case with
   * an empty state.
   */
  selectedCardId: string | null;
}
