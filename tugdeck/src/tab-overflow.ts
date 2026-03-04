/**
 * tab-overflow.ts -- Pure overflow computation for TugTabBar.
 *
 * This module contains no DOM, React, or ResizeObserver dependencies.
 * All logic is pure and deterministic given the input measurements.
 * See plan Decision [D03] for rationale.
 *
 * **CSS dependency:** ICON_ONLY_TAB_WIDTH = 28 is derived from:
 *   - `.tug-tab` left padding:  8px
 *   - `.tug-tab-icon` width:   12px
 *   - `.tug-tab` right padding: 8px
 *   Total: 28px (gap contributes 0px because `.tug-tab-title` and
 *   `.tug-tab-close` are hidden with `display: none` in collapsed mode,
 *   leaving only `.tug-tab-icon` as a flex child).
 * If any of these CSS values change, this constant MUST be updated.
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
 * CSS dependency chain: `.tug-tab` padding (8px + 8px) + `.tug-tab-icon`
 * width (12px) = 28px. When `.tug-tab-title` and `.tug-tab-close` are hidden
 * via `display: none`, CSS flex `gap` applies 0px between flex children
 * (only one child remains: `.tug-tab-icon`).
 *
 * **Any change here MUST be accompanied by a matching CSS update in
 * `tug-tab-bar.css`.**
 */
export const ICON_ONLY_TAB_WIDTH = 28;

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
 * 3. Stage 1 collapse: keep active tab at full width; collapse inactive tabs
 *    with icons to iconOnlyWidth; iconless tabs stay at fullWidth.
 *    If the total fits, return stage "collapsed".
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

  // Step 3: Stage 1 collapse.
  // Active tab stays at fullWidth. Inactive tabs with icons use iconOnlyWidth;
  // inactive iconless tabs stay at fullWidth.
  let stage1Total = 0;
  const activeTab = tabs.find((t) => t.tabId === activeTabId);
  const activeFullWidth = activeTab?.fullWidth ?? 0;
  stage1Total += activeFullWidth;

  // Categorize inactive tabs for Stage 1.
  const stage1Collapsed: string[] = [];
  const stage1FullInactive: string[] = [];

  for (const tab of tabs) {
    if (tab.tabId === activeTabId) continue;
    if (tab.hasIcon) {
      stage1Total += tab.iconOnlyWidth;
      stage1Collapsed.push(tab.tabId);
    } else {
      stage1Total += tab.fullWidth;
      stage1FullInactive.push(tab.tabId);
    }
  }

  if (stage1Total <= availableBase) {
    // All tabs fit with Stage 1 collapse applied.
    const visibleFullIds = [activeTabId, ...stage1FullInactive];
    return {
      stage: "collapsed",
      visibleFullIds,
      collapsedIds: stage1Collapsed,
      overflowIds: [],
    };
  }

  // Step 4: Stage 2 overflow.
  // Reserve additional space for the overflow button.
  const availableOverflow = containerWidth - addButtonWidth - overflowButtonWidth;

  // Build ordered list of inactive tabs (preserving left-to-right order from `tabs`).
  // We remove from the rightmost inactive tab first.
  const inactiveTabs = tabs.filter((t) => t.tabId !== activeTabId);

  // Start with all inactive tabs participating (collapsed if they have icons,
  // full-width if iconless). Remove from the right until things fit.
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
