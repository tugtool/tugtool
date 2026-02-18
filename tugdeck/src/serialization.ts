/**
 * Serialization, deserialization, and default layout for CanvasState.
 *
 * Spec S02: v4 serialization format (flat panel array)
 * Spec S03: Default layout geometry (five panels, 12px gaps)
 */

import { type CanvasState, type PanelState, type TabItem } from "./layout-tree";

// ---- Serialize ----

/**
 * Serialize a CanvasState to the v4 format for localStorage storage.
 *
 * Returns a plain object. Caller should JSON.stringify before writing.
 */
export function serialize(canvasState: CanvasState): object {
  return {
    version: 4,
    panels: canvasState.panels,
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a CanvasState.
 *
 * Only accepts v4 format. Non-v4 data (including v2, v3) is discarded and
 * falls back to buildDefaultLayout (per D02: no migration from V3).
 *
 * Enforces 100px minimum sizes and clamps panel positions to canvas bounds.
 *
 * @param json - JSON string from localStorage
 * @param canvasWidth - Canvas width for position clamping
 * @param canvasHeight - Canvas height for position clamping
 */
export function deserialize(
  json: string,
  canvasWidth: number,
  canvasHeight: number
): CanvasState {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;

    if (raw["version"] !== 4) {
      return buildDefaultLayout(canvasWidth, canvasHeight);
    }

    const rawPanels = raw["panels"];
    if (!Array.isArray(rawPanels)) {
      return buildDefaultLayout(canvasWidth, canvasHeight);
    }

    const panels: PanelState[] = [];
    for (const p of rawPanels) {
      if (!p || typeof p !== "object") continue;

      const panel = p as Record<string, unknown>;
      const id = panel["id"] as string;
      const pos = panel["position"] as { x: number; y: number } | undefined;
      const sz = panel["size"] as { width: number; height: number } | undefined;
      const tabs = panel["tabs"] as TabItem[] | undefined;
      let activeTabId = panel["activeTabId"] as string | undefined;

      if (!id || !pos || !sz || !Array.isArray(tabs) || tabs.length === 0) {
        continue;
      }

      // Enforce 100px minimum sizes
      const width = Math.max(100, sz.width);
      const height = Math.max(100, sz.height);

      // Clamp position to canvas bounds
      let x = pos.x;
      let y = pos.y;
      if (x + width > canvasWidth) x = canvasWidth - width;
      if (y + height > canvasHeight) y = canvasHeight - height;
      if (x < 0) x = 0;
      if (y < 0) y = 0;

      // Validate activeTabId references an existing tab
      if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
        activeTabId = tabs[0].id;
      }

      panels.push({
        id,
        position: { x, y },
        size: { width, height },
        tabs,
        activeTabId,
      });
    }

    return { panels };
  } catch {
    return buildDefaultLayout(canvasWidth, canvasHeight);
  }
}

// ---- Default Layout (Spec S03) ----

const GAP = 12;
const LEFT_FRACTION = 0.6;

/**
 * Helper to construct a PanelState with a single tab.
 */
function makePanelState(
  componentId: string,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number
): PanelState {
  const tabId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    position: { x, y },
    size: { width, height },
    tabs: [{ id: tabId, componentId, title, closable: true }],
    activeTabId: tabId,
  };
}

/**
 * Build the default five-panel canvas layout.
 *
 * Layout (Spec S03):
 *   Conversation panel: left column, 60% width
 *   Terminal / Git / Files / Stats: right column, equal height, 12px gaps
 *
 * All panels use 12px margins from canvas edges and 12px gaps between panels.
 */
export function buildDefaultLayout(
  canvasWidth: number,
  canvasHeight: number
): CanvasState {
  const conversationWidth = (canvasWidth - 3 * GAP) * LEFT_FRACTION;
  const conversationHeight = canvasHeight - 2 * GAP;

  const rightX = GAP + conversationWidth + GAP;
  const rightWidth = canvasWidth - rightX - GAP;
  const panelHeight = (canvasHeight - 2 * GAP - 3 * GAP) / 4;

  const conversation = makePanelState(
    "conversation",
    "Conversation",
    GAP,
    GAP,
    conversationWidth,
    conversationHeight
  );

  const rightPanels = (
    ["terminal", "git", "files", "stats"] as const
  ).map((componentId, i) => {
    const titles: Record<string, string> = {
      terminal: "Terminal",
      git: "Git",
      files: "Files",
      stats: "Stats",
    };
    return makePanelState(
      componentId,
      titles[componentId],
      rightX,
      GAP + i * (panelHeight + GAP),
      rightWidth,
      panelHeight
    );
  });

  return {
    panels: [conversation, ...rightPanels],
  };
}
