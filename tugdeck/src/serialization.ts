/**
 * Serialization, deserialization, validation, and migration for DockState.
 *
 * Spec S02: Serialization Types
 * Spec S06: V2-to-V3 Migration Algorithm
 * Spec S07: Post-Deserialization Validation
 */

import {
  type DockState,
  type LayoutNode,
  type TabNode,
  type TabItem,
  type FloatingGroup,
  normalizeTree,
} from "./layout-tree";

// ---- Serialization Types (Spec S02) ----

export interface SerializedDockState {
  version: 3;
  root: SerializedNode;
  floating: SerializedFloatingGroup[];
  presetName?: string;
}

export type SerializedNode = SerializedSplit | SerializedTabGroup;

export interface SerializedSplit {
  type: "split";
  orientation: "horizontal" | "vertical";
  children: SerializedNode[];
  weights: number[];
}

export interface SerializedTabGroup {
  type: "tabs";
  activeId: string;
  tabs: SerializedTab[];
}

export interface SerializedTab {
  id: string;
  componentId: string;
  title: string;
}

export interface SerializedFloatingGroup {
  position: { x: number; y: number };
  size: { width: number; height: number };
  group: SerializedTabGroup;
}

// ---- V2 Layout Type (for migration) ----

/** Legacy v2 localStorage layout format. */
export interface V2LayoutState {
  version: 2;
  colSplit: number;
  rowSplits: number[];
  collapsed: string[];
}

// ---- Serialize ----

/**
 * Serialize a DockState to the v3 format for storage.
 */
export function serialize(
  dockState: DockState,
  presetName?: string
): SerializedDockState {
  return {
    version: 3,
    root: serializeNode(dockState.root),
    floating: dockState.floating.map(serializeFloatingGroup),
    ...(presetName !== undefined ? { presetName } : {}),
  };
}

function serializeNode(node: LayoutNode): SerializedNode {
  if (node.type === "split") {
    return {
      type: "split",
      orientation: node.orientation,
      children: node.children.map(serializeNode),
      weights: node.weights,
    };
  }
  // TabNode -> SerializedTabGroup (note: type is "tabs" not "tab")
  return serializeTabNode(node);
}

function serializeTabNode(node: TabNode): SerializedTabGroup {
  const activeTab = node.tabs[node.activeTabIndex] ?? node.tabs[0];
  return {
    type: "tabs",
    activeId: activeTab?.id ?? "",
    tabs: node.tabs.map((tab) => ({
      id: tab.id,
      componentId: tab.componentId,
      title: tab.title,
      // closable is a runtime-only property, not persisted
    })),
  };
}

function serializeFloatingGroup(fg: FloatingGroup): SerializedFloatingGroup {
  return {
    position: { ...fg.position },
    size: { ...fg.size },
    group: serializeTabNode(fg.node),
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a DockState.
 *
 * Automatically detects v2 vs v3 format.
 * v2 layouts are migrated via migrateV2ToV3().
 * After parsing, validateDockState() is called for Spec S07 validation.
 *
 * @param json - JSON string from localStorage
 * @param canvasWidth - Optional canvas width for floating panel position clamping
 * @param canvasHeight - Optional canvas height for floating panel position clamping
 */
export function deserialize(
  json: string,
  canvasWidth?: number,
  canvasHeight?: number
): DockState {
  const raw = JSON.parse(json) as Record<string, unknown>;

  let dockState: DockState;

  if (raw["version"] === 2) {
    dockState = migrateV2ToV3(raw as unknown as V2LayoutState);
  } else if (raw["version"] === 3) {
    dockState = deserializeV3(raw as unknown as SerializedDockState);
  } else {
    // Fallback: return default layout
    dockState = buildDefaultLayout();
  }

  return validateDockState(dockState, canvasWidth, canvasHeight);
}

function deserializeV3(serialized: SerializedDockState): DockState {
  return {
    root: deserializeNode(serialized.root),
    floating: (serialized.floating ?? []).map(deserializeFloatingGroup),
  };
}

function deserializeNode(node: SerializedNode): LayoutNode {
  if (node.type === "split") {
    return {
      type: "split",
      orientation: node.orientation,
      children: node.children.map(deserializeNode),
      weights: node.weights,
    };
  }
  // SerializedTabGroup -> TabNode
  return deserializeTabGroup(node);
}

function deserializeTabGroup(group: SerializedTabGroup): TabNode {
  const tabs: TabItem[] = group.tabs.map((t) => ({
    id: t.id,
    componentId: t.componentId,
    title: t.title,
    closable: true, // default: closable (runtime property, not stored)
  }));
  const activeTabIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === group.activeId)
  );
  return {
    type: "tab",
    id: crypto.randomUUID(),
    tabs,
    activeTabIndex,
  };
}

function deserializeFloatingGroup(fg: SerializedFloatingGroup): FloatingGroup {
  return {
    position: { ...fg.position },
    size: { ...fg.size },
    node: deserializeTabGroup(fg.group),
  };
}

// ---- Validation (Spec S07) ----

/**
 * Post-deserialization validation following Spec S07.
 *
 * Steps:
 * 1. Clamp floating panel sizes to 100px minimum (L01.7, floating panel layer)
 * 2. Clamp floating panel positions to canvas bounds (prevents off-screen panels)
 * 3. Run normalizeTree() on root (L01.1-6 structural invariants)
 *
 * canvasWidth/canvasHeight are optional; if omitted, position clamping is skipped.
 */
export function validateDockState(
  dockState: DockState,
  canvasWidth?: number,
  canvasHeight?: number
): DockState {
  const floating = dockState.floating.map((fg) => {
    let { position, size, node } = fg;

    // Step 1: clamp size to 100px minimum
    size = {
      width: Math.max(100, size.width),
      height: Math.max(100, size.height),
    };

    // Step 2: clamp position to canvas bounds
    if (canvasWidth !== undefined && canvasHeight !== undefined) {
      let x = position.x;
      let y = position.y;

      // Ensure panel does not extend beyond the right/bottom edge
      if (x + size.width > canvasWidth) {
        x = canvasWidth - size.width;
      }
      if (y + size.height > canvasHeight) {
        y = canvasHeight - size.height;
      }
      // Ensure panel is not off the left/top edge
      if (x < 0) x = 0;
      if (y < 0) y = 0;

      position = { x, y };
    }

    return { position, size, node };
  });

  // Step 3: run structural normalization on root
  const normalized = normalizeTree(dockState.root);
  const root = normalized ?? dockState.root;

  return { root, floating };
}

// ---- V2 to V3 Migration (Spec S06) ----

/**
 * Migrate a v2 layout to v3 DockState.
 *
 * V2 format: { version: 2, colSplit, rowSplits, collapsed }
 * The v2 `collapsed` array is read but ignored; all cards start expanded in v3.
 *
 * Tree produced:
 *   Root: SplitNode(horizontal)
 *     Left: TabNode [Conversation], weight = colSplit
 *     Right: SplitNode(vertical), weight = 1 - colSplit
 *       [Terminal, Git, Files, Stats], weights from rowSplits deltas
 */
export function migrateV2ToV3(v2State: V2LayoutState): DockState {
  const colSplit = v2State.colSplit ?? 0.667;
  const rowSplits = v2State.rowSplits ?? [0.25, 0.5, 0.75];
  // v2State.collapsed is read but intentionally ignored

  // Compute right-side row weights from rowSplits cumulative positions
  const r0 = rowSplits[0] ?? 0.25;
  const r1 = rowSplits[1] ?? 0.5;
  const r2 = rowSplits[2] ?? 0.75;
  const rowWeights = [r0, r1 - r0, r2 - r1, 1 - r2];

  const conversationTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "conversation",
        title: "Conversation",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const terminalTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "terminal",
        title: "Terminal",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const gitTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "git",
        title: "Git",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const filesTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "files",
        title: "Files",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const statsTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "stats",
        title: "Stats",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const rightSplit = {
    type: "split" as const,
    orientation: "vertical" as const,
    children: [terminalTab, gitTab, filesTab, statsTab],
    weights: rowWeights,
  };

  const root = {
    type: "split" as const,
    orientation: "horizontal" as const,
    children: [conversationTab, rightSplit],
    weights: [colSplit, 1 - colSplit],
  };

  return { root, floating: [] };
}

// ---- Preset Storage (named layout presets in localStorage) ----

/** localStorage key for named layout presets */
export const PRESETS_STORAGE_KEY = "tugdeck-layouts";

/**
 * Save the current dockState as a named preset in localStorage.
 *
 * Presets use the same v3 SerializedDockState format.
 * If a preset with the given name already exists, it is overwritten.
 */
export function savePreset(name: string, dockState: DockState): void {
  const serialized = serialize(dockState, name);
  let presets: Record<string, SerializedDockState> = {};
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (raw) {
      presets = JSON.parse(raw) as Record<string, SerializedDockState>;
    }
  } catch {
    // Reset on parse error
    presets = {};
  }
  presets[name] = serialized;
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

/**
 * Load a named preset from localStorage.
 *
 * Returns null if the preset is not found.
 * Deserializes via the v3 path and runs validateDockState.
 */
export function loadPreset(
  name: string,
  canvasWidth?: number,
  canvasHeight?: number
): DockState | null {
  let presets: Record<string, SerializedDockState> = {};
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (raw) {
      presets = JSON.parse(raw) as Record<string, SerializedDockState>;
    }
  } catch {
    return null;
  }
  const entry = presets[name];
  if (!entry) return null;

  // Deserialize and validate
  const dockState = deserializeV3(entry);
  return validateDockState(dockState, canvasWidth, canvasHeight);
}

/**
 * Return sorted list of saved preset names.
 */
export function listPresets(): string[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const presets = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(presets).sort();
  } catch {
    return [];
  }
}

/**
 * Delete a named preset from localStorage.
 */
export function deletePreset(name: string): void {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return;
    const presets = JSON.parse(raw) as Record<string, SerializedDockState>;
    delete presets[name];
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore errors
  }
}

// ---- Default Layout (Spec 8.0.1.5) ----

/**
 * Build the default five-card layout when no saved state exists.
 *
 * Root: SplitNode(horizontal)
 *   Left: TabNode [Conversation]          weight: 0.667
 *   Right: SplitNode(vertical)            weight: 0.333
 *     [Terminal, Git, Files, Stats]       weight: 0.25 each
 */
export function buildDefaultLayout(): DockState {
  const conversationTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "conversation",
        title: "Conversation",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const terminalTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "terminal",
        title: "Terminal",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const gitTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "git",
        title: "Git",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const filesTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "files",
        title: "Files",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const statsTab: TabNode = {
    type: "tab",
    id: crypto.randomUUID(),
    tabs: [
      {
        id: crypto.randomUUID(),
        componentId: "stats",
        title: "Stats",
        closable: true,
      },
    ],
    activeTabIndex: 0,
  };

  const rightSplit = {
    type: "split" as const,
    orientation: "vertical" as const,
    children: [terminalTab, gitTab, filesTab, statsTab],
    weights: [0.25, 0.25, 0.25, 0.25],
  };

  const root = {
    type: "split" as const,
    orientation: "horizontal" as const,
    children: [conversationTab, rightSplit],
    weights: [0.667, 0.333],
  };

  return { root, floating: [] };
}
