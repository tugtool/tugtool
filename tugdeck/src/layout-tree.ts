/**
 * Canvas data model for the card system (two-table shape).
 *
 * DeckState holds two flat arrays:
 *   - `cards`: the content identities — id, componentId, title, closable,
 *     plus an optional persistence bag.
 *   - `windows`: the visual frames — position, size, ordered cardIds, the
 *     active card in the window, collapsed, acceptsFamilies, title.
 *
 * Invariants:
 *   1. Every `cardIds` entry in every window references a real card (by id) in
 *      `deckState.cards`.
 *   2. Each card appears in exactly one window's `cardIds` (no orphans, no
 *      duplicates).
 *   3. No window has an empty `cardIds` array — closing the last card of a
 *      window closes the window.
 *   4. Each window's `activeCardId` is a member of that window's `cardIds`.
 *   5. `activeWindowId`, when set, references a real window in `windows`.
 *
 * Spec S01: Canvas Data Model Types
 */

import type { SavedSelection } from "./components/tugways/selection-guard";

// ---- Types (Spec S01) ----

/**
 * Per-card state bag for scroll position, text selection, and card content
 * state.
 *
 * Stored in DeckManager's in-memory cache (primary read source during a
 * session) and in tugbank under `dev.tugtool.deck.tabstate/{cardId}` (durable
 * backing store). The tugbank row prefix retains the historical `tabstate/`
 * name so existing persisted bags remain readable; `cardId` IS the former
 * `tabId` (identity was preserved when the two-table model landed).
 *
 * Spec S01: CardStateBag type ([D01])
 */
export interface CardStateBag {
  scroll?: { x: number; y: number };
  selection?: SavedSelection | null;
  content?: unknown;
}

/**
 * A card — the content identity that survives cross-window moves.
 *
 * A card knows its componentId, title, and whether it is closable. Position,
 * size, and active-ness are properties of the enclosing window, not the card.
 * An optional `state` bag carries per-content persistence.
 */
export interface CardState {
  id: string;
  componentId: string;
  title: string;
  closable: boolean;
  state?: CardStateBag;
}

/**
 * A window — the visual frame containing one or more cards.
 *
 * Windows own position, size, collapsed, acceptsFamilies, and the ordered list
 * of cardIds they contain. Exactly one of the cardIds is the window's
 * `activeCardId`, which is the card whose content is visible in the window.
 */
export interface TugWindowState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Ordered list of card ids belonging to this window. */
  cardIds: readonly string[];
  /** The currently-active card in the window. Must be in `cardIds`. */
  activeCardId: string;
  /** Card-level display title (e.g. "Component Gallery"). Empty string for generic windows. */
  title: string;
  /** Families of card types this window can host in its type picker. Defaults to ["standard"]. */
  acceptsFamilies: readonly string[];
  /**
   * Whether the window is collapsed (title bar only, content hidden).
   * Missing/undefined is treated as false. ([D04])
   */
  collapsed?: boolean;
}

/**
 * The deck's full state.
 *
 * - `cards` holds every card identity in the deck.
 * - `windows` holds every window frame; each window's `cardIds` partitions
 *   `cards`.
 * - `activeWindowId` identifies the deck's currently-active window, if any.
 *
 * Reload-focus restoration is handled out-of-band: `putFocusedCardId`
 * writes a single-field row to tugbank, and `DeckManager` reads it back
 * via the `initialFocusedCardId` constructor parameter. That pointer is
 * deliberately not part of `DeckState` — it would duplicate persistence
 * paths.
 */
export interface DeckState {
  cards: readonly CardState[];
  windows: readonly TugWindowState[];
  activeWindowId?: string;
}

// ---- Invariant validation ----

/**
 * Thrown by {@link validateDeckState} when the two-table invariants are
 * violated. The `message` names the violated invariant and includes the
 * offending ids so failures are traceable in test output.
 */
export class DeckStateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckStateInvariantError";
  }
}

/**
 * Validate every DeckState invariant documented above. Throws
 * {@link DeckStateInvariantError} on the first violation.
 *
 * Invariants checked:
 *   1. every `win.cardIds` entry references a real `state.cards[].id`;
 *   2. every card appears in exactly one window's `cardIds` (no orphans, no
 *      duplicates);
 *   3. no window has `cardIds.length === 0`;
 *   4. every `win.activeCardId` is a member of that window's `cardIds`;
 *   5. when `state.activeWindowId` is set, it references a real window.
 *
 * Called unconditionally from `DeckManager.applyLayout` (before notify) and
 * from `DeckManager.notify` in dev/test builds only.
 */
export function validateDeckState(state: DeckState): void {
  const cardIds = new Set<string>();
  for (const card of state.cards) {
    if (cardIds.has(card.id)) {
      throw new DeckStateInvariantError(
        `duplicate card id "${card.id}" in deckState.cards`,
      );
    }
    cardIds.add(card.id);
  }

  const windowIds = new Set<string>();
  const cardToWindow = new Map<string, string>();
  for (const win of state.windows) {
    if (windowIds.has(win.id)) {
      throw new DeckStateInvariantError(
        `duplicate window id "${win.id}" in deckState.windows`,
      );
    }
    windowIds.add(win.id);

    // Invariant 3
    if (win.cardIds.length === 0) {
      throw new DeckStateInvariantError(
        `window "${win.id}" has empty cardIds (no empty windows permitted)`,
      );
    }

    for (const cid of win.cardIds) {
      // Invariant 1
      if (!cardIds.has(cid)) {
        throw new DeckStateInvariantError(
          `window "${win.id}" references missing card id "${cid}"`,
        );
      }
      // Invariant 2
      const existingHost = cardToWindow.get(cid);
      if (existingHost !== undefined) {
        throw new DeckStateInvariantError(
          `card "${cid}" appears in both window "${existingHost}" and "${win.id}"`,
        );
      }
      cardToWindow.set(cid, win.id);
    }

    // Invariant 4
    if (!win.cardIds.includes(win.activeCardId)) {
      throw new DeckStateInvariantError(
        `window "${win.id}" activeCardId "${win.activeCardId}" is not in cardIds`,
      );
    }
  }

  // Invariant 2 (second half): every card has a host window.
  for (const card of state.cards) {
    if (!cardToWindow.has(card.id)) {
      throw new DeckStateInvariantError(
        `card "${card.id}" is orphaned (no window references it)`,
      );
    }
  }

  // Invariant 5
  if (
    state.activeWindowId !== undefined &&
    !windowIds.has(state.activeWindowId)
  ) {
    throw new DeckStateInvariantError(
      `activeWindowId "${state.activeWindowId}" does not reference a real window`,
    );
  }
}
