/**
 * Serialization, deserialization, and default layout for DeckState.
 *
 * Spec S02: v5 serialization format (flat card array)
 * Spec S03: Default layout geometry (five cards, 12px gaps)
 */

import { type DeckState, type CardState, type TabItem } from "./layout-tree";

// ---- Serialize ----

/**
 * Serialize a DeckState to the v5 format for settings API persistence.
 *
 * Returns a plain object. Caller should JSON.stringify before writing.
 */
export function serialize(deckState: DeckState): object {
  return {
    version: 5,
    cards: deckState.cards,
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a DeckState.
 *
 * Only accepts v5 format. Non-v5 data (including v2, v3, v4) is discarded and
 * falls back to buildDefaultLayout (per D02: no migration from V4).
 *
 * Enforces 100px minimum sizes and clamps card positions to canvas bounds.
 *
 * @param json - JSON string from the settings API
 * @param canvasWidth - Canvas width for position clamping
 * @param canvasHeight - Canvas height for position clamping
 */
export function deserialize(
  json: string,
  canvasWidth: number,
  canvasHeight: number
): DeckState {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;

    if (raw["version"] !== 5) {
      return buildDefaultLayout(canvasWidth, canvasHeight);
    }

    const rawCards = raw["cards"];
    if (!Array.isArray(rawCards)) {
      return buildDefaultLayout(canvasWidth, canvasHeight);
    }

    const cards: CardState[] = [];
    for (const c of rawCards) {
      if (!c || typeof c !== "object") continue;

      const card = c as Record<string, unknown>;
      const id = card["id"] as string;
      const pos = card["position"] as { x: number; y: number } | undefined;
      const sz = card["size"] as { width: number; height: number } | undefined;
      const tabs = card["tabs"] as TabItem[] | undefined;
      let activeTabId = card["activeTabId"] as string | undefined;

      if (!id || !pos || !sz || !Array.isArray(tabs) || tabs.length === 0) {
        continue;
      }

      // Enforce 100px minimum sizes
      const width = Math.max(100, sz.width);
      const height = Math.max(100, sz.height);

      // Finder-style position clamping: title bar must stay reachable.
      // At least TITLE_BAR_VISIBLE_MIN_X (100px) horizontally visible,
      // title bar top at or below y = 0, at least TITLE_BAR_HEIGHT (36px) visible vertically.
      const TITLE_BAR_VISIBLE_MIN_X = 100;
      const TITLE_BAR_HEIGHT = 36;
      let x = pos.x;
      let y = pos.y;
      x = Math.max(-(width - TITLE_BAR_VISIBLE_MIN_X),
                   Math.min(x, canvasWidth - TITLE_BAR_VISIBLE_MIN_X));
      y = Math.max(0, Math.min(y, canvasHeight - TITLE_BAR_HEIGHT));

      // Validate activeTabId references an existing tab
      if (!activeTabId || !tabs.find((t) => t.id === activeTabId)) {
        activeTabId = tabs[0].id;
      }

      // Extract title with defensive default.
      const rawTitle = card["title"];
      const title = typeof rawTitle === "string" ? rawTitle : "";

      // Extract acceptsFamilies with defensive default.
      const rawAcceptsFamilies = card["acceptsFamilies"];
      const acceptsFamilies: readonly string[] = Array.isArray(rawAcceptsFamilies)
        ? (rawAcceptsFamilies as string[])
        : ["standard"];

      // Extract collapsed with defensive default: only carry the field when explicitly true.
      const rawCollapsed = card["collapsed"];
      const collapsed = typeof rawCollapsed === "boolean" ? rawCollapsed : undefined;

      cards.push({
        id,
        position: { x, y },
        size: { width, height },
        tabs,
        activeTabId,
        title,
        acceptsFamilies,
        ...(collapsed === true ? { collapsed } : {}),
      });
    }

    return { cards };
  } catch {
    return buildDefaultLayout(canvasWidth, canvasHeight);
  }
}

// ---- Default Layout ----

/**
 * Build the default canvas layout.
 *
 * Phase 5: returns an empty DeckState. The pre-Phase-5 five-card default
 * layout used component IDs ("code", "terminal", "git", "files", "stats")
 * that are not registered in Phase 5. An empty canvas is the correct default
 * until Phase 9 registers real cards.
 *
 * The `canvasWidth` and `canvasHeight` parameters are retained for API
 * compatibility with call sites that pass canvas dimensions.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildDefaultLayout(
  _canvasWidth: number,
  _canvasHeight: number
): DeckState {
  return { cards: [] };
}
