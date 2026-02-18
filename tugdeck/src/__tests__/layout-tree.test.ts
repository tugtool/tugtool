import { describe, test, expect } from "bun:test";
import {
  normalizeTree,
  insertNode,
  removeTab,
  findTabNode,
  type SplitNode,
  type TabNode,
  type TabItem,
  type LayoutNode,
} from "../layout-tree";
import {
  serialize,
  deserialize,
  validateDockState,
  migrateV2ToV3,
  buildDefaultLayout,
  type SerializedDockState,
  type V2LayoutState,
} from "../serialization";

// ---- Helpers ----

function makeTab(componentId: string, title?: string): TabItem {
  return {
    id: crypto.randomUUID(),
    componentId,
    title: title ?? componentId,
    closable: true,
  };
}

function makeTabNode(componentId: string): TabNode {
  return {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [makeTab(componentId)],
    activeTabIndex: 0,
  };
}

function makeHSplit(children: LayoutNode[], weights?: number[]): SplitNode {
  const w = weights ?? children.map(() => 1 / children.length);
  return { type: "split", orientation: "horizontal", children, weights: w };
}

function makeVSplit(children: LayoutNode[], weights?: number[]): SplitNode {
  const w = weights ?? children.map(() => 1 / children.length);
  return { type: "split", orientation: "vertical", children, weights: w };
}

// ---- normalizeTree tests ----

describe("normalizeTree", () => {
  test("preserves valid tree unchanged (structure)", () => {
    // A valid tree: horizontal split with conversation left, vertical right
    const left = makeTabNode("conversation");
    const right = makeVSplit(
      [makeTabNode("terminal"), makeTabNode("git"), makeTabNode("files"), makeTabNode("stats")],
      [0.25, 0.25, 0.25, 0.25]
    );
    const root = makeHSplit([left, right], [0.667, 0.333]);

    const result = normalizeTree(root);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect(split.children.length).toBe(2);
    expect(split.children[0].type).toBe("tab");
    expect(split.children[1].type).toBe("split");
  });

  test("flattens same-grain nested horizontal splits (L01.1)", () => {
    // H(H(A, B), C) -> H(A, B, C)
    const a = makeTabNode("terminal");
    const b = makeTabNode("git");
    const c = makeTabNode("files");
    const inner = makeHSplit([a, b], [0.5, 0.5]);
    const outer = makeHSplit([inner, c], [0.5, 0.5]);

    const result = normalizeTree(outer);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect(split.children.length).toBe(3); // flattened: A, B, C
    expect(split.children[0].type).toBe("tab");
    expect(split.children[1].type).toBe("tab");
    expect(split.children[2].type).toBe("tab");
  });

  test("flattens same-grain nested vertical splits (L01.1)", () => {
    // V(A, V(B, C)) -> V(A, B, C)
    const a = makeTabNode("terminal");
    const b = makeTabNode("git");
    const c = makeTabNode("files");
    const inner = makeVSplit([b, c], [0.5, 0.5]);
    const outer = makeVSplit([a, inner], [0.5, 0.5]);

    const result = normalizeTree(outer);
    expect(result).not.toBeNull();
    const split = result as SplitNode;
    expect(split.orientation).toBe("vertical");
    expect(split.children.length).toBe(3);
  });

  test("does NOT flatten cross-grain nesting (H inside V is not flattened)", () => {
    // V(H(A, B), C) is valid (different orientation), should NOT be flattened
    const a = makeTabNode("terminal");
    const b = makeTabNode("git");
    const c = makeTabNode("files");
    const inner = makeHSplit([a, b], [0.5, 0.5]);
    const outer = makeVSplit([inner, c], [0.5, 0.5]);

    const result = normalizeTree(outer);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("vertical");
    expect(split.children.length).toBe(2); // NOT flattened
    expect(split.children[0].type).toBe("split"); // inner H split preserved
    expect((split.children[0] as SplitNode).orientation).toBe("horizontal");
  });

  test("removes single-child splits (L01.2)", () => {
    // A split that has only one child should be replaced by that child
    const a = makeTabNode("terminal");
    const singleChild = makeHSplit([a], [1.0]);

    const result = normalizeTree(singleChild);
    expect(result).not.toBeNull();
    // The single-child split is replaced by the child itself
    expect(result!.type).toBe("tab");
  });

  test("removes empty tab nodes and cleans up (L01.6)", () => {
    // A split with one real tab node and one empty tab node
    // After removing the empty one, if only one child remains, the split is also removed
    const real = makeTabNode("terminal");
    const empty: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [],
      activeTabIndex: 0,
    };
    const split = makeHSplit([real, empty], [0.5, 0.5]);

    const result = normalizeTree(split);
    // Empty tab removed -> single child -> split replaced by the real tab node
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tab");
  });

  test("renormalizes weights to sum to 1.0 (L01.5)", () => {
    // Weights that don't sum to 1.0 should be renormalized
    const a = makeTabNode("terminal");
    const b = makeTabNode("git");
    const c = makeTabNode("files");
    const split = makeHSplit([a, b, c], [2.0, 3.0, 5.0]); // total 10.0

    const result = normalizeTree(split) as SplitNode;
    expect(result).not.toBeNull();
    const total = result.weights.reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1.0, 5);
    expect(result.weights[0]).toBeCloseTo(0.2, 5);
    expect(result.weights[1]).toBeCloseTo(0.3, 5);
    expect(result.weights[2]).toBeCloseTo(0.5, 5);
  });

  test("normalizeTree is geometry-agnostic: does not take pixel dimensions", () => {
    // Verify the function signature does not accept pixel parameters.
    // normalizeTree(node: LayoutNode): LayoutNode | null -- no width/height params.
    // This test verifies the API contract: passing a valid tree returns the same structure
    // without requiring any pixel/size information.
    const tree = makeHSplit(
      [makeTabNode("conversation"), makeTabNode("terminal")],
      [0.6, 0.4]
    );

    // Should work with ONLY the node argument -- no canvas dimensions needed
    const result = normalizeTree(tree);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("split");
    // Weights should remain proportionally correct without any pixel input
    const split = result as SplitNode;
    expect(split.weights[0]).toBeCloseTo(0.6, 5);
    expect(split.weights[1]).toBeCloseTo(0.4, 5);
  });

  test("clamps activeTabIndex to valid range", () => {
    const tabs = [makeTab("terminal"), makeTab("git")];
    const node: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs,
      activeTabIndex: 99, // out of range
    };

    const result = normalizeTree(node) as TabNode;
    expect(result).not.toBeNull();
    expect(result.activeTabIndex).toBe(1); // clamped to tabs.length - 1
  });
});

// ---- insertNode tests ----

describe("insertNode", () => {
  test("insertNode at widget-left creates a horizontal split", () => {
    const existing = makeTabNode("terminal");
    const root: LayoutNode = existing;
    const newTab = makeTab("git");

    const result = insertNode(root, existing.id, "widget-left", newTab);

    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect(split.children.length).toBe(2);
    // New tab is on the left
    expect(split.children[0].type).toBe("tab");
    expect((split.children[0] as TabNode).tabs[0].componentId).toBe("git");
    // Original is on the right
    expect(split.children[1].type).toBe("tab");
    expect((split.children[1] as TabNode).tabs[0].componentId).toBe("terminal");
  });

  test("insertNode at widget-right creates a horizontal split with new tab on right", () => {
    const existing = makeTabNode("terminal");
    const root: LayoutNode = existing;
    const newTab = makeTab("git");

    const result = insertNode(root, existing.id, "widget-right", newTab);

    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect(split.children[0].type).toBe("tab");
    expect((split.children[0] as TabNode).tabs[0].componentId).toBe("terminal");
    expect(split.children[1].type).toBe("tab");
    expect((split.children[1] as TabNode).tabs[0].componentId).toBe("git");
  });

  test("insertNode at widget-top creates a vertical split with new tab on top", () => {
    const existing = makeTabNode("terminal");
    const root: LayoutNode = existing;
    const newTab = makeTab("git");

    const result = insertNode(root, existing.id, "widget-top", newTab);

    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("vertical");
    expect((split.children[0] as TabNode).tabs[0].componentId).toBe("git");
    expect((split.children[1] as TabNode).tabs[0].componentId).toBe("terminal");
  });

  test("insertNode at tab-bar adds tab to existing TabNode", () => {
    const existing = makeTabNode("terminal");
    const root: LayoutNode = existing;
    const newTab = makeTab("git");

    const result = insertNode(root, existing.id, "tab-bar", newTab);

    // Same TabNode id doesn't survive through insert (new tab added to node)
    // Result should still be a tab node with 2 tabs
    expect(result.type).toBe("tab");
    const tabNode = result as TabNode;
    expect(tabNode.tabs.length).toBe(2);
    expect(tabNode.tabs[0].componentId).toBe("terminal");
    expect(tabNode.tabs[1].componentId).toBe("git");
    // New tab should be active
    expect(tabNode.activeTabIndex).toBe(1);
  });

  test("insertNode at root-left wraps entire root in horizontal split", () => {
    const existing = makeTabNode("terminal");
    const root: LayoutNode = existing;
    const newTab = makeTab("git");

    const result = insertNode(root, null, "root-left", newTab);

    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect(split.children.length).toBe(2);
    // New node on left
    expect((split.children[0] as TabNode).tabs[0].componentId).toBe("git");
    // Original on right
    expect((split.children[1] as TabNode).tabs[0].componentId).toBe("terminal");
  });

  test("insertNode at root-right wraps entire root in horizontal split", () => {
    const existing = makeTabNode("terminal");
    const newTab = makeTab("git");

    const result = insertNode(existing, null, "root-right", newTab);
    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    expect((split.children[0] as TabNode).tabs[0].componentId).toBe("terminal");
    expect((split.children[1] as TabNode).tabs[0].componentId).toBe("git");
  });

  test("insertNode normalizes result after insertion", () => {
    // Insert into a horizontal split at widget-left of one of the children
    // Should normalize but not flatten different-orientation nested splits
    const term = makeTabNode("terminal");
    const git = makeTabNode("git");
    const root = makeHSplit([term, git], [0.5, 0.5]);
    const newTab = makeTab("files");

    const result = insertNode(root, term.id, "widget-left", newTab);
    // Result: H(H(files_new, terminal), git) -> H flattens H -> H(files_new, terminal, git)
    expect(result.type).toBe("split");
    const split = result as SplitNode;
    expect(split.orientation).toBe("horizontal");
    // The inner H split (files_new, terminal) was flattened into the outer H split
    expect(split.children.length).toBe(3);
  });
});

// ---- removeTab tests ----

describe("removeTab", () => {
  test("removeTab from multi-tab node preserves remaining tabs", () => {
    const tab1 = makeTab("terminal");
    const tab2 = makeTab("git");
    const node: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab1, tab2],
      activeTabIndex: 0,
    };

    const result = removeTab(node, tab1.id);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("tab");
    const tabNode = result as TabNode;
    expect(tabNode.tabs.length).toBe(1);
    expect(tabNode.tabs[0].componentId).toBe("git");
    expect(tabNode.activeTabIndex).toBe(0); // clamped from 0
  });

  test("removeTab adjusts activeTabIndex when removing before active tab", () => {
    const tab1 = makeTab("terminal");
    const tab2 = makeTab("git");
    const tab3 = makeTab("files");
    const node: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab1, tab2, tab3],
      activeTabIndex: 2, // files is active
    };

    // Remove tab1 (index 0, before active)
    const result = removeTab(node, tab1.id);
    expect(result).not.toBeNull();
    const tabNode = result as TabNode;
    expect(tabNode.tabs.length).toBe(2);
    expect(tabNode.activeTabIndex).toBe(1); // shifted down by 1
  });

  test("removeTab of last tab removes TabNode and returns null (or normalizes to null)", () => {
    const tab = makeTab("terminal");
    const node: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab],
      activeTabIndex: 0,
    };

    const result = removeTab(node, tab.id);
    // Empty tab node is removed (null)
    expect(result).toBeNull();
  });

  test("removeTab of last tab in a split removes the TabNode and normalizes", () => {
    const tab1 = makeTab("terminal");
    const tab2 = makeTab("git");
    const leftNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab1],
      activeTabIndex: 0,
    };
    const rightNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab2],
      activeTabIndex: 0,
    };
    const split = makeHSplit([leftNode, rightNode], [0.5, 0.5]);

    // Remove the only tab from leftNode
    const result = removeTab(split, tab1.id);

    // leftNode is removed, split has only one child -> split is replaced by rightNode
    expect(result).not.toBeNull();
    expect(result!.type).toBe("tab");
    const tabNode = result as TabNode;
    expect(tabNode.tabs[0].componentId).toBe("git");
  });

  test("removeTab with non-existent tabId returns tree unchanged", () => {
    const tab = makeTab("terminal");
    const node: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [tab],
      activeTabIndex: 0,
    };

    const result = removeTab(node, "nonexistent-id");
    expect(result).not.toBeNull();
    expect((result as TabNode).tabs.length).toBe(1);
  });
});

// ---- findTabNode tests ----

describe("findTabNode", () => {
  test("finds TabNode by id in a simple tree", () => {
    const left = makeTabNode("terminal");
    const right = makeTabNode("git");
    const root = makeHSplit([left, right], [0.5, 0.5]);

    const found = findTabNode(root, left.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(left.id);
    expect(found!.tabs[0].componentId).toBe("terminal");
  });

  test("returns null when TabNode not found", () => {
    const root = makeTabNode("terminal");
    const found = findTabNode(root, "nonexistent-id");
    expect(found).toBeNull();
  });

  test("finds TabNode deep in nested split tree", () => {
    const deep = makeTabNode("stats");
    const root = makeHSplit(
      [makeTabNode("conversation"), makeVSplit([makeTabNode("terminal"), makeTabNode("git"), deep])],
      [0.5, 0.5]
    );

    const found = findTabNode(root, deep.id);
    expect(found).not.toBeNull();
    expect(found!.tabs[0].componentId).toBe("stats");
  });
});

// ---- serialize / deserialize tests ----

describe("serialize and deserialize", () => {
  test("round-trip produces identical DockState structure", () => {
    const original = buildDefaultLayout();
    const serialized = serialize(original);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json);

    // Check root structure
    expect(restored.root.type).toBe("split");
    expect((restored.root as SplitNode).orientation).toBe("horizontal");
    expect((restored.root as SplitNode).children.length).toBe(2);

    // Check floating
    expect(restored.floating.length).toBe(0);
  });

  test("serialize produces version 3 format", () => {
    const state = buildDefaultLayout();
    const serialized = serialize(state);

    expect(serialized.version).toBe(3);
    expect(serialized.root).toBeDefined();
    expect(serialized.floating).toBeDefined();
  });

  test("serialize uses 'tabs' type for TabGroups (not 'tab')", () => {
    const state = buildDefaultLayout();
    const serialized = serialize(state);

    // The root is a split, so check its first child (a tabs group)
    const rootSplit = serialized.root as { type: string; children: Array<{ type: string }> };
    expect(rootSplit.type).toBe("split");
    expect(rootSplit.children[0].type).toBe("tabs");
  });

  test("serialize includes presetName when provided", () => {
    const state = buildDefaultLayout();
    const serialized = serialize(state, "my-preset");
    expect(serialized.presetName).toBe("my-preset");
  });

  test("serialize without presetName omits presetName field", () => {
    const state = buildDefaultLayout();
    const serialized = serialize(state);
    expect(serialized.presetName).toBeUndefined();
  });

  test("deserialize handles v3 format correctly", () => {
    const v3: SerializedDockState = {
      version: 3,
      root: {
        type: "tabs",
        activeId: "tab-1",
        tabs: [{ id: "tab-1", componentId: "terminal", title: "Terminal" }],
      },
      floating: [],
    };
    const json = JSON.stringify(v3);
    const result = deserialize(json);

    expect(result.root.type).toBe("tab");
    expect((result.root as TabNode).tabs[0].componentId).toBe("terminal");
  });

  test("deserialize calls validateDockState (normalization applied)", () => {
    // A v3 state with a structurally invalid tree (single-child split)
    // After deserialization, normalizeTree should simplify it
    const v3: SerializedDockState = {
      version: 3,
      root: {
        type: "split",
        orientation: "horizontal",
        children: [
          {
            type: "tabs",
            activeId: "tab-1",
            tabs: [{ id: "tab-1", componentId: "terminal", title: "Terminal" }],
          },
        ],
        weights: [1.0],
      },
      floating: [],
    };
    const json = JSON.stringify(v3);
    const result = deserialize(json);

    // Single-child split should be normalized away
    expect(result.root.type).toBe("tab");
  });

  test("round-trip preserves weights accurately", () => {
    const original = buildDefaultLayout();
    const json = JSON.stringify(serialize(original));
    const restored = deserialize(json);

    const rootSplit = restored.root as SplitNode;
    expect(rootSplit.weights[0]).toBeCloseTo(0.667, 3);
    expect(rootSplit.weights[1]).toBeCloseTo(0.333, 3);

    const rightSplit = rootSplit.children[1] as SplitNode;
    rightSplit.weights.forEach((w) => {
      expect(w).toBeCloseTo(0.25, 5);
    });
  });
});

// ---- validateDockState tests ----

describe("validateDockState", () => {
  test("clamps floating panel with sub-100px width to 100px", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: 100, y: 100 },
      size: { width: 50, height: 200 }, // width too small
      node: floatingNode,
    });

    const validated = validateDockState(state, 1920, 1080);
    expect(validated.floating[0].size.width).toBe(100);
    expect(validated.floating[0].size.height).toBe(200); // unchanged
  });

  test("clamps floating panel with sub-100px height to 100px", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: 100, y: 100 },
      size: { width: 300, height: 40 }, // height too small
      node: floatingNode,
    });

    const validated = validateDockState(state, 1920, 1080);
    expect(validated.floating[0].size.width).toBe(300); // unchanged
    expect(validated.floating[0].size.height).toBe(100);
  });

  test("clamps floating panel position to canvas bounds (right edge)", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: 1500, y: 100 }, // x + 400 = 1900 < 1920, but x + 400 > canvas
      size: { width: 400, height: 200 },
      node: floatingNode,
    });

    // x(1500) + width(400) = 1900 <= canvasWidth(1920), still fits
    const validated = validateDockState(state, 1920, 1080);
    expect(validated.floating[0].position.x).toBe(1500); // no clamping needed

    // Now with x that goes out of bounds
    state.floating[0].position.x = 1600;
    const validated2 = validateDockState(state, 1920, 1080);
    expect(validated2.floating[0].position.x).toBe(1520); // 1920 - 400
  });

  test("clamps floating panel position to canvas bounds (bottom edge)", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: 100, y: 900 },
      size: { width: 400, height: 300 }, // y(900) + height(300) = 1200 > canvasHeight(1080)
      node: floatingNode,
    });

    const validated = validateDockState(state, 1920, 1080);
    expect(validated.floating[0].position.y).toBe(780); // 1080 - 300
  });

  test("clamps floating panel position to minimum 0 when negative", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: -50, y: -100 },
      size: { width: 400, height: 300 },
      node: floatingNode,
    });

    const validated = validateDockState(state, 1920, 1080);
    expect(validated.floating[0].position.x).toBe(0);
    expect(validated.floating[0].position.y).toBe(0);
  });

  test("validateDockState without canvas dimensions skips position clamping", () => {
    const state = buildDefaultLayout();
    const floatingNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    state.floating.push({
      position: { x: -999, y: -999 }, // would be clamped if canvas dims provided
      size: { width: 400, height: 300 },
      node: floatingNode,
    });

    // No canvas dimensions -> position not clamped, but size still clamped
    const validated = validateDockState(state);
    expect(validated.floating[0].position.x).toBe(-999); // unchanged
    expect(validated.floating[0].position.y).toBe(-999); // unchanged
  });

  test("validateDockState runs normalizeTree on root", () => {
    // Create a state with a tree that needs normalization (single-child split)
    const tabNode: TabNode = {
      type: "tab",
      id: crypto.randomUUID(),
      tabs: [makeTab("terminal")],
      activeTabIndex: 0,
    };
    const singleChildSplit: SplitNode = {
      type: "split",
      orientation: "horizontal",
      children: [tabNode],
      weights: [1.0],
    };
    const state = { root: singleChildSplit, floating: [] };

    const validated = validateDockState(state);
    // Single-child split should be normalized away
    expect(validated.root.type).toBe("tab");
  });
});

// ---- migrateV2ToV3 golden tests ----

describe("migrateV2ToV3", () => {
  test("golden: default v2 state produces correct v3 structure (collapsed array ignored)", () => {
    const v2: V2LayoutState = {
      version: 2,
      colSplit: 0.667,
      rowSplits: [0.25, 0.5, 0.75],
      collapsed: ["terminal", "git"], // should be ignored
    };

    const result = migrateV2ToV3(v2);

    // Root should be a horizontal split
    expect(result.root.type).toBe("split");
    const rootSplit = result.root as SplitNode;
    expect(rootSplit.orientation).toBe("horizontal");
    expect(rootSplit.children.length).toBe(2);

    // Left child: TabNode with Conversation
    const leftChild = rootSplit.children[0] as TabNode;
    expect(leftChild.type).toBe("tab");
    expect(leftChild.tabs[0].componentId).toBe("conversation");
    expect(rootSplit.weights[0]).toBeCloseTo(0.667, 3);

    // Right child: vertical split with 4 cards
    const rightChild = rootSplit.children[1] as SplitNode;
    expect(rightChild.type).toBe("split");
    expect(rightChild.orientation).toBe("vertical");
    expect(rightChild.children.length).toBe(4);
    expect((rightChild.children[0] as TabNode).tabs[0].componentId).toBe("terminal");
    expect((rightChild.children[1] as TabNode).tabs[0].componentId).toBe("git");
    expect((rightChild.children[2] as TabNode).tabs[0].componentId).toBe("files");
    expect((rightChild.children[3] as TabNode).tabs[0].componentId).toBe("stats");
    expect(rootSplit.weights[1]).toBeCloseTo(0.333, 3);

    // All cards should be expanded (collapsed array ignored)
    // In v3 there is no collapsed state in the data structure -- all tabs are present
    const allTabs = [
      leftChild,
      rightChild.children[0] as TabNode,
      rightChild.children[1] as TabNode,
      rightChild.children[2] as TabNode,
      rightChild.children[3] as TabNode,
    ];
    allTabs.forEach((tabNode) => {
      expect(tabNode.tabs.length).toBeGreaterThan(0);
    });

    // No floating panels
    expect(result.floating.length).toBe(0);
  });

  test("golden: custom colSplit/rowSplits produces correct weights", () => {
    const v2: V2LayoutState = {
      version: 2,
      colSplit: 0.6,
      rowSplits: [0.3, 0.5, 0.8],
      collapsed: [],
    };

    const result = migrateV2ToV3(v2);
    const rootSplit = result.root as SplitNode;

    // Check horizontal weights
    expect(rootSplit.weights[0]).toBeCloseTo(0.6, 5);
    expect(rootSplit.weights[1]).toBeCloseTo(0.4, 5);

    // Check vertical weights: [0.3, 0.5-0.3, 0.8-0.5, 1-0.8] = [0.3, 0.2, 0.3, 0.2]
    const rightSplit = rootSplit.children[1] as SplitNode;
    expect(rightSplit.weights[0]).toBeCloseTo(0.3, 5); // terminal
    expect(rightSplit.weights[1]).toBeCloseTo(0.2, 5); // git
    expect(rightSplit.weights[2]).toBeCloseTo(0.3, 5); // files
    expect(rightSplit.weights[3]).toBeCloseTo(0.2, 5); // stats

    // All weights sum to 1.0
    const totalRowWeights = rightSplit.weights.reduce((sum, w) => sum + w, 0);
    expect(totalRowWeights).toBeCloseTo(1.0, 5);
  });

  test("golden: collapsed cards in v2 produce all-expanded v3 tree", () => {
    // All cards collapsed in v2 -- they should all appear expanded in v3
    const v2: V2LayoutState = {
      version: 2,
      colSplit: 0.5,
      rowSplits: [0.25, 0.5, 0.75],
      collapsed: ["conversation", "terminal", "git", "files", "stats"],
    };

    const result = migrateV2ToV3(v2);

    // All five cards should be present and not collapsed (v3 has no collapsed state)
    const rootSplit = result.root as SplitNode;
    const conversationNode = rootSplit.children[0] as TabNode;
    const rightSplit = rootSplit.children[1] as SplitNode;

    // Verify all 5 cards are present in the tree
    expect(conversationNode.tabs[0].componentId).toBe("conversation");
    expect((rightSplit.children[0] as TabNode).tabs[0].componentId).toBe("terminal");
    expect((rightSplit.children[1] as TabNode).tabs[0].componentId).toBe("git");
    expect((rightSplit.children[2] as TabNode).tabs[0].componentId).toBe("files");
    expect((rightSplit.children[3] as TabNode).tabs[0].componentId).toBe("stats");

    // In v3, collapsed state is NOT represented in the data model; all cards are present
    // (runtime collapse is a UI-only toggle, not serialized)
  });

  test("migrateV2ToV3 handles missing colSplit with default value", () => {
    const v2 = {
      version: 2 as const,
      rowSplits: [0.25, 0.5, 0.75],
      collapsed: [],
    } as unknown as V2LayoutState; // colSplit missing

    const result = migrateV2ToV3(v2);
    const rootSplit = result.root as SplitNode;
    // Default colSplit is 0.667
    expect(rootSplit.weights[0]).toBeCloseTo(0.667, 3);
    expect(rootSplit.weights[1]).toBeCloseTo(0.333, 3);
  });
});

// ---- buildDefaultLayout tests ----

describe("buildDefaultLayout", () => {
  test("produces the correct five-card default structure", () => {
    const layout = buildDefaultLayout();

    // Root: horizontal split
    expect(layout.root.type).toBe("split");
    const rootSplit = layout.root as SplitNode;
    expect(rootSplit.orientation).toBe("horizontal");
    expect(rootSplit.children.length).toBe(2);

    // Left: Conversation tab node (weight 0.667)
    const leftChild = rootSplit.children[0] as TabNode;
    expect(leftChild.type).toBe("tab");
    expect(leftChild.tabs.length).toBe(1);
    expect(leftChild.tabs[0].componentId).toBe("conversation");
    expect(rootSplit.weights[0]).toBeCloseTo(0.667, 3);

    // Right: vertical split (weight 0.333)
    const rightChild = rootSplit.children[1] as SplitNode;
    expect(rightChild.type).toBe("split");
    expect(rightChild.orientation).toBe("vertical");
    expect(rightChild.children.length).toBe(4);
    expect(rootSplit.weights[1]).toBeCloseTo(0.333, 3);

    // Right children: Terminal, Git, Files, Stats each with weight 0.25
    const expectedComponents = ["terminal", "git", "files", "stats"];
    rightChild.children.forEach((child, i) => {
      expect(child.type).toBe("tab");
      expect((child as TabNode).tabs[0].componentId).toBe(expectedComponents[i]);
      expect(rightChild.weights[i]).toBeCloseTo(0.25, 5);
    });

    // No floating panels
    expect(layout.floating.length).toBe(0);
  });

  test("buildDefaultLayout produces unique node IDs", () => {
    const layout = buildDefaultLayout();
    const rootSplit = layout.root as SplitNode;
    const leftId = (rootSplit.children[0] as TabNode).id;
    const rightSplit = rootSplit.children[1] as SplitNode;
    const rightIds = rightSplit.children.map((c) => (c as TabNode).id);

    const allIds = [leftId, ...rightIds];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length); // all unique
  });

  test("buildDefaultLayout uses valid activeTabIndex", () => {
    const layout = buildDefaultLayout();
    const rootSplit = layout.root as SplitNode;
    const allTabNodes: TabNode[] = [
      rootSplit.children[0] as TabNode,
      ...((rootSplit.children[1] as SplitNode).children as TabNode[]),
    ];

    allTabNodes.forEach((node) => {
      expect(node.activeTabIndex).toBeGreaterThanOrEqual(0);
      expect(node.activeTabIndex).toBeLessThan(node.tabs.length);
    });
  });
});
