/**
 * Serialization, deserialization, and default layout for DeckState.
 *
 * Emits `version: 2` blobs with the two-table shape
 * `{ version: 2, cards, stacks, activeStackId? }`. `focusedCardId` is
 * persisted separately via `putFocusedCardId` and is not part of the
 * layout blob.
 *
 * On load, blobs without `version` or with `version !== 2` (including legacy
 * `version: 5`, which used the single-table "one card per frame" shape) are
 * migrated in place to the two-table model. Legacy card ids become stack ids,
 * legacy tab ids become card ids — identity is preserved so tugbank's
 * `tabstate/{id}` rows remain addressable.
 */

import {
  type DeckState,
  type CardState,
  type CardStackState,
} from "./layout-tree";

// ---- Constants ----

const TITLE_BAR_VISIBLE_MIN_X = 100;
const TITLE_BAR_HEIGHT = 36;

// ---- Serialize ----

/**
 * Serialize a DeckState to the v2 format for settings API persistence.
 *
 * Returns a plain object. Caller should JSON.stringify before writing.
 *
 * `focusedCardId` is intentionally NOT included in the layout blob. It is
 * persisted separately via `putFocusedCardId` (single source of truth) and
 * read back on mount through `initialFocusedCardId`. Keeping two paths for
 * one field invites divergence.
 */
export function serialize(deckState: DeckState): object {
  return {
    version: 2,
    cards: deckState.cards,
    stacks: deckState.stacks,
    ...(deckState.activeStackId !== undefined
      ? { activeStackId: deckState.activeStackId }
      : {}),
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a DeckState.
 *
 * Accepts the current `version: 2` two-table shape or migrates a legacy
 * single-table blob (historically `version: 5`, or any blob missing a
 * `version` field that still contains a `cards[].tabs[]` shape) to the
 * two-table model. Any blob the parser cannot make sense of falls back to
 * `buildDefaultLayout`.
 *
 * Enforces 100px minimum sizes and clamps stack positions to canvas bounds.
 */
export function deserialize(
  json: string,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;

    if (raw["version"] === 2) {
      return parseV2(raw, canvasWidth, canvasHeight);
    }

    // Legacy shape: missing version or any non-2 version. The historical v5
    // single-table shape (and any blob that still carries a `cards[].tabs`
    // structure) gets migrated in place. Unrelated shapes (e.g. version 3
    // trees) fall through to the default layout via the `cards` Array check.
    if (Array.isArray(raw["cards"])) {
      return migrateV1ToV2(raw, canvasWidth, canvasHeight);
    }

    return buildDefaultLayout();
  } catch {
    return buildDefaultLayout();
  }
}

// ---- Internal: v2 parser ----

function parseV2(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const rawCards = raw["cards"];
  const rawStacks = raw["stacks"];
  if (!Array.isArray(rawCards) || !Array.isArray(rawStacks)) {
    return buildDefaultLayout();
  }

  const cards: CardState[] = [];
  const cardIdSet = new Set<string>();
  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const card = c as Record<string, unknown>;
    const id = card["id"];
    const componentId = card["componentId"];
    if (typeof id !== "string" || typeof componentId !== "string") continue;
    const rawTitle = card["title"];
    const title = typeof rawTitle === "string" ? rawTitle : "";
    const rawClosable = card["closable"];
    const closable = typeof rawClosable === "boolean" ? rawClosable : true;
    const rawState = card["state"];
    const state =
      rawState && typeof rawState === "object"
        ? (rawState as CardState["state"])
        : undefined;
    cards.push({
      id,
      componentId,
      title,
      closable,
      ...(state !== undefined ? { state } : {}),
    });
    cardIdSet.add(id);
  }

  const stacks: CardStackState[] = [];
  for (const s of rawStacks) {
    if (!s || typeof s !== "object") continue;
    const stack = s as Record<string, unknown>;
    const id = stack["id"];
    const pos = stack["position"] as { x: number; y: number } | undefined;
    const sz = stack["size"] as { width: number; height: number } | undefined;
    const cardIdsRaw = stack["cardIds"];
    if (
      typeof id !== "string" ||
      !pos ||
      !sz ||
      !Array.isArray(cardIdsRaw) ||
      cardIdsRaw.length === 0
    ) {
      continue;
    }
    // Filter cardIds down to ones that have a matching card entry.
    const cardIds = cardIdsRaw.filter(
      (cid): cid is string => typeof cid === "string" && cardIdSet.has(cid),
    );
    if (cardIds.length === 0) continue;

    const width = Math.max(100, sz.width);
    const height = Math.max(100, sz.height);
    let x = pos.x;
    let y = pos.y;
    x = Math.max(
      -(width - TITLE_BAR_VISIBLE_MIN_X),
      Math.min(x, canvasWidth - TITLE_BAR_VISIBLE_MIN_X),
    );
    y = Math.max(0, Math.min(y, canvasHeight - TITLE_BAR_HEIGHT));

    const rawActiveCardId = stack["activeCardId"];
    const activeCardId: string =
      typeof rawActiveCardId === "string" && cardIds.includes(rawActiveCardId)
        ? rawActiveCardId
        : cardIds[0];

    const rawTitle = stack["title"];
    const title = typeof rawTitle === "string" ? rawTitle : "";

    const rawAcceptsFamilies = stack["acceptsFamilies"];
    const acceptsFamilies: readonly string[] = Array.isArray(rawAcceptsFamilies)
      ? (rawAcceptsFamilies as string[])
      : ["standard"];

    const rawCollapsed = stack["collapsed"];
    const collapsed =
      typeof rawCollapsed === "boolean" ? rawCollapsed : undefined;

    stacks.push({
      id,
      position: { x, y },
      size: { width, height },
      cardIds,
      activeCardId,
      title,
      acceptsFamilies,
      ...(collapsed === true ? { collapsed } : {}),
    });
  }

  // Drop cards that aren't referenced by any stack (orphans).
  const referencedCardIds = new Set<string>();
  for (const s of stacks) {
    for (const cid of s.cardIds) referencedCardIds.add(cid);
  }
  const filteredCards = cards.filter((c) => referencedCardIds.has(c.id));

  const rawActiveStackId = raw["activeStackId"];
  const activeStackId =
    typeof rawActiveStackId === "string" &&
    stacks.some((s) => s.id === rawActiveStackId)
      ? rawActiveStackId
      : undefined;

  // `focusedCardId` in the raw blob is ignored — that field is persisted
  // separately via `putFocusedCardId` / `initialFocusedCardId`.

  return {
    cards: filteredCards,
    stacks,
    ...(activeStackId !== undefined ? { activeStackId } : {}),
  };
}

// ---- Internal: v1 → v2 migration ----

/**
 * Migrate a legacy single-table blob (historically `version: 5`) to the
 * two-table shape.
 *
 * Legacy shape per card:
 * ```
 * { id, position, size, tabs: [{ id, componentId, title, closable }],
 *   activeTabId, collapsed?, acceptsFamilies?, title? }
 * ```
 * Migration: each legacy card becomes a stack (same id); each legacy tab
 * becomes a card (same id). Stack's `cardIds` = ordered legacy tab ids;
 * `activeCardId` = legacy `activeTabId` (falls back to first tab id).
 * `focusedCardId` in the legacy blob is already the card identity (= former
 * tabId) and carries across unchanged.
 */
function migrateV1ToV2(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const rawCards = raw["cards"];
  if (!Array.isArray(rawCards)) {
    return buildDefaultLayout();
  }

  const cards: CardState[] = [];
  const stacks: CardStackState[] = [];

  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const legacy = c as Record<string, unknown>;
    const stackId = legacy["id"];
    const pos = legacy["position"] as { x: number; y: number } | undefined;
    const sz = legacy["size"] as { width: number; height: number } | undefined;
    const rawTabs = legacy["tabs"];
    if (
      typeof stackId !== "string" ||
      !pos ||
      !sz ||
      !Array.isArray(rawTabs) ||
      rawTabs.length === 0
    ) {
      continue;
    }

    const cardIds: string[] = [];
    for (const t of rawTabs) {
      if (!t || typeof t !== "object") continue;
      const tab = t as Record<string, unknown>;
      const id = tab["id"];
      const componentId = tab["componentId"];
      if (typeof id !== "string" || typeof componentId !== "string") continue;
      const rawTitle = tab["title"];
      const title = typeof rawTitle === "string" ? rawTitle : "";
      const rawClosable = tab["closable"];
      const closable = typeof rawClosable === "boolean" ? rawClosable : true;
      cards.push({ id, componentId, title, closable });
      cardIds.push(id);
    }

    if (cardIds.length === 0) continue;

    const width = Math.max(100, sz.width);
    const height = Math.max(100, sz.height);
    let x = pos.x;
    let y = pos.y;
    x = Math.max(
      -(width - TITLE_BAR_VISIBLE_MIN_X),
      Math.min(x, canvasWidth - TITLE_BAR_VISIBLE_MIN_X),
    );
    y = Math.max(0, Math.min(y, canvasHeight - TITLE_BAR_HEIGHT));

    const rawActiveTabId = legacy["activeTabId"];
    const activeCardId: string =
      typeof rawActiveTabId === "string" && cardIds.includes(rawActiveTabId)
        ? rawActiveTabId
        : cardIds[0];

    const rawTitle = legacy["title"];
    const title = typeof rawTitle === "string" ? rawTitle : "";

    const rawAcceptsFamilies = legacy["acceptsFamilies"];
    const acceptsFamilies: readonly string[] = Array.isArray(rawAcceptsFamilies)
      ? (rawAcceptsFamilies as string[])
      : ["standard"];

    const rawCollapsed = legacy["collapsed"];
    const collapsed =
      typeof rawCollapsed === "boolean" ? rawCollapsed : undefined;

    stacks.push({
      id: stackId,
      position: { x, y },
      size: { width, height },
      cardIds,
      activeCardId,
      title,
      acceptsFamilies,
      ...(collapsed === true ? { collapsed } : {}),
    });
  }

  // Legacy `focusedCardId` is ignored — reload restoration now reads from
  // tugbank via the `putFocusedCardId` / `initialFocusedCardId` path.

  return { cards, stacks };
}

// ---- Default Layout ----

/**
 * Build the default canvas layout.
 *
 * Returns an empty DeckState. The pre-Phase-5 five-card default layout used
 * component IDs that are not registered in Phase 5. An empty canvas is the
 * correct default until Phase 9 registers real cards.
 *
 */
export function buildDefaultLayout(): DeckState {
  return { cards: [], stacks: [] };
}
