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
    sets: deckState.sets,
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

    // Deserialize explicit sets (backward compatible: missing = empty array).
    const rawSets = raw["sets"];
    let sets: string[][] = [];
    if (Array.isArray(rawSets)) {
      const validCardIds = new Set(cards.map((c) => c.id));
      for (const s of rawSets) {
        if (!Array.isArray(s)) continue;
        // Filter to only card IDs that exist in the deserialized cards.
        const filtered = (s as string[]).filter((id) => validCardIds.has(id));
        if (filtered.length >= 2) {
          sets.push(filtered);
        }
      }
      // Enforce single-set invariant: if a card appears in multiple sets
      // (e.g. from a corrupted or hand-edited layout blob), merge those sets.
      sets = mergeOverlappingSets(sets);
    }

    return { cards, sets };
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
  return { cards: [], sets: [] };
}

// ---- Helpers ----

/**
 * Merge sets that share any card ID so each card appears in at most one set.
 * Uses union-find: if card X appears in sets A and B, those sets are merged.
 * Returns only merged sets with 2+ members.
 */
function mergeOverlappingSets(sets: string[][]): string[][] {
  // Map each card ID to the index of its first-seen set.
  const parent = new Map<string, number>();
  const setCount = sets.length;

  // Union-find over set indices.
  const setParent: number[] = [];
  for (let i = 0; i < setCount; i++) setParent.push(i);

  function find(x: number): number {
    while (setParent[x] !== x) {
      setParent[x] = setParent[setParent[x]];
      x = setParent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) setParent[ra] = rb;
  }

  for (let i = 0; i < setCount; i++) {
    for (const id of sets[i]) {
      const prev = parent.get(id);
      if (prev !== undefined) {
        union(prev, i);
      } else {
        parent.set(id, i);
      }
    }
  }

  // Group set indices by root.
  const groups = new Map<number, Set<string>>();
  for (let i = 0; i < setCount; i++) {
    const root = find(i);
    let group = groups.get(root);
    if (!group) {
      group = new Set();
      groups.set(root, group);
    }
    for (const id of sets[i]) group.add(id);
  }

  const result: string[][] = [];
  for (const group of groups.values()) {
    if (group.size >= 2) result.push(Array.from(group));
  }
  return result;
}
