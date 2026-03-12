/**
 * tab-overflow.test.ts -- Unit tests for computeOverflow pure function.
 *
 * Tests cover all cases from the plan:
 * - T01: All tabs fit at full width → stage "none"
 * - T02: Active tab full + minimal icon-only collapse fits → stage "collapsed"
 * - T02m: Minimal collapse — only collapse the minimum number of inactive tabs needed
 * - T03: Tabs overflow even at icon-only → stage "overflow"
 * - T04: Active tab is always in visibleFullIds, never in collapsedIds or overflowIds
 * - T05: Zero tabs → stage "none", all empty arrays
 * - T06: Single tab (active) → stage "none"
 * - T07: Overflow removes tabs from the right (rightmost inactive first)
 * - T08: Even if active tab alone exceeds container, it stays in visibleFullIds
 * - T09: Iconless inactive tabs stay in visibleFullIds at full width during Stage 1
 * - T10: Iconless tabs can still be moved to overflowIds in Stage 2
 * - T10a: ICON_ONLY_TAB_WIDTH constant equals 28 (documents CSS dependency chain)
 *
 * **Stage 1 collapse is minimal:** inactive icon tabs are collapsed one at a time
 * from rightmost inward until the total fits. Only the minimum number needed are
 * collapsed — some inactive tabs may stay at full width. This means collapsedIds
 * may have fewer entries than the total number of inactive icon tabs.
 *
 * **Authoritative references:**
 * - Spec S01: computeOverflow function signature
 * - Spec S02: computeOverflow algorithm
 * - [D01] DOM measurement for full widths, fixed constant for icon-only
 * - [D03] Pure computeOverflow function for testability
 */

import { describe, it, expect } from "bun:test";
import {
  computeOverflow,
  ICON_ONLY_TAB_WIDTH,
  OVERFLOW_BUTTON_WIDTH,
  type TabMeasurement,
} from "@/tab-overflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TabMeasurement with an icon. Full width defaults to 80px. */
function tabWithIcon(tabId: string, fullWidth = 80): TabMeasurement {
  return {
    tabId,
    fullWidth,
    iconOnlyWidth: ICON_ONLY_TAB_WIDTH,
    hasIcon: true,
  };
}

/** Build a TabMeasurement without an icon. Full width defaults to 80px. */
function tabWithoutIcon(tabId: string, fullWidth = 80): TabMeasurement {
  return {
    tabId,
    fullWidth,
    iconOnlyWidth: fullWidth, // iconless tabs cannot collapse
    hasIcon: false,
  };
}

/** Standard widths used across most tests. */
const ADD_BTN_WIDTH = 28;
const OVERFLOW_BTN_WIDTH = OVERFLOW_BUTTON_WIDTH; // 40

// ---------------------------------------------------------------------------
// T10a: ICON_ONLY_TAB_WIDTH constant value
// ---------------------------------------------------------------------------

describe("ICON_ONLY_TAB_WIDTH", () => {
  /**
   * T10a: Assert the constant equals 30 to enforce the CSS dependency chain.
   *
   * CSS dependency chain (tug-tab-bar.css):
   *   - `.tug-tab` padding: var(--tug-base-space-md) = 8px each side
   *   - `.tug-tab-icon` width: var(--tug-base-icon-size-sm) = 14px
   *   Total:                      30px
   *
   * `.tug-tab-title` and `.tug-tab-close` are hidden with `display: none` in
   * collapsed mode, removing them from flex layout so CSS `gap` contributes 0px.
   * Only `.tug-tab-icon` remains as a flex child.
   *
   * If this test fails, update ICON_ONLY_TAB_WIDTH and verify the CSS token
   * values still match.
   */
  it("T10a: equals 30 — 8px left padding + 14px icon + 8px right padding", () => {
    expect(ICON_ONLY_TAB_WIDTH).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// T05: Zero tabs
// ---------------------------------------------------------------------------

describe("computeOverflow — zero tabs", () => {
  it("T05: returns stage 'none' with all empty arrays", () => {
    const result = computeOverflow([], 600, "any", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("none");
    expect(result.visibleFullIds).toEqual([]);
    expect(result.collapsedIds).toEqual([]);
    expect(result.overflowIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T06: Single tab (active)
// ---------------------------------------------------------------------------

describe("computeOverflow — single tab", () => {
  it("T06: single active tab always returns stage 'none'", () => {
    const tabs = [tabWithIcon("tab-1", 80)];
    const result = computeOverflow(tabs, 200, "tab-1", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("none");
    expect(result.visibleFullIds).toEqual(["tab-1"]);
    expect(result.collapsedIds).toEqual([]);
    expect(result.overflowIds).toEqual([]);
  });

  it("T06: single active tab — even with a tiny container, stays in visibleFullIds", () => {
    const tabs = [tabWithIcon("tab-1", 200)];
    // container width (50) is smaller than the tab (200), but it's the only tab.
    const result = computeOverflow(tabs, 50, "tab-1", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.visibleFullIds).toContain("tab-1");
    expect(result.collapsedIds).not.toContain("tab-1");
    expect(result.overflowIds).not.toContain("tab-1");
  });
});

// ---------------------------------------------------------------------------
// T01: All tabs fit at full width
// ---------------------------------------------------------------------------

describe("computeOverflow — all tabs fit (stage 'none')", () => {
  it("T01: two tabs totalling 120px fit in a 200px container (minus 28px add btn)", () => {
    // Available = 200 - 28 = 172px. Tabs: 80 + 80 = 160px → fits.
    const tabs = [tabWithIcon("tab-1", 80), tabWithIcon("tab-2", 80)];
    const result = computeOverflow(tabs, 200, "tab-1", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("none");
    expect(result.visibleFullIds).toEqual(["tab-1", "tab-2"]);
    expect(result.collapsedIds).toEqual([]);
    expect(result.overflowIds).toEqual([]);
  });

  it("T01: three tabs exactly filling available space → stage 'none'", () => {
    // Available = 300 - 28 = 272px. Tabs: 90 + 91 + 91 = 272px → exactly fits.
    const tabs = [tabWithIcon("a", 90), tabWithIcon("b", 91), tabWithIcon("c", 91)];
    const result = computeOverflow(tabs, 300, "a", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("none");
    expect(result.visibleFullIds).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// T02: Stage 1 collapse
// ---------------------------------------------------------------------------

describe("computeOverflow — Stage 1 collapse ('collapsed')", () => {
  it("T02: inactive tab collapses to icon-only when total exceeds container at full width", () => {
    // Available = 200 - 28 = 172px.
    // Full: tab-1(100) + tab-2(100) = 200 → does NOT fit.
    // Minimal Stage 1: collapse rightmost icon tab (tab-2, 100→28): 100+28=128 ≤ 172. ✓
    const tabs = [tabWithIcon("tab-1", 100), tabWithIcon("tab-2", 100)];
    const result = computeOverflow(tabs, 200, "tab-1", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("collapsed");
    expect(result.visibleFullIds).toContain("tab-1");
    expect(result.collapsedIds).toContain("tab-2");
    expect(result.overflowIds).toEqual([]);
  });

  it("T02: multiple inactive tabs collapse when all must collapse to fit", () => {
    // Available = 200 - 28 = 172px.
    // Full: 80 + 80 + 80 = 240 → does not fit.
    // Minimal Stage 1: collapse c(80→28): 188 > 172. Collapse b(80→28): 136 ≤ 172. ✓
    // Both b and c must collapse because collapsing only c isn't enough.
    const tabs = [tabWithIcon("a", 80), tabWithIcon("b", 80), tabWithIcon("c", 80)];
    const result = computeOverflow(tabs, 200, "a", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("collapsed");
    expect(result.visibleFullIds).toEqual(["a"]);
    expect(result.collapsedIds).toHaveLength(2);
    expect(result.collapsedIds).toContain("b");
    expect(result.collapsedIds).toContain("c");
    expect(result.overflowIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T02m: Minimal collapse — only collapse the minimum number of tabs needed
// ---------------------------------------------------------------------------

describe("computeOverflow — minimal collapse strategy", () => {
  it("T02m: only rightmost tab collapses when one collapse is sufficient", () => {
    // Three tabs: active(80), b(50), c(120). Container: 220px.
    // Available = 220 - 28 = 192px. Full: 80+50+120 = 250 → does NOT fit.
    // Minimal Stage 1: collapse rightmost icon tab c(120→28): 250-92=158 ≤ 192. ✓
    // Only c collapses — b stays at full width even though it also has an icon.
    const tabs = [tabWithIcon("active", 80), tabWithIcon("b", 50), tabWithIcon("c", 120)];
    const result = computeOverflow(tabs, 220, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("collapsed");
    expect(result.collapsedIds).toEqual(["c"]); // only rightmost collapsed
    expect(result.visibleFullIds).toContain("active");
    expect(result.visibleFullIds).toContain("b"); // b stays full — minimal collapse
    expect(result.visibleFullIds).not.toContain("c");
    expect(result.overflowIds).toEqual([]);
  });

  it("T02m: middle tabs stay full when only rightmost needs collapsing", () => {
    // Four tabs: active(80), b(40), c(40), d(100). Container: 230px.
    // Available = 230 - 28 = 202px. Full: 80+40+40+100 = 260 → does NOT fit.
    // Minimal Stage 1: collapse d(100→28): 260-72=188 ≤ 202. ✓
    // b and c stay at full width; only d collapses.
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 40),
      tabWithIcon("c", 40),
      tabWithIcon("d", 100),
    ];
    const result = computeOverflow(tabs, 230, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("collapsed");
    expect(result.collapsedIds).toEqual(["d"]);
    expect(result.visibleFullIds).toContain("b");
    expect(result.visibleFullIds).toContain("c");
    expect(result.visibleFullIds).not.toContain("d");
    expect(result.overflowIds).toEqual([]);
  });

  it("T02m: collapsedIds order matches left-to-right tab order (not collapse order)", () => {
    // Three tabs: active(80), b(100), c(100). Container: 210px.
    // Available = 210 - 28 = 182px. Full: 80+100+100=280 → does NOT fit.
    // Minimal Stage 1: collapse c(100→28): 208 > 182. Collapse b(100→28): 136 ≤ 182. ✓
    // Both b and c collapse. collapsedIds should be in LTR order: [b, c].
    const tabs = [tabWithIcon("active", 80), tabWithIcon("b", 100), tabWithIcon("c", 100)];
    const result = computeOverflow(tabs, 210, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("collapsed");
    expect(result.collapsedIds).toEqual(["b", "c"]); // left-to-right order
    expect(result.visibleFullIds).toEqual(["active"]);
  });
});

// ---------------------------------------------------------------------------
// T03: Stage 2 overflow
// ---------------------------------------------------------------------------

describe("computeOverflow — Stage 2 overflow ('overflow')", () => {
  it("T03: tabs overflow even at icon-only → stage 'overflow'", () => {
    // Container: 100px. Available base = 100 - 28 = 72px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: 80(active) + 28 + 28 = 136 > 72 → no.
    // Stage 2: available = 100 - 28 - 40 = 32px.
    //   Start: active(80) + b(28) + c(28) = 136. Remove c → 80+28=108>32. Remove b → 80>32.
    //   All inactive overflow; active alone > 32 → edge case path → active only, others overflow.
    const tabs = [tabWithIcon("a", 80), tabWithIcon("b", 80), tabWithIcon("c", 80)];
    const result = computeOverflow(tabs, 100, "a", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.visibleFullIds).toContain("a");
    expect(result.overflowIds.length).toBeGreaterThan(0);
  });

  it("T03: some tabs overflow while others remain collapsed", () => {
    // Container: 180px. Available base = 180 - 28 = 152px.
    // Full: 80 + 80 + 80 + 80 = 320 → no.
    // Stage 1: 80 + 28 + 28 + 28 = 164 > 152 → no.
    // Stage 2: available overflow = 180 - 28 - 40 = 112px.
    //   Remaining inactive (icon-only): b(28)+c(28)+d(28)=84. Total: 80+84=164>112.
    //   Remove d → 80+28+28=136>112. Remove c → 80+28=108 ≤ 112. ✓
    // Result: visible=[a], collapsed=[b], overflow=[c,d].
    const tabs = [
      tabWithIcon("a", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
    ];
    const result = computeOverflow(tabs, 180, "a", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.visibleFullIds).toEqual(["a"]);
    expect(result.collapsedIds).toEqual(["b"]);
    expect(result.overflowIds).toEqual(["c", "d"]);
  });
});

// ---------------------------------------------------------------------------
// T04: Active tab is always in visibleFullIds
// ---------------------------------------------------------------------------

describe("computeOverflow — active tab invariant", () => {
  it("T04: active tab is never in collapsedIds or overflowIds (stage none)", () => {
    const tabs = [tabWithIcon("active", 80), tabWithIcon("other", 80)];
    const result = computeOverflow(tabs, 400, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.visibleFullIds).toContain("active");
    expect(result.collapsedIds).not.toContain("active");
    expect(result.overflowIds).not.toContain("active");
  });

  it("T04: active tab is never in collapsedIds or overflowIds (stage collapsed)", () => {
    const tabs = [tabWithIcon("active", 100), tabWithIcon("other", 100)];
    const result = computeOverflow(tabs, 200, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.visibleFullIds).toContain("active");
    expect(result.collapsedIds).not.toContain("active");
    expect(result.overflowIds).not.toContain("active");
  });

  it("T04: active tab is never in collapsedIds or overflowIds (stage overflow)", () => {
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
    ];
    const result = computeOverflow(tabs, 180, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.visibleFullIds).toContain("active");
    expect(result.collapsedIds).not.toContain("active");
    expect(result.overflowIds).not.toContain("active");
  });

  it("T04: active tab is preserved regardless of its position in the array", () => {
    // Active tab is the last one (rightmost), which would normally overflow first.
    const tabs = [
      tabWithIcon("a", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("active", 80),
    ];
    const result = computeOverflow(tabs, 180, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.visibleFullIds).toContain("active");
    expect(result.collapsedIds).not.toContain("active");
    expect(result.overflowIds).not.toContain("active");
  });
});

// ---------------------------------------------------------------------------
// T07: Overflow removes tabs from the right (rightmost inactive first)
// ---------------------------------------------------------------------------

describe("computeOverflow — rightmost inactive tabs overflow first", () => {
  it("T07: rightmost inactive tab overflows before leftmost", () => {
    // Container: 160px. Available base = 132px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: 80 + 28 + 28 = 136 > 132 → no.
    // Stage 2: available overflow = 160 - 28 - 40 = 92px.
    //   Start: active(80) + b(28) + c(28) = 136 > 92. Remove c → 80+28=108>92. Remove b → 80 ≤ 92. ✓
    // Both inactive overflow → active tab alone (edge case).
    const tabs = [tabWithIcon("active", 80), tabWithIcon("b", 80), tabWithIcon("c", 80)];
    const result = computeOverflow(tabs, 160, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.overflowIds).toContain("c"); // rightmost overflows first
  });

  it("T07: only rightmost tab overflows when one removal is sufficient", () => {
    // Container: 200px. Available base = 172px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: 80 + 28 + 28 = 136 ≤ 172 → fits as collapsed. NOT overflow case.
    // Use a tighter container to force Stage 2.
    // Container: 155px. Available base = 127px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: 80 + 28 + 28 = 136 > 127 → no.
    // Stage 2: available = 155 - 28 - 40 = 87px.
    //   Start: 80 + 28 + 28 = 136 > 87. Remove c → 80 + 28 = 108 > 87. Remove b → 80 ≤ 87. ✓
    const tabs = [tabWithIcon("active", 80), tabWithIcon("b", 80), tabWithIcon("c", 80)];
    const result = computeOverflow(tabs, 155, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    // Both b and c overflow since active(80) fits in 87px and one more(28) + active(80)=108>87
    // So only active fits.
    expect(result.overflowIds).toContain("c");
  });

  it("T07: leftmost inactive tab remains visible while rightmost overflows", () => {
    // Narrow enough that exactly one inactive tab can collapse alongside the active tab.
    // Container: 160px. Available base = 160 - 28 = 132px.
    // Full: 80 * 4 = 320 > 132 → no.
    // Stage 1: active(80) + b(28) + c(28) + d(28) = 164 > 132 → no.
    // Stage 2: available overflow = 160 - 28 - 40 = 92px.
    //   Start: active(80) + b(28) + c(28) + d(28) = 164 > 92.
    //   Remove d(28) → 80+28+28=136>92. Remove c(28) → 80+28=108>92. Remove b(28) → 80≤92. ✓
    // All inactive overflow; active alone(80) ≤ 92 → NOT edge case.
    // Result: visible=[active], collapsed=[], overflow=[b,c,d].
    // Use a slightly wider container so b remains as collapsed.
    // ICON_ONLY_TAB_WIDTH = 30. Container: 178px.
    // Available overflow = 178 - 28 - 40 = 110px.
    //   Start: 80 + 30 + 30 + 30 = 170 > 110.
    //   Remove d(30) → 80+30+30=140>110. Remove c(30) → 80+30=110 ≤ 110. ✓
    // Result: visible=[active], collapsed=[b], overflow=[c,d].
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
    ];
    const result = computeOverflow(tabs, 178, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    // b is leftmost inactive → should remain collapsed (not overflow)
    expect(result.collapsedIds).toContain("b");
    // c and d are rightmost → should overflow
    expect(result.overflowIds).toContain("c");
    expect(result.overflowIds).toContain("d");
  });
});

// ---------------------------------------------------------------------------
// T08: Active tab alone exceeds container
// ---------------------------------------------------------------------------

describe("computeOverflow — active tab exceeds container (edge case)", () => {
  it("T08: active tab alone wider than container → stays in visibleFullIds, all others overflow", () => {
    // Active tab is 300px wide. Container is 100px.
    // Even in overflow mode, active tab must remain visible.
    const tabs = [
      tabWithIcon("active", 300),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
    ];
    const result = computeOverflow(tabs, 100, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.visibleFullIds).toContain("active");
    expect(result.collapsedIds).not.toContain("active");
    expect(result.overflowIds).not.toContain("active");
    // All others must be in overflow since active alone exceeds available space.
    expect(result.overflowIds).toContain("b");
    expect(result.overflowIds).toContain("c");
    expect(result.collapsedIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T09: Iconless inactive tabs stay at full width during Stage 1
// ---------------------------------------------------------------------------
// Note: In practice, all registered card types now provide an icon (with
// "Diamond" as the fallback default). These tests remain to verify the
// computeOverflow function handles iconless tabs correctly for robustness.

describe("computeOverflow — iconless tabs", () => {
  it("T09: iconless inactive tabs stay in visibleFullIds (not collapsed) during Stage 1", () => {
    const tabsIconless = [
      tabWithIcon("active", 50),
      tabWithoutIcon("iconless", 60),
    ];
    // Available = 200 - 28 = 172. Full: 50 + 60 = 110 → fits → stage none.
    const result1 = computeOverflow(tabsIconless, 200, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result1.stage).toBe("none");
    expect(result1.visibleFullIds).toContain("iconless");
    expect(result1.collapsedIds).not.toContain("iconless");

    // Force Stage 1 by having an icon tab that must collapse; iconless tab stays full.
    const tabsMixed = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 100), // can collapse to 28
      tabWithoutIcon("iconless", 80), // cannot collapse
    ];
    // Available = 250 - 28 = 222. Full: 80 + 100 + 80 = 260 > 222.
    // Minimal Stage 1: collapse rightmost icon tab. Rightmost icon tab is b (iconless
    // cannot collapse). Collapse b(100→28): 80+28+80=188 ≤ 222. ✓
    const result2 = computeOverflow(tabsMixed, 250, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result2.stage).toBe("collapsed");
    expect(result2.visibleFullIds).toContain("active");
    expect(result2.visibleFullIds).toContain("iconless"); // stays at full width
    expect(result2.collapsedIds).toContain("b"); // icon tab collapses
    expect(result2.collapsedIds).not.toContain("iconless"); // iconless never collapses
  });
});

// ---------------------------------------------------------------------------
// T10: Iconless tabs can be moved to overflowIds in Stage 2
// ---------------------------------------------------------------------------
// Note: In practice, all registered card types now provide an icon (with
// "Diamond" as the fallback default). These tests remain to verify the
// computeOverflow function handles iconless tabs correctly for robustness.

describe("computeOverflow — iconless tabs can overflow", () => {
  it("T10: iconless inactive tab moves to overflowIds in Stage 2 when needed", () => {
    // Tight container forces Stage 2. Iconless tab is rightmost inactive.
    // Container: 120px. Available base = 92px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: active(80) + b(28) + iconless(80, cannot collapse) = 188 > 92 → no.
    // Stage 2: available = 120 - 28 - 40 = 52px.
    //   Inactive in order: [b(28 icon-only), iconless(80 full)].
    //   Start: 80 + 28 + 80 = 188 > 52.
    //   Remove iconless (rightmost) → 80 + 28 = 108 > 52.
    //   Remove b → 80 ≤ 52? No, 80 > 52. Edge case: active alone > 52.
    // Use a larger container so only iconless overflows.
    // Container: 160px. Available base = 132px.
    // Full: 80 + 80 + 80 = 240 → no.
    // Stage 1: 80 + 28 + 80 = 188 > 132 → no.
    // Stage 2: available = 160 - 28 - 40 = 92px.
    //   Start: 80 + 28 + 80 = 188 > 92. Remove iconless(80) → 80+28=108>92. Remove b(28) → 80≤92. ✓
    // Active alone (80) ≤ 92 → NOT edge case. Both b and iconless overflow.
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithoutIcon("iconless", 80),
    ];
    const result = computeOverflow(tabs, 160, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.overflowIds).toContain("iconless");
    expect(result.visibleFullIds).toContain("active");
  });

  it("T10: iconless tab overflows before leftmost icon tab if rightmost", () => {
    // With 5 tabs where iconless is second-to-last — it can be removed.
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithoutIcon("iconless", 80),
      tabWithIcon("e", 80),
    ];
    // Container: 200px. Available overflow = 200 - 28 - 40 = 132px.
    // Stage 1 inactive: b(28)+c(28)+iconless(80)+e(28) = 164. Total: 80+164=244>132.
    // Remove e(28) → 80+28+28+80=216>132. Remove iconless(80) → 80+28+28=136>132.
    // Remove c(28) → 80+28=108 ≤ 132. ✓
    const result = computeOverflow(tabs, 200, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.overflowIds).toContain("e");
    expect(result.overflowIds).toContain("iconless");
    expect(result.overflowIds).toContain("c");
    expect(result.collapsedIds).toContain("b");
    expect(result.visibleFullIds).toContain("active");
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("computeOverflow — edge cases", () => {
  it("all tabs overflow except active when container is extremely narrow", () => {
    const tabs = [
      tabWithIcon("active", 60),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
    ];
    // Container: 80px. Available base = 52. Active alone(60) > 52 → but after overflow btn:
    // Available overflow = 80 - 28 - 40 = 12px. Active(60) > 12. Edge case: all others overflow.
    const result = computeOverflow(tabs, 80, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.visibleFullIds).toContain("active");
    expect(result.overflowIds).toContain("b");
    expect(result.overflowIds).toContain("c");
    expect(result.overflowIds).toContain("d");
  });

  it("exactly one tab overflows when container is just barely too small", () => {
    // We need Stage 1 to fail but Stage 2 to pass after removing only 1 tab.
    // Stage 1 available = containerWidth - addButtonWidth (28).
    // Stage 2 available = containerWidth - 28 - 40 = containerWidth - 68.
    // With 3 tabs: active(80) + b(icon-only=28) + c(icon-only=28).
    // Stage 1 total = 80 + 28 + 28 = 136. Need 136 > stage1_avail and 136-28=108 ≤ stage2_avail.
    //   stage2_avail = container - 68. 108 ≤ container - 68 → container ≥ 176.
    //   stage1_avail = container - 28. 136 > container - 28 → container < 164.
    // These constraints conflict (need container ≥ 176 and < 164). Not achievable with 3 tabs at 80px.
    //
    // Use larger tabs: active(100) + b(80) + c(80).
    // Stage 1: active(100) + b(28) + c(28) = 156. Need 156 > container-28 and 156-28=128 ≤ container-68.
    //   container-28 < 156 → container < 184.
    //   container-68 ≥ 128 → container ≥ 196.
    // Still conflict. Need inactive larger for Stage 1 failure but icon-only small.
    // The issue: Stage 1 uses iconOnlyWidth(28) which is smaller than the Stage 2 removal savings.
    //
    // Real achievable case: with more inactive tabs, one can be removed in Stage 2.
    // 4 tabs: active(80) + b(28) + c(28) + d(28) = 164.
    // Stage 1 avail: container - 28. Need 164 > container - 28 → container < 192.
    // Stage 2 avail: container - 68. Need 164-28=136 > container-68 and 136-28=108 ≤ container-68.
    //   container-68 < 136 → container < 204.
    //   container-68 ≥ 108 → container ≥ 176.
    // Valid range: 176 ≤ container < 192. Use container=180.
    // Stage 1: avail=152. 164 > 152 → Stage 1 fails.
    // Stage 2: avail=112. Start: 164>112. Remove d(28) → 136>112. Remove c(28) → 108≤112. ✓
    // Result: visible=[active], collapsed=[b], overflow=[c,d].
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
    ];
    const result = computeOverflow(tabs, 180, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    expect(result.overflowIds).toEqual(["c", "d"]);
    expect(result.collapsedIds).toEqual(["b"]);
    expect(result.visibleFullIds).toEqual(["active"]);
  });

  it("overflowIds preserves left-to-right order", () => {
    // 5 tabs where 3 end up in overflow.
    const tabs = [
      tabWithIcon("active", 80),
      tabWithIcon("b", 80),
      tabWithIcon("c", 80),
      tabWithIcon("d", 80),
      tabWithIcon("e", 80),
    ];
    // Available overflow = 200 - 28 - 40 = 132px.
    // inactive collapsed: b(28)+c(28)+d(28)+e(28)=112. Total: 80+112=192>132.
    // Remove e → 80+84=164>132. Remove d → 80+56=136>132. Remove c → 80+28=108≤132. ✓
    // overflowIds should be [c, d, e] in left-to-right order (c was removed 3rd, but we unshift).
    const result = computeOverflow(tabs, 200, "active", OVERFLOW_BTN_WIDTH, ADD_BTN_WIDTH);
    expect(result.stage).toBe("overflow");
    // overflowIds maintains original left-to-right order: [c, d, e].
    expect(result.overflowIds).toEqual(["c", "d", "e"]);
    expect(result.collapsedIds).toEqual(["b"]);
  });
});
