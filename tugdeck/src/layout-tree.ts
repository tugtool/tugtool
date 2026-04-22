/**
 * Canvas data model for the card system (two-table shape).
 *
 * DeckState holds two flat arrays:
 *   - `cards`: the content identities — id, componentId, title, closable,
 *     plus an optional persistence bag.
 *   - `panes`: the visual frames — position, size, ordered cardIds, the
 *     active card in the pane, collapsed, acceptsFamilies, title.
 *
 * Invariants:
 *   1. Every `cardIds` entry in every pane references a real card (by id) in
 *      `deckState.cards`.
 *   2. Each card appears in exactly one pane's `cardIds` (no orphans, no
 *      duplicates).
 *   3. No pane has an empty `cardIds` array — closing the last card of a
 *      pane closes the pane.
 *   4. Each pane's `activeCardId` is a member of that pane's `cardIds`.
 *   5. `activePaneId`, when set, references a real pane in `panes`.
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
 * session) and in tugbank under `dev.tugtool.deck.cardstate/{cardId}` (durable
 * backing store).
 *
 * Spec S01: CardStateBag type ([D01])
 */
export interface CardStateBag {
  scroll?: { x: number; y: number };
  selection?: SavedSelection | null;
  content?: unknown;
  /**
   * Snapshot of every `<input>` / `<textarea>` inside the card that carries
   * a `data-tug-persist-value="<key>"` attribute, keyed by the attribute's
   * value. Captured at save time by walking `hostContentEl.querySelectorAll`.
   * Reapplied on restore and on any DOM mutation that introduces a matching
   * element later (to handle late mounts). DOM-authority persistence for
   * native input state that sits outside `useCardPersistence`'s opt-in path.
   */
  domInputs?: Record<string, DomInputSnapshot>;
}

/**
 * DOM-authority snapshot of a single native input or textarea. Captured and
 * reapplied by `CardHost` for any element bearing `data-tug-persist-value`.
 */
export interface DomInputSnapshot {
  value: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectionDirection?: "forward" | "backward" | "none";
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * A card — the content identity that survives cross-pane moves.
 *
 * A card knows its componentId, title, and whether it is closable. Position,
 * size, and active-ness are properties of the enclosing pane, not the card.
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
 * A pane — the visual frame containing one or more cards.
 *
 * Panes own position, size, collapsed, acceptsFamilies, and the ordered list
 * of cardIds they contain. Exactly one of the cardIds is the pane's
 * `activeCardId`, which is the card whose content is visible in the pane.
 */
export interface TugPaneState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Ordered list of card ids belonging to this pane. */
  cardIds: readonly string[];
  /** The currently-active card in the pane. Must be in `cardIds`. */
  activeCardId: string;
  /** Card-level display title (e.g. "Component Gallery"). Empty string for generic panes. */
  title: string;
  /** Families of card types this pane can host in its type picker. Defaults to ["standard"]. */
  acceptsFamilies: readonly string[];
  /**
   * Whether the pane is collapsed (title bar only, content hidden).
   * Missing/undefined is treated as false. ([D04])
   */
  collapsed?: boolean;
}

/**
 * The deck's full state.
 *
 * - `cards` holds every card identity in the deck.
 * - `panes` holds every pane frame; each pane's `cardIds` partitions
 *   `cards`.
 * - `activePaneId` identifies the deck's currently-active pane, if any.
 *
 * Reload-focus restoration is handled out-of-band: `putFocusedCardId`
 * writes a single-field row to tugbank, and `DeckManager` reads it back
 * via the `initialFocusedCardId` constructor parameter. That pointer is
 * deliberately not part of `DeckState` — it would duplicate persistence
 * paths.
 */
export interface DeckState {
  cards: readonly CardState[];
  panes: readonly TugPaneState[];
  activePaneId?: string;
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
 *   1. every `pane.cardIds` entry references a real `state.cards[].id`;
 *   2. every card appears in exactly one pane's `cardIds` (no orphans, no
 *      duplicates);
 *   3. no pane has `cardIds.length === 0`;
 *   4. every `pane.activeCardId` is a member of that pane's `cardIds`;
 *   5. when `state.activePaneId` is set, it references a real pane.
 *
 * Called from `DeckManager.notify` in dev/test builds only — guarded by
 * `isDevEnv()` so production builds pay no cost. Violations surface at the
 * mutation site that produced them rather than downstream.
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

  const paneIds = new Set<string>();
  const cardToPane = new Map<string, string>();
  for (const pane of state.panes) {
    if (paneIds.has(pane.id)) {
      throw new DeckStateInvariantError(
        `duplicate pane id "${pane.id}" in deckState.panes`,
      );
    }
    paneIds.add(pane.id);

    // Invariant 3
    if (pane.cardIds.length === 0) {
      throw new DeckStateInvariantError(
        `pane "${pane.id}" has empty cardIds (no empty panes permitted)`,
      );
    }

    for (const cid of pane.cardIds) {
      // Invariant 1
      if (!cardIds.has(cid)) {
        throw new DeckStateInvariantError(
          `pane "${pane.id}" references missing card id "${cid}"`,
        );
      }
      // Invariant 2
      const existingHost = cardToPane.get(cid);
      if (existingHost !== undefined) {
        throw new DeckStateInvariantError(
          `card "${cid}" appears in both pane "${existingHost}" and "${pane.id}"`,
        );
      }
      cardToPane.set(cid, pane.id);
    }

    // Invariant 4
    if (!pane.cardIds.includes(pane.activeCardId)) {
      throw new DeckStateInvariantError(
        `pane "${pane.id}" activeCardId "${pane.activeCardId}" is not in cardIds`,
      );
    }
  }

  // Invariant 2 (second half): every card has a host pane.
  for (const card of state.cards) {
    if (!cardToPane.has(card.id)) {
      throw new DeckStateInvariantError(
        `card "${card.id}" is orphaned (no pane references it)`,
      );
    }
  }

  // Invariant 5
  if (
    state.activePaneId !== undefined &&
    !paneIds.has(state.activePaneId)
  ) {
    throw new DeckStateInvariantError(
      `activePaneId "${state.activePaneId}" does not reference a real pane`,
    );
  }
}
