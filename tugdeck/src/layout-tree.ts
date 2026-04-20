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
 *
 * Reload-focus restoration is handled out-of-band: `putFocusedCardId`
 * writes a single-field row to tugbank, and `DeckManager` reads it back
 * via the `initialFocusedCardId` constructor parameter. That pointer is
 * deliberately not part of `DeckState` — it would duplicate persistence
 * paths.
 */
export interface DeckState {
  cards: readonly CardState[];
  stacks: readonly CardStackState[];
  activeStackId?: string;
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
 *   1. every `stack.cardIds` entry references a real `state.cards[].id`;
 *   2. every card appears in exactly one stack's `cardIds` (no orphans, no
 *      duplicates);
 *   3. no stack has `cardIds.length === 0`;
 *   4. every `stack.activeCardId` is a member of that stack's `cardIds`;
 *   5. when `state.activeStackId` is set, it references a real stack.
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

  const stackIds = new Set<string>();
  const cardToStack = new Map<string, string>();
  for (const stack of state.stacks) {
    if (stackIds.has(stack.id)) {
      throw new DeckStateInvariantError(
        `duplicate stack id "${stack.id}" in deckState.stacks`,
      );
    }
    stackIds.add(stack.id);

    // Invariant 3
    if (stack.cardIds.length === 0) {
      throw new DeckStateInvariantError(
        `stack "${stack.id}" has empty cardIds (no empty stacks permitted)`,
      );
    }

    for (const cid of stack.cardIds) {
      // Invariant 1
      if (!cardIds.has(cid)) {
        throw new DeckStateInvariantError(
          `stack "${stack.id}" references missing card id "${cid}"`,
        );
      }
      // Invariant 2
      const existingHost = cardToStack.get(cid);
      if (existingHost !== undefined) {
        throw new DeckStateInvariantError(
          `card "${cid}" appears in both stack "${existingHost}" and "${stack.id}"`,
        );
      }
      cardToStack.set(cid, stack.id);
    }

    // Invariant 4
    if (!stack.cardIds.includes(stack.activeCardId)) {
      throw new DeckStateInvariantError(
        `stack "${stack.id}" activeCardId "${stack.activeCardId}" is not in cardIds`,
      );
    }
  }

  // Invariant 2 (second half): every card has a host stack.
  for (const card of state.cards) {
    if (!cardToStack.has(card.id)) {
      throw new DeckStateInvariantError(
        `card "${card.id}" is orphaned (no stack references it)`,
      );
    }
  }

  // Invariant 5
  if (state.activeStackId !== undefined && !stackIds.has(state.activeStackId)) {
    throw new DeckStateInvariantError(
      `activeStackId "${state.activeStackId}" does not reference a real stack`,
    );
  }
}
