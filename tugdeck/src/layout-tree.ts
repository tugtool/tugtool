/**
 * Canvas data model for the panel system.
 *
 * CanvasState holds a flat array of PanelState values.
 * Each panel has a position, size, tabs, and an active tab ID.
 *
 * Spec S01: Canvas Data Model Types
 */

// ---- Types (Spec S01) ----

export interface TabItem {
  id: string; // unique card instance ID
  componentId: string; // "terminal" | "git" | "files" | "stats" | "conversation"
  title: string;
  closable: boolean;
}

export interface TabNode {
  type: "tab";
  id: string; // crypto.randomUUID()
  tabs: TabItem[];
  activeTabIndex: number;
}

export interface PanelState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tabs: TabItem[];
  activeTabId: string;
}

export interface CanvasState {
  panels: PanelState[];
}
