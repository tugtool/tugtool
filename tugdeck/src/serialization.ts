/**
 * Serialization, deserialization, and default layout for DeckState.
 *
 * **Current wire format:** `version: 4` with on-disk keys
 * `{ version: 4, cards, panes, activePaneId? }`. `focusedCardId` is persisted
 * separately via `putFocusedCardId` and is not part of the layout blob.
 *
 * **Pre-v4 on-disk shape (migrated on load):** `version: 3` used `windows` and
 * `activeWindowId` instead of `panes` / `activePaneId`. Those blobs are normalized
 * by {@link migrateV3ToV4} before the same parsing and clamping as v4.
 *
 * **Load path:**
 * - `version === 4` — parsed by {@link parseV4}.
 * - `version === 3` — {@link migrateV3ToV4} (field rename only) then {@link parseV4}.
 * - `version === 2` — legacy two-table blob (`stacks`, `activeStackId`); {@link migrateV2ToV4}
 *   bridges to pre-v4 v3 wire names, then {@link migrateV3ToV4} → {@link parseV4}.
 * - Missing `version` or other legacy shapes — if `cards` is an array, the
 *   historical single-table blob (`version: 5`, `cards[].tabs[]`, etc.) is
 *   migrated by {@link migrateV1ToDeckState}. Unrelated shapes (e.g. stray
 *   `version: 4` objects without valid `cards`/`panes`) fall through to
 *   {@link buildDefaultLayout}.
 *
 * Legacy card ids become pane ids; legacy tab ids become card ids — identity
 * is preserved so per-card state in tugbank remains keyed by the same id strings.
 */

import {
  type DeckState,
  type CardState,
  type TugPaneState,
} from "./layout-tree";

// ---- Constants ----

/** Floor for a restored pane's width and height. */
const MIN_PANE_SIZE = 100;

/**
 * Breathing room left between a pane and the canvas edges when the pane has
 * to be sized/positioned to fit. Keeps a fitted pane from sitting flush
 * against the edge, which reads as a glitch rather than a deliberate fit.
 */
const FIT_MARGIN = 8;

// ---- Geometry fitting ----

/**
 * Fit a restored pane's geometry to the live canvas.
 *
 * Floors each dimension at {@link MIN_PANE_SIZE}, then — when the canvas size
 * is known (both dimensions positive) — caps width/height to the canvas (less
 * a {@link FIT_MARGIN} gap on each side) and pulls the position in so no edge
 * overhangs. This brings a pane that was saved on a larger display fully
 * on-screen when the layout is restored on a smaller one, so neither the pane
 * body nor its bottom prompt falls outside the visible canvas, and a fitted
 * pane keeps a small margin from the edges rather than sitting flush.
 *
 * The card-id harvest path (`main.tsx`) passes a 0×0 canvas because it
 * discards geometry; in that case coordinates are returned floored but
 * unclamped.
 */
function fitPaneGeometry(
  pos: { x: number; y: number },
  sz: { width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  let width = Math.max(MIN_PANE_SIZE, sz.width);
  let height = Math.max(MIN_PANE_SIZE, sz.height);
  let x = pos.x;
  let y = pos.y;
  if (canvasWidth > 0 && canvasHeight > 0) {
    width = Math.min(width, Math.max(MIN_PANE_SIZE, canvasWidth - 2 * FIT_MARGIN));
    height = Math.min(height, Math.max(MIN_PANE_SIZE, canvasHeight - 2 * FIT_MARGIN));
    x = Math.max(FIT_MARGIN, Math.min(x, canvasWidth - FIT_MARGIN - width));
    y = Math.max(FIT_MARGIN, Math.min(y, canvasHeight - FIT_MARGIN - height));
  }
  return { x, y, width, height };
}

// ---- Serialize ----

/**
 * Serialize a DeckState to the v4 wire format for settings API persistence.
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
    version: 4,
    cards: deckState.cards,
    panes: deckState.panes,
    ...(deckState.activePaneId !== undefined
      ? { activePaneId: deckState.activePaneId }
      : {}),
  };
}

// ---- Deserialize ----

/**
 * Deserialize a JSON string to a DeckState.
 *
 * Accepts `version: 4` two-table blobs, migrates `version: 3` blobs (field
 * rename to v4 keys), migrates `version: 2` blobs (stacks → windows naming
 * then through the v3→v4 path), or migrates legacy single-table blobs
 * (`version: 5` or missing `version` with `cards[].tabs[]`) to the two-table
 * model. Any blob the parser cannot make sense of falls back to
 * {@link buildDefaultLayout}.
 *
 * Enforces 100px minimum sizes and fits panes to the canvas: a pane saved on
 * a larger display is capped to the current canvas and pulled fully on-screen
 * so neither it nor its contents overhang the visible bounds. See
 * {@link fitPaneGeometry}.
 */
export function deserialize(
  json: string,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;

    if (raw["version"] === 4) {
      return parseV4(raw, canvasWidth, canvasHeight);
    }

    if (raw["version"] === 3) {
      return parseV4(migrateV3ToV4(raw), canvasWidth, canvasHeight);
    }

    if (raw["version"] === 2) {
      return migrateV2ToV4(raw, canvasWidth, canvasHeight);
    }

    // Legacy shape: missing version or any non-2/3/4 version. The historical v5
    // single-table shape (and any blob that still carries a `cards[].tabs`
    // structure) gets migrated in place. Unrelated shapes (e.g. version 4
    // placeholder objects without valid `cards`/`panes`) fall through to
    // the default layout via the `cards` Array check inside migrate or here.
    if (Array.isArray(raw["cards"])) {
      return migrateV1ToDeckState(raw, canvasWidth, canvasHeight);
    }

    return buildDefaultLayout();
  } catch {
    return buildDefaultLayout();
  }
}

// ---- Internal: v3 → v4 (field rename on the wire object) ----

/**
 * Convert a pre-v4 `version: 3` blob (`windows`, `activeWindowId`) into a
 * v4-shaped record (`panes`, `activePaneId`) for {@link parseV4}. Other keys
 * such as `focusedCardId` are preserved so parseV4 can ignore them as today.
 */
function migrateV3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    version: 4,
    cards: raw["cards"],
    panes: raw["windows"],
  };
  const rawActive = raw["activeWindowId"];
  if (typeof rawActive === "string") {
    out["activePaneId"] = rawActive;
  }
  if ("focusedCardId" in raw) {
    out["focusedCardId"] = raw["focusedCardId"];
  }
  return out;
}

// ---- Internal: v4 parser ----

/**
 * Parse a `version: 4` layout blob into {@link DeckState}.
 * Ignores unknown top-level keys (including legacy `focusedCardId`).
 */
function parseV4(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const rawCards = raw["cards"];
  const rawPanes = raw["panes"];
  if (!Array.isArray(rawCards) || !Array.isArray(rawPanes)) {
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

  const panes: TugPaneState[] = [];
  for (const w of rawPanes) {
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

    const { x, y, width, height } = fitPaneGeometry(
      pos,
      sz,
      canvasWidth,
      canvasHeight,
    );

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

    panes.push({
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
  for (const pane of panes) {
    for (const cid of pane.cardIds) referencedCardIds.add(cid);
  }
  const filteredCards = cards.filter((c) => referencedCardIds.has(c.id));

  const rawActivePaneId = raw["activePaneId"];
  const activePaneId =
    typeof rawActivePaneId === "string" &&
    panes.some((pane) => pane.id === rawActivePaneId)
      ? rawActivePaneId
      : undefined;

  return {
    cards: filteredCards,
    panes,
    ...(activePaneId !== undefined ? { activePaneId } : {}),
    // Session-only; deserialize always seeds true and DeckManager overrides
    // with the live `document.hasFocus()` reading at construction. Not
    // persisted to disk.
    hasFocus: true,
  };
}

/**
 * Migrate a v2 two-table blob (`stacks`, `activeStackId`) to the pre-v4 v3
 * wire field names, then through {@link migrateV3ToV4} and {@link parseV4}.
 * Semantics are unchanged — key renames on the wire object before the same
 * validation and clamping as v4.
 */
function migrateV2ToV4(
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number,
): DeckState {
  const bridged: Record<string, unknown> = {
    version: 3,
    cards: raw["cards"],
    windows: raw["stacks"],
  };
  const rawActive = raw["activeStackId"];
  if (typeof rawActive === "string") {
    bridged["activeWindowId"] = rawActive;
  }
  return parseV4(migrateV3ToV4(bridged), canvasWidth, canvasHeight);
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
 * Migration: each legacy card becomes a pane (same id); each legacy tab
 * becomes a card (same id). Pane `cardIds` = ordered legacy tab ids;
 * `activeCardId` = legacy `activeTabId` (falls back to first tab id).
 * `focusedCardId` in the legacy blob is already the card identity (= former
 * single-table tab identity) and carries across unchanged.
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
  const panes: TugPaneState[] = [];

  for (const c of rawCards) {
    if (!c || typeof c !== "object") continue;
    const legacy = c as Record<string, unknown>;
    const paneId = legacy["id"];
    const pos = legacy["position"] as { x: number; y: number } | undefined;
    const sz = legacy["size"] as { width: number; height: number } | undefined;
    const rawTabs = legacy["tabs"];
    if (
      typeof paneId !== "string" ||
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

    const { x, y, width, height } = fitPaneGeometry(
      pos,
      sz,
      canvasWidth,
      canvasHeight,
    );

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

    panes.push({
      id: paneId,
      position: { x, y },
      size: { width, height },
      cardIds,
      activeCardId,
      title,
      acceptsFamilies,
      ...(collapsed === true ? { collapsed } : {}),
    });
  }

  return { cards, panes, hasFocus: true };
}

// ---- Default Layout ----

/**
 * Build the default canvas layout.
 *
 * Returns an empty DeckState. The pre-Phase-5 five-card default layout used
 * component IDs that are not registered in Phase 5. An empty canvas is the
 * correct default until Phase 9 registers real cards.
 *
 * `hasFocus` is seeded true here as a safe default for non-browser
 * contexts (tests, SSR). `DeckManager` overrides it in its
 * constructor with the live `document.hasFocus()` reading.
 */
export function buildDefaultLayout(): DeckState {
  return { cards: [], panes: [], hasFocus: true };
}
