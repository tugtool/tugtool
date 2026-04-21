/**
 * Serialization, deserialization, and default layout for DeckState.
 *
 * **Current wire format:** `version: 3` with
 * `{ version: 3, cards, windows, activeWindowId? }`. `focusedCardId` is
 * persisted separately via `putFocusedCardId` and is not part of the layout
 * blob.
 *
 * **Load path:**
 * - `version === 3` — parsed by {@link parseV3} (field names match `DeckState`).
 * - `version === 2` — legacy two-table blob (`stacks`, `activeStackId`); migrated
 *   in place via {@link migrateV2ToV3} then parsed like v3.
 * - Missing `version` or other legacy shapes — if `cards` is an array, the
 *   historical single-table blob (`version: 5`, `cards[].tabs[]`, etc.) is
 *   migrated by {@link migrateV1ToDeckState}. Unrelated shapes (e.g. stray
 *   `version: 3` objects without valid `cards`/`windows`) fall through to
 *   {@link buildDefaultLayout}.
 *
 * Legacy card ids become window ids; legacy tab ids become card ids — identity
 * is preserved so tugbank's `tabstate/{id}` rows remain addressable.
 */

import {
  type DeckState,
  type CardState,
  type TugWindowState,
} from "./layout-tree";

// ---- Constants ----

const TITLE_BAR_VISIBLE_MIN_X = 100;
const TITLE_BAR_HEIGHT = 36;

// ---- Serialize ----

/**
 * Serialize a DeckState to the v3 wire format for settings API persistence.
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
    version: 3,
    cards: deckState.cards,
    windows: deckState.windows,
    ...(deckState.activeWindowId !== undefined
      ? { activeWindowId: deckState.activeWindowId }
      : {}),
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a DeckState.
 *
 * Accepts `version: 3` two-table blobs, migrates `version: 2` blobs (rename
 * only), or migrates legacy single-table blobs (`version: 5` or missing
 * `version` with `cards[].tabs[]`) to the two-table model. Any blob the
 * parser cannot make sense of falls back to {@link buildDefaultLayout}.
 *
 * Enforces 100px minimum sizes and clamps window positions to canvas bounds.
 */
export function deserialize(
  json: string,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;

    if (raw["version"] === 3) {
      return parseV3(raw, canvasWidth, canvasHeight);
    }

    if (raw["version"] === 2) {
      return migrateV2ToV3(raw, canvasWidth, canvasHeight);
    }

    // Legacy shape: missing version or any non-2/3 version. The historical v5
    // single-table shape (and any blob that still carries a `cards[].tabs`
    // structure) gets migrated in place. Unrelated shapes (e.g. version 3
    // placeholder objects without valid `cards`/`windows`) fall through to
    // the default layout via the `cards` Array check inside migrate or here.
    if (Array.isArray(raw["cards"])) {
      return migrateV1ToDeckState(raw, canvasWidth, canvasHeight);
    }

    return buildDefaultLayout();
  } catch {
    return buildDefaultLayout();
  }
}

// ---- Internal: v3 parser ----

/**
 * Parse a `version: 3` layout blob into {@link DeckState}.
 * Ignores unknown top-level keys (including legacy `focusedCardId`).
 */
function parseV3(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const rawCards = raw["cards"];
  const rawWindows = raw["windows"];
  if (!Array.isArray(rawCards) || !Array.isArray(rawWindows)) {
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

  const windows: TugWindowState[] = [];
  for (const w of rawWindows) {
    if (!w || typeof w !== "object") continue;
    const win = w as Record<string, unknown>;
    const id = win["id"];
    const pos = win["position"] as { x: number; y: number } | undefined;
    const sz = win["size"] as { width: number; height: number } | undefined;
    const cardIdsRaw = win["cardIds"];
    if (
      typeof id !== "string" ||
      !pos ||
      !sz ||
      !Array.isArray(cardIdsRaw) ||
      cardIdsRaw.length === 0
    ) {
      continue;
    }
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

    const rawActiveCardId = win["activeCardId"];
    const activeCardId: string =
      typeof rawActiveCardId === "string" && cardIds.includes(rawActiveCardId)
        ? rawActiveCardId
        : cardIds[0];

    const rawTitle = win["title"];
    const title = typeof rawTitle === "string" ? rawTitle : "";

    const rawAcceptsFamilies = win["acceptsFamilies"];
    const acceptsFamilies: readonly string[] = Array.isArray(rawAcceptsFamilies)
      ? (rawAcceptsFamilies as string[])
      : ["standard"];

    const rawCollapsed = win["collapsed"];
    const collapsed =
      typeof rawCollapsed === "boolean" ? rawCollapsed : undefined;

    windows.push({
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

  const referencedCardIds = new Set<string>();
  for (const win of windows) {
    for (const cid of win.cardIds) referencedCardIds.add(cid);
  }
  const filteredCards = cards.filter((c) => referencedCardIds.has(c.id));

  const rawActiveWindowId = raw["activeWindowId"];
  const activeWindowId =
    typeof rawActiveWindowId === "string" &&
    windows.some((win) => win.id === rawActiveWindowId)
      ? rawActiveWindowId
      : undefined;

  return {
    cards: filteredCards,
    windows,
    ...(activeWindowId !== undefined ? { activeWindowId } : {}),
  };
}

/**
 * Migrate a v2 two-table blob (`stacks`, `activeStackId`) to the v3 field
 * names and parse. Semantics are unchanged — this is a pure key rename on the
 * wire object before the same validation and clamping as v3.
 */
function migrateV2ToV3(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const bridged: Record<string, unknown> = {
    cards: raw["cards"],
    windows: raw["stacks"],
  };
  const rawActive = raw["activeStackId"];
  if (typeof rawActive === "string") {
    bridged["activeWindowId"] = rawActive;
  }
  return parseV3(bridged, canvasWidth, canvasHeight);
}

// ---- Internal: legacy single-table → two-table ----

/**
 * Migrate a legacy single-table blob (historically `version: 5`) to
 * {@link DeckState}.
 *
 * Legacy shape per card:
 * ```
 * { id, position, size, tabs: [{ id, componentId, title, closable }],
 *   activeTabId, collapsed?, acceptsFamilies?, title? }
 * ```
 * Migration: each legacy card becomes a window (same id); each legacy tab
 * becomes a card (same id). Window `cardIds` = ordered legacy tab ids;
 * `activeCardId` = legacy `activeTabId` (falls back to first tab id).
 * `focusedCardId` in the legacy blob is already the card identity (= former
 * tabId) and carries across unchanged.
 */
function migrateV1ToDeckState(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const rawCards = raw["cards"];
  if (!Array.isArray(rawCards)) {
    return buildDefaultLayout();
  }

  const cards: CardState[] = [];
  const windows: TugWindowState[] = [];

  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const legacy = c as Record<string, unknown>;
    const windowId = legacy["id"];
    const pos = legacy["position"] as { x: number; y: number } | undefined;
    const sz = legacy["size"] as { width: number; height: number } | undefined;
    const rawTabs = legacy["tabs"];
    if (
      typeof windowId !== "string" ||
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

    windows.push({
      id: windowId,
      position: { x, y },
      size: { width, height },
      cardIds,
      activeCardId,
      title,
      acceptsFamilies,
      ...(collapsed === true ? { collapsed } : {}),
    });
  }

  return { cards, windows };
}

// ---- Default Layout ----

/**
 * Build the default canvas layout.
 *
 * Returns an empty DeckState. The pre-Phase-5 five-card default layout used
 * component IDs that are not registered in Phase 5. An empty canvas is the
 * correct default until Phase 9 registers real cards.
 */
export function buildDefaultLayout(): DeckState {
  return { cards: [], windows: [] };
}
