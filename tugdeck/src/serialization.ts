/**
 * Serialization, deserialization, and default layout for DeckState.
 *
 * Spec S02: v5 serialization format (flat card array)
 * Spec S03: Default layout geometry (five cards, 12px gaps)
 */

import { type DeckState, type CardState, type TabItem } from "./layout-tree";
import { CARD_TITLES } from "./card-titles";

// ---- Serialize ----

/**
 * Serialize a DeckState to the v5 format for localStorage storage.
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
 * @param json - JSON string from localStorage
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

      cards.push({
        id,
        position: { x, y },
        size: { width, height },
        tabs,
        activeTabId,
      });
    }

    return { cards };
  } catch {
    return buildDefaultLayout(canvasWidth, canvasHeight);
  }
}

// ---- Default Layout (Spec S03) ----

const GAP = 12;
const LEFT_FRACTION = 0.6;

/**
 * Helper to construct a CardState with a single tab.
 */
function makeCardState(
  componentId: string,
  title: string,
  x: number,
  y: number,
  width: number,
  height: number
): CardState {
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
 * Build the default five-card canvas layout.
 *
 * Layout (Spec S03):
 *   Code card: left column, 60% width
 *   Terminal / Git / Files / Stats: right column, equal height, 12px gaps
 *
 * All cards use 12px margins from canvas edges and 12px gaps between cards.
 */
export function buildDefaultLayout(
  canvasWidth: number,
  canvasHeight: number
): DeckState {
  const codeWidth = (canvasWidth - 3 * GAP) * LEFT_FRACTION;
  const codeHeight = canvasHeight - 2 * GAP;

  const rightX = GAP + codeWidth + GAP;
  const rightWidth = canvasWidth - rightX - GAP;
  const cardHeight = (canvasHeight - 2 * GAP - 3 * GAP) / 4;

  const code = makeCardState(
    "code",
    CARD_TITLES.code,
    GAP,
    GAP,
    codeWidth,
    codeHeight
  );

  const rightCards = (
    ["terminal", "git", "files", "stats"] as const
  ).map((componentId, i) => {
    return makeCardState(
      componentId,
      CARD_TITLES[componentId],
      rightX,
      GAP + i * (cardHeight + GAP),
      rightWidth,
      cardHeight
    );
  });

  return {
    cards: [code, ...rightCards],
  };
}
