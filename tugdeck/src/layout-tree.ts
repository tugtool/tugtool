/**
 * Layout tree data structure for the panel system.
 *
 * Internal nodes are SplitNodes; leaf nodes are TabNodes.
 * All mutations must run normalizeTree() to enforce topology invariants.
 *
 * Spec S01: Layout Tree Types
 * List L01: Layout Tree Invariants
 */

// ---- Types (Spec S01) ----

export type Orientation = "horizontal" | "vertical";
export type LayoutNode = SplitNode | TabNode;

export interface SplitNode {
  type: "split";
  orientation: Orientation;
  children: LayoutNode[];
  /** Proportional sizes, same length as children, sum to 1.0. */
  weights: number[];
}

export interface TabNode {
  type: "tab";
  id: string; // crypto.randomUUID()
  tabs: TabItem[];
  activeTabIndex: number;
}

export interface TabItem {
  id: string; // unique card instance ID
  componentId: string; // "terminal" | "git" | "files" | "stats" | "conversation"
  title: string;
  closable: boolean;
}

export interface DockState {
  root: LayoutNode;
  floating: FloatingGroup[];
}

export interface FloatingGroup {
  position: { x: number; y: number };
  size: { width: number; height: number };
  node: TabNode;
}

/**
 * Drop zones for insertNode.
 * - "tab-bar": append as a new tab in the target TabNode
 * - "widget-*": split the target TabNode, placing new tab on the specified side
 * - "root-*": wrap the entire root in a new split, placing new tab on the specified side
 * - "center": replace tabs in target TabNode (used when target has only one tab)
 */
export type DockZone =
  | "tab-bar"
  | "widget-top"
  | "widget-bottom"
  | "widget-left"
  | "widget-right"
  | "root-top"
  | "root-bottom"
  | "root-left"
  | "root-right"
  | "center";

// ---- Topology Normalization (L01.1-6) ----

/**
 * Normalize the layout tree, enforcing structural invariants L01.1-6.
 *
 * This function is geometry-agnostic. It operates on tree structure and weight
 * proportions only. It does NOT take pixel dimensions as input and does NOT
 * enforce pixel minimums (L01.7 geometric layer is handled by PanelManager).
 *
 * Invariants enforced:
 *   L01.1 No same-grain nesting (flatten same-orientation nested splits)
 *   L01.2 No single-child splits (replace with the single child)
 *   L01.3 Leaves are always tab nodes
 *   L01.4 Root can be either type
 *   L01.5 Weights sum to 1.0
 *   L01.6 No empty tab nodes in the docked tree
 */
export function normalizeTree(node: LayoutNode): LayoutNode | null {
  if (node.type === "tab") {
    // L01.6: remove empty tab nodes
    if (node.tabs.length === 0) {
      return null;
    }
    // Clamp activeTabIndex to valid range
    const clampedIndex = Math.max(
      0,
      Math.min(node.activeTabIndex, node.tabs.length - 1)
    );
    if (clampedIndex !== node.activeTabIndex) {
      return { ...node, activeTabIndex: clampedIndex };
    }
    return node;
  }

  // node.type === "split"
  // First, recursively normalize children
  const normalizedChildren: LayoutNode[] = [];
  const normalizedWeights: number[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const weight = node.weights[i] ?? 1 / node.children.length;
    const normalized = normalizeTree(child);

    if (normalized === null) {
      // L01.6: child was an empty tab node, skip it
      continue;
    }

    // L01.1: flatten same-grain nested splits
    if (
      normalized.type === "split" &&
      normalized.orientation === node.orientation
    ) {
      // Promote grandchildren into this split, multiplying weights
      for (let j = 0; j < normalized.children.length; j++) {
        normalizedChildren.push(normalized.children[j]);
        normalizedWeights.push(
          weight * (normalized.weights[j] ?? 1 / normalized.children.length)
        );
      }
    } else {
      normalizedChildren.push(normalized);
      normalizedWeights.push(weight);
    }
  }

  // L01.6: if no children remain, the split itself should be removed
  if (normalizedChildren.length === 0) {
    return null;
  }

  // L01.2: single-child split is replaced by that child
  if (normalizedChildren.length === 1) {
    return normalizedChildren[0];
  }

  // L01.5: renormalize weights to sum to 1.0
  const total = normalizedWeights.reduce((sum, w) => sum + w, 0);
  const renormalized =
    total > 0 ? normalizedWeights.map((w) => w / total) : normalizedWeights.map(() => 1 / normalizedWeights.length);

  return {
    type: "split",
    orientation: node.orientation,
    children: normalizedChildren,
    weights: renormalized,
  };
}

// ---- Tree Mutation Functions ----

/**
 * Find a TabNode in the tree by its id.
 * Returns null if not found.
 */
export function findTabNode(root: LayoutNode, tabNodeId: string): TabNode | null {
  if (root.type === "tab") {
    return root.id === tabNodeId ? root : null;
  }
  for (const child of root.children) {
    const found = findTabNode(child, tabNodeId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Insert a new tab item at the given dock zone relative to the target TabNode.
 *
 * @param root - Current root layout node
 * @param targetTabNodeId - ID of the TabNode to dock relative to (null for root-* zones)
 * @param zone - The dock zone
 * @param newTab - The new tab item to insert
 * @returns New root after insertion and normalization
 */
export function insertNode(
  root: LayoutNode,
  targetTabNodeId: string | null,
  zone: DockZone,
  newTab: TabItem
): LayoutNode {
  const newTabNode: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [newTab],
    activeTabIndex: 0,
  };

  let mutated: LayoutNode;

  switch (zone) {
    case "root-left":
      mutated = {
        type: "split",
        orientation: "horizontal",
        children: [newTabNode, root],
        weights: [0.5, 0.5],
      };
      break;
    case "root-right":
      mutated = {
        type: "split",
        orientation: "horizontal",
        children: [root, newTabNode],
        weights: [0.5, 0.5],
      };
      break;
    case "root-top":
      mutated = {
        type: "split",
        orientation: "vertical",
        children: [newTabNode, root],
        weights: [0.5, 0.5],
      };
      break;
    case "root-bottom":
      mutated = {
        type: "split",
        orientation: "vertical",
        children: [root, newTabNode],
        weights: [0.5, 0.5],
      };
      break;
    default:
      if (targetTabNodeId === null) {
        mutated = root;
      } else {
        mutated = insertIntoNode(root, targetTabNodeId, zone, newTab, newTabNode);
      }
      break;
  }

  const normalized = normalizeTree(mutated);
  // After insertion there will always be at least one node, so normalized cannot be null
  return normalized ?? mutated;
}

/**
 * Recursively find the target TabNode in the tree and perform the insertion.
 */
function insertIntoNode(
  node: LayoutNode,
  targetId: string,
  zone: DockZone,
  newTab: TabItem,
  newTabNode: TabNode
): LayoutNode {
  if (node.type === "tab") {
    if (node.id !== targetId) {
      return node;
    }
    // Found the target TabNode
    switch (zone) {
      case "tab-bar": {
        // Append new tab to existing TabNode
        return {
          ...node,
          tabs: [...node.tabs, newTab],
          activeTabIndex: node.tabs.length, // activate the new tab
        };
      }
      case "center": {
        // Replace tabs in target (target has only one tab per spec)
        return {
          ...node,
          tabs: [newTab],
          activeTabIndex: 0,
        };
      }
      case "widget-left":
        return {
          type: "split",
          orientation: "horizontal",
          children: [newTabNode, node],
          weights: [0.5, 0.5],
        };
      case "widget-right":
        return {
          type: "split",
          orientation: "horizontal",
          children: [node, newTabNode],
          weights: [0.5, 0.5],
        };
      case "widget-top":
        return {
          type: "split",
          orientation: "vertical",
          children: [newTabNode, node],
          weights: [0.5, 0.5],
        };
      case "widget-bottom":
        return {
          type: "split",
          orientation: "vertical",
          children: [node, newTabNode],
          weights: [0.5, 0.5],
        };
      default:
        return node;
    }
  }

  // SplitNode: recurse into children
  const newChildren = node.children.map((child) =>
    insertIntoNode(child, targetId, zone, newTab, newTabNode)
  );
  return { ...node, children: newChildren };
}

/**
 * Remove a tab by its item id from the tree.
 * After removal, runs normalizeTree() to enforce topology invariants.
 *
 * @param root - Current root layout node
 * @param tabId - ID of the TabItem to remove
 * @returns New root after removal and normalization, or null if tree becomes empty
 */
export function removeTab(
  root: LayoutNode,
  tabId: string
): LayoutNode | null {
  const mutated = removeTabFromNode(root, tabId);
  if (mutated === null) {
    return null;
  }
  return normalizeTree(mutated);
}

/**
 * Recursively remove a tab from the tree without normalization.
 */
function removeTabFromNode(
  node: LayoutNode,
  tabId: string
): LayoutNode | null {
  if (node.type === "tab") {
    const idx = node.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) {
      return node; // not found here
    }
    const newTabs = node.tabs.filter((t) => t.id !== tabId);
    if (newTabs.length === 0) {
      return null; // L01.6: empty tab node removed
    }
    // Clamp activeTabIndex
    const newActiveIndex = Math.min(node.activeTabIndex, newTabs.length - 1);
    // If the removed tab was before the active tab, shift the active index down
    const adjustedIndex =
      idx < node.activeTabIndex
        ? Math.max(0, node.activeTabIndex - 1)
        : newActiveIndex;
    return {
      ...node,
      tabs: newTabs,
      activeTabIndex: adjustedIndex,
    };
  }

  // SplitNode: recurse into children, filtering out nulls
  const newChildren: LayoutNode[] = [];
  const newWeights: number[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const result = removeTabFromNode(node.children[i], tabId);
    if (result !== null) {
      newChildren.push(result);
      newWeights.push(node.weights[i] ?? 1 / node.children.length);
    }
  }

  if (newChildren.length === 0) {
    return null;
  }

  return {
    ...node,
    children: newChildren,
    weights: newWeights,
  };
}
