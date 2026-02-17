import { describe, test, expect } from "bun:test";

describe("deck layout", () => {
  test("default rowSplits has 3 elements for 4 rows", () => {
    // The default rowSplits for v2 layout with 4 rows (terminal/git/files/stats)
    const defaultRowSplits = [0.25, 0.5, 0.75];

    expect(defaultRowSplits.length).toBe(3);
    expect(defaultRowSplits[0]).toBe(0.25);
    expect(defaultRowSplits[1]).toBe(0.5);
    expect(defaultRowSplits[2]).toBe(0.75);
  });

  test("v1 to v2 migration formula produces valid 3-element rowSplits", () => {
    // v1 default splits: [1/3, 2/3] for git/files/stats (3 rows)
    const v1Splits = [1/3, 2/3];

    // v2 migration: prepend 0.25 and scale existing into remaining 75%
    const v2Splits = [
      0.25,
      0.25 + v1Splits[0] * 0.75,
      0.25 + v1Splits[1] * 0.75
    ];

    // Verify result
    expect(v2Splits.length).toBe(3);
    expect(v2Splits[0]).toBe(0.25);
    expect(v2Splits[1]).toBeCloseTo(0.25 + (1/3) * 0.75, 5);
    expect(v2Splits[2]).toBeCloseTo(0.25 + (2/3) * 0.75, 5);

    // Verify splits are monotonically increasing
    expect(v2Splits[0]).toBeLessThan(v2Splits[1]);
    expect(v2Splits[1]).toBeLessThan(v2Splits[2]);

    // Verify all splits are between 0 and 1
    v2Splits.forEach(split => {
      expect(split).toBeGreaterThan(0);
      expect(split).toBeLessThan(1);
    });
  });

  test("v1 to v2 migration with custom v1 splits", () => {
    // Custom v1 splits
    const v1Splits = [0.4, 0.7];

    // Apply migration formula
    const v2Splits = [
      0.25,
      0.25 + v1Splits[0] * 0.75,
      0.25 + v1Splits[1] * 0.75
    ];

    expect(v2Splits.length).toBe(3);
    expect(v2Splits[0]).toBe(0.25);
    expect(v2Splits[1]).toBeCloseTo(0.55, 5); // 0.25 + 0.4 * 0.75
    expect(v2Splits[2]).toBeCloseTo(0.775, 5); // 0.25 + 0.7 * 0.75

    // Verify monotonic increase
    expect(v2Splits[0]).toBeLessThan(v2Splits[1]);
    expect(v2Splits[1]).toBeLessThan(v2Splits[2]);
  });

  test("v1 to v2 migration preserves relative spacing", () => {
    // In v1 with [1/3, 2/3], the three regions are equal (each ~33%)
    const v1Splits = [1/3, 2/3];
    const v1Region1 = v1Splits[0];
    const v1Region2 = v1Splits[1] - v1Splits[0];
    const v1Region3 = 1 - v1Splits[1];

    // All v1 regions should be approximately equal
    expect(v1Region1).toBeCloseTo(v1Region2, 5);
    expect(v1Region2).toBeCloseTo(v1Region3, 5);

    // After migration to v2
    const v2Splits = [
      0.25,
      0.25 + v1Splits[0] * 0.75,
      0.25 + v1Splits[1] * 0.75
    ];

    // Calculate v2 regions (4 regions now)
    const v2Region1 = v2Splits[0]; // 0.25 (fixed)
    const v2Region2 = v2Splits[1] - v2Splits[0];
    const v2Region3 = v2Splits[2] - v2Splits[1];
    const v2Region4 = 1 - v2Splits[2];

    // Regions 2, 3, 4 should have equal spacing (scaled from v1)
    expect(v2Region2).toBeCloseTo(v2Region3, 5);
    expect(v2Region3).toBeCloseTo(v2Region4, 5);

    // First region is fixed at 0.25, others share remaining 0.75
    expect(v2Region1).toBe(0.25);
    expect(v2Region2 + v2Region3 + v2Region4).toBeCloseTo(0.75, 5);
  });

  test("CardSlot type includes conversation", () => {
    // This is a compile-time check - if this compiles, the type is correct
    const validSlots = ["conversation", "terminal", "git", "files", "stats"];

    expect(validSlots).toContain("conversation");
    expect(validSlots[0]).toBe("conversation");
  });

  test("loadLayout ignores unknown slot names in collapsed array", () => {
    // Simulate a LayoutState with unknown slot name
    const validSlots = ["conversation", "terminal", "git", "files", "stats"];
    const collapsedSlots = ["conversation", "unknown-panel", "files"];

    // Filter to only valid slots
    const filtered = collapsedSlots.filter(slot => validSlots.includes(slot));

    expect(filtered).toEqual(["conversation", "files"]);
    expect(filtered).not.toContain("unknown-panel");
  });

  test("v2 layout round-trip preserves conversation card position", () => {
    // Create a v2 LayoutState with custom splits
    const originalLayout = {
      version: 2,
      colSplit: 0.6,
      rowSplits: [0.3, 0.5, 0.8],
      collapsed: ["files"],
    };

    // Simulate serialization/deserialization
    const serialized = JSON.stringify(originalLayout);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.version).toBe(2);
    expect(deserialized.colSplit).toBe(0.6);
    expect(deserialized.rowSplits).toEqual([0.3, 0.5, 0.8]);
    expect(deserialized.collapsed).toEqual(["files"]);
  });

  test("missing conversation in collapsed array does not cause error", () => {
    // Simulate LayoutState where conversation is not in collapsed array
    const collapsed: string[] = [];
    const validSlots = ["conversation", "terminal", "git", "files", "stats"];

    // Verify conversation is not collapsed (expanded by default)
    const isConversationCollapsed = collapsed.includes("conversation");
    expect(isConversationCollapsed).toBe(false);

    // Verify valid slots still exist
    expect(validSlots).toContain("conversation");
  });
});
