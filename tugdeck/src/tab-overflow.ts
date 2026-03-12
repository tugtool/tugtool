/**
 * tab-overflow.ts -- Pure overflow computation for TugTabBar.
 *
 * This module contains no DOM, React, or ResizeObserver dependencies.
 * All logic is pure and deterministic given the input measurements.
 * See plan Decision [D03] for rationale.
 *
 * **CSS dependency:** ICON_ONLY_TAB_WIDTH = 30 is derived from:
 *   - `.tug-tab` padding: var(--tug-base-space-md) = 8px each side
 *   - `.tug-tab-icon` width: var(--tug-base-icon-size-sm) = 14px
 *   Total: 30px (gap contributes 0px because `.tug-tab-title` and
 *   `.tug-tab-close` are hidden with `display: none` in collapsed mode,
 *   leaving only `.tug-tab-icon` as a flex child).
 * If any of these CSS token values change, this constant MUST be updated.
 *
 * **Authoritative references:**
 * - [D01] DOM measurement for full widths, fixed constant for icon-only
 * - [D03] Pure computeOverflow function for testability
 * - Spec S01: computeOverflow function signature
 * - Spec S02: computeOverflow algorithm
 */

// ---- Constants ----

/**
 * Fixed width (px) of a tab in icon-only (Stage 1 collapsed) mode.
 *
 * CSS dependency chain: `.tug-tab` padding (--tug-base-space-md × 2 = 16px)
 * + `.tug-tab-icon` width (--tug-base-icon-size-sm = 14px) = 30px.
 * When `.tug-tab-title` and `.tug-tab-close` are hidden
 * via `display: none`, CSS flex `gap` applies 0px between flex children
 * (only one child remains: `.tug-tab-icon`).
 *
 * **Any change here MUST be accompanied by a matching CSS token update in
 * tug-tokens.css.**
 */
export const ICON_ONLY_TAB_WIDTH = 30;

/**
 * Estimated width (px) of the overflow dropdown button, used as a bootstrap
 * value for the first computation that introduces overflow (before the button
 * is rendered and measurable).
 */
export const OVERFLOW_BUTTON_WIDTH = 40;

// ---- Types (Spec S01) ----

/**
 * Per-tab measurements used as input to computeOverflow.
 *
 * `hasIcon` determines whether this tab can collapse to icon-only.
 * Tabs without an icon cannot collapse (their minimum width is `fullWidth`).
 *
 * `iconOnlyWidth` should be set to ICON_ONLY_TAB_WIDTH when `hasIcon` is true,
 * or to `fullWidth` when `hasIcon` is false (iconless tabs cannot collapse).
 */
export interface TabMeasurement {
  tabId: string;
  /** Width with icon + label + close button (measured via getBoundingClientRect). */
  fullWidth: number;
  /**
   * Width when collapsed to icon-only.
   * Use ICON_ONLY_TAB_WIDTH when hasIcon is true.
   * Use fullWidth when hasIcon is false (iconless tabs cannot collapse).
   */
  iconOnlyWidth: number;
  /** Whether this tab has an icon and can collapse to icon-only. */
  hasIcon: boolean;
}

/**
 * Result of computeOverflow: partitions tab IDs into three sets.
 *
 * `stage` describes the overall overflow state:
 * - "none":      All tabs fit at full width.
 * - "collapsed": Some inactive tabs collapsed to icon-only to fit.
 * - "overflow":  Some tabs moved to the overflow dropdown.
 *
 * Exactly one of (visibleFullIds, collapsedIds) describes visible tabs;
 * overflowIds lists hidden tabs for the overflow dropdown.
 */
export interface OverflowResult {
  stage: "none" | "collapsed" | "overflow";
  /** Tab IDs shown at full width (always includes activeTabId when tabs exist). */
  visibleFullIds: string[];
  /** Tab IDs shown as icon-only (collapsed, Stage 1). */
  collapsedIds: string[];
  /** Tab IDs hidden from the bar; shown in the overflow dropdown (Stage 2). */
  overflowIds: string[];
}

// ---- computeOverflow (Spec S02) ----

/**
 * Pure function computing tab overflow state given measured widths.
 *
 * Algorithm (Spec S02):
 * 1. Reserve space for the [+] button (addButtonWidth).
 * 2. Try all tabs at full width. If they fit, return stage "none".
 * 3. Stage 1 collapse (minimal): keep active tab at full width; collapse
 *    inactive tabs with icons one at a time from rightmost inward until the
 *    total fits. Iconless tabs always stay at fullWidth. Only the minimum
 *    number of tabs are collapsed — some inactive tabs may remain full-width.
 *    If the total fits after collapsing some (or all) icon tabs, return stage
 *    "collapsed".
 * 4. Stage 2 overflow: reserve space for the overflow button. Remove tabs
 *    from the right (rightmost inactive first) until the remainder fits.
 *    Return stage "overflow".
 * 5. Edge case: if even the active tab alone exceeds the container, return
 *    stage "overflow" with only the active tab visible.
 *
 * @param tabs           Ordered array of tab measurements (left to right).
 * @param containerWidth Width of the tab bar container in pixels.
 * @param activeTabId    ID of the currently active tab.
 * @param overflowButtonWidth Width of the overflow button (measured or OVERFLOW_BUTTON_WIDTH).
 * @param addButtonWidth Width of the [+] add-tab button.
 * @returns OverflowResult partitioning tabs into visible/collapsed/overflow sets.
 */
export function computeOverflow(
  tabs: TabMeasurement[],
  containerWidth: number,
  activeTabId: string,
  overflowButtonWidth: number,
  addButtonWidth: number,
): OverflowResult {
  // Edge case: no tabs.
  if (tabs.length === 0) {
    return { stage: "none", visibleFullIds: [], collapsedIds: [], overflowIds: [] };
  }

  // Available space after reserving room for the [+] button.
  const availableBase = containerWidth - addButtonWidth;

  // Step 2: Try all tabs at full width.
  const totalFull = tabs.reduce((sum, t) => sum + t.fullWidth, 0);
  if (totalFull <= availableBase) {
    return {
      stage: "none",
      visibleFullIds: tabs.map((t) => t.tabId),
      collapsedIds: [],
      overflowIds: [],
    };
  }

  // Step 3: Stage 1 collapse — minimal strategy.
  // Start with all tabs at full width. Collapse inactive icon tabs one at a
  // time from rightmost inward until the total fits. Only the minimum number
  // of tabs are collapsed; iconless tabs always remain at full width.
  const activeTab = tabs.find((t) => t.tabId === activeTabId);
  const activeFullWidth = activeTab?.fullWidth ?? 0;

  // Collect inactive tabs in left-to-right order.
  const inactiveTabs = tabs.filter((t) => t.tabId !== activeTabId);

  // Collect inactive icon tabs in right-to-left order (rightmost first for collapse).
  const inactiveIconTabsRTL = inactiveTabs.filter((t) => t.hasIcon).reverse();

  // Running total starts at full width for all tabs.
  let stage1Running = totalFull;
  const stage1Collapsed: string[] = [];

  for (const tab of inactiveIconTabsRTL) {
    if (stage1Running <= availableBase) break;
    // Collapse this tab: replace fullWidth with iconOnlyWidth.
    stage1Running -= tab.fullWidth - tab.iconOnlyWidth;
    stage1Collapsed.push(tab.tabId);
  }

  if (stage1Running <= availableBase) {
    // Fits after minimal collapse. Build visibleFullIds (all tabs NOT collapsed).
    const collapsedSet = new Set(stage1Collapsed);
    const visibleFullIds = tabs
      .filter((t) => !collapsedSet.has(t.tabId))
      .map((t) => t.tabId);
    // Restore left-to-right order for collapsedIds.
    const collapsedIds = inactiveTabs
      .filter((t) => collapsedSet.has(t.tabId))
      .map((t) => t.tabId);
    return {
      stage: "collapsed",
      visibleFullIds,
      collapsedIds,
      overflowIds: [],
    };
  }

  // Step 4: Stage 2 overflow.
  // Reserve additional space for the overflow button.
  const availableOverflow = containerWidth - addButtonWidth - overflowButtonWidth;

  // Start with all inactive tabs at their collapsed sizes (icon-only for icon
  // tabs, fullWidth for iconless tabs). Remove from the right until things fit.
  const overflowIds: string[] = [];

  // Clone the inactive tab list so we can pop from the right.
  const remainingInactive = [...inactiveTabs];

  let currentTotal =
    activeFullWidth +
    remainingInactive.reduce((sum, t) => sum + (t.hasIcon ? t.iconOnlyWidth : t.fullWidth), 0);

  while (currentTotal > availableOverflow && remainingInactive.length > 0) {
    // Pop the rightmost inactive tab.
    const removed = remainingInactive.pop()!;
    overflowIds.unshift(removed.tabId); // maintain left-to-right order in overflow list
    currentTotal -= removed.hasIcon ? removed.iconOnlyWidth : removed.fullWidth;
  }

  // Edge case: even the active tab alone exceeds the container.
  // Keep only the active tab visible; all others go to overflow.
  if (activeFullWidth > availableOverflow && remainingInactive.length === 0) {
    const allOverflow = inactiveTabs.map((t) => t.tabId);
    return {
      stage: "overflow",
      visibleFullIds: [activeTabId],
      collapsedIds: [],
      overflowIds: allOverflow,
    };
  }

  // Partition remaining inactive into collapsed vs. full-width.
  const finalCollapsed: string[] = [];
  const finalFullInactive: string[] = [];
  for (const tab of remainingInactive) {
    if (tab.hasIcon) {
      finalCollapsed.push(tab.tabId);
    } else {
      finalFullInactive.push(tab.tabId);
    }
  }

  return {
    stage: "overflow",
    visibleFullIds: [activeTabId, ...finalFullInactive],
    collapsedIds: finalCollapsed,
    overflowIds,
  };
}
