/**
 * Canvas data model for the card system.
 *
 * DeckState holds a flat array of CardState values.
 * Each card has a position, size, tabs, and an active tab ID.
 *
 * Spec S01: Canvas Data Model Types
 */

import type { SavedSelection } from "./components/tugways/selection-guard";

// ---- Types (Spec S01) ----

export interface TabItem {
  id: string; // unique card instance ID
  componentId: string; // "terminal" | "git" | "files" | "stats" | "code"
  title: string;
  closable: boolean;
}

/**
 * Per-tab state bag for scroll position, text selection, and card content state.
 *
 * Stored in DeckManager's in-memory cache (primary read source during a session)
 * and in tugbank under dev.tugtool.deck.tabstate/{tabId} (durable backing store).
 *
 * Spec S01: TabStateBag type ([D01])
 */
export interface TabStateBag {
  scroll?: { x: number; y: number };
  selection?: SavedSelection | null;
  content?: unknown;
}

export interface CardState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tabs: TabItem[];
  activeTabId: string;
  /** Card-level display title (e.g. "Component Gallery"). Empty string for generic cards. */
  title: string;
  /** Families of card types this card can host in its type picker. Defaults to ["standard"]. */
  acceptsFamilies: readonly string[];
  /**
   * Whether the card is collapsed (title bar only, content hidden).
   * Missing/undefined is treated as false. No UI in Phase 5f — field established for Phase 8a.
   * ([D04])
   */
  collapsed?: boolean;
}

export interface DeckState {
  cards: CardState[];
  /**
   * The ID of the card that was focused when the deck was last saved.
   * Used only for reload restoration (not runtime focus inference).
   * Persisted separately to tugbank via settings-api, not in the layout blob.
   * ([D03])
   */
  focusedCardId?: string;
  /**
   * Explicit set membership groups. Each inner array is a group of card IDs
   * that were intentionally snapped together via Option+drag. Sets form only
   * through snap gestures and dissolve through Option+drag break-out or card
   * removal. Geometric proximity alone never creates a set.
   */
  sets: string[][];
}
