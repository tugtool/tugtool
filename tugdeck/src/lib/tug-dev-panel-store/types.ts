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
 * Tugbank domain owning the dev-panel's persisted state — exported
 * from `types.ts` (not the store module) so sibling stores (e.g.
 * `tug-dev-log-store`) can reference the same domain string without
 * creating a circular import.
 */
export const DEV_PANEL_DOMAIN = "dev.tugtool.dev-panel";

/**
 * Inspector tab identifiers. Future tabs (lifecycle, transport,
 * replay, propertystore tree) extend this union without re-architecting
 * the framework.
 */
export type TugDevPanelTabId = "telemetry" | "log";

/**
 * Default tab landed on when no persisted value is present.
 */
export const DEFAULT_DEV_PANEL_TAB: TugDevPanelTabId = "telemetry";

/**
 * Set of valid tab ids — used by the reducer to reject unrecognized
 * persisted values from a future-shape tugbank entry.
 */
export const VALID_DEV_PANEL_TABS: ReadonlySet<TugDevPanelTabId> = new Set<TugDevPanelTabId>([
  "telemetry",
  "log",
]);

/**
 * Default panel width in pixels. Matches the historical
 * `--tugx-devpanel-width` value before width became user-tunable.
 */
export const DEFAULT_DEV_PANEL_WIDTH_PX = 420;

/**
 * Minimum panel width — narrow enough to not feel oppressive on a
 * small display, wide enough to keep field rows legible.
 */
export const MIN_DEV_PANEL_WIDTH_PX = 320;

/**
 * Margin reserved on the LEFT side of the viewport so the panel
 * can't be dragged to cover the entire screen. The effective max
 * width is `window.innerWidth - this margin`.
 */
export const MIN_LEFT_GUTTER_PX = 80;

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
  /**
   * Panel width in pixels. User-tunable via the left-edge drag handle
   * (see `ResizeHandle`); persisted to tugbank so reopens restore the
   * preferred size. Clamped to [{@link MIN_DEV_PANEL_WIDTH_PX},
   * `window.innerWidth - {@link MIN_LEFT_GUTTER_PX}`].
   */
  widthPx: number;
}
