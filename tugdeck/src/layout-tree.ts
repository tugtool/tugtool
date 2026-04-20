/**
 * Canvas data model for the card system (two-table shape).
 *
 * DeckState holds two flat arrays:
 *   - `cards`: the content identities — id, componentId, title, closable,
 *     plus an optional persistence bag.
 *   - `stacks`: the visual frames — position, size, ordered cardIds, the
 *     active card in the stack, collapsed, acceptsFamilies, title.
 *
 * Invariants:
 *   1. Every `cardIds` entry in every stack references a real card (by id) in
 *      `deckState.cards`.
 *   2. Each card appears in exactly one stack's `cardIds` (no orphans, no
 *      duplicates).
 *   3. No stack has an empty `cardIds` array — closing the last card of a
 *      stack closes the stack.
 *   4. Each stack's `activeCardId` is a member of that stack's `cardIds`.
 *   5. `activeStackId`, when set, references a real stack in `stacks`.
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
 * A card — the content identity that survives cross-stack moves.
 *
 * A card knows its componentId, title, and whether it is closable. Position,
 * size, and active-ness are properties of the enclosing stack, not the card.
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
 * A card stack — the visual frame containing one or more cards.
 *
 * Stacks own position, size, collapsed, acceptsFamilies, and the ordered list
 * of cardIds they contain. Exactly one of the cardIds is the stack's
 * `activeCardId`, which is the card whose content is visible in the stack.
 */
export interface CardStackState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Ordered list of card ids belonging to this stack. */
  cardIds: readonly string[];
  /** The currently-active card in the stack. Must be in `cardIds`. */
  activeCardId: string;
  /** Card-level display title (e.g. "Component Gallery"). Empty string for generic stacks. */
  title: string;
  /** Families of card types this stack can host in its type picker. Defaults to ["standard"]. */
  acceptsFamilies: readonly string[];
  /**
   * Whether the stack is collapsed (title bar only, content hidden).
   * Missing/undefined is treated as false. ([D04])
   */
  collapsed?: boolean;
}

/**
 * The deck's full state.
 *
 * - `cards` holds every card identity in the deck.
 * - `stacks` holds every stack frame; each stack's `cardIds` partitions
 *   `cards`.
 * - `activeStackId` identifies the deck's currently-active stack, if any.
 * - `focusedCardId` records the card focused when the deck was last saved
 *   (reload restoration only; not runtime focus inference). Persisted
 *   separately to tugbank via settings-api, not in the layout blob. ([D03])
 */
export interface DeckState {
  cards: readonly CardState[];
  stacks: readonly CardStackState[];
  activeStackId?: string;
  focusedCardId?: string;
}
