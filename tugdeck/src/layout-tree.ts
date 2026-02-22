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

export interface TabNode {
  type: "tab";
  id: string; // crypto.randomUUID()
  tabs: TabItem[];
  activeTabIndex: number;
}

export interface CardState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tabs: TabItem[];
  activeTabId: string;
}

export interface DeckState {
  cards: CardState[];
}
