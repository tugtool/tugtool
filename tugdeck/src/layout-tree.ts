/**
 * Canvas data model for the card system.
 *
 * DeckState holds a flat array of CardState values.
 * Each card has a position, size, tabs, and an active tab ID.
 *
 * Spec S01: Canvas Data Model Types
 */

// ---- Types (Spec S01) ----

export interface TabItem {
  id: string; // unique card instance ID
  componentId: string; // "terminal" | "git" | "files" | "stats" | "code"
  title: string;
  closable: boolean;
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
}

export interface DeckState {
  cards: CardState[];
}
