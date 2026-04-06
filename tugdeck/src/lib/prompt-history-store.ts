/**
 * PromptHistoryStore — session-scoped prompt history with tugbank persistence.
 *
 * This file contains only the type definitions for Step 2.
 * The PromptHistoryStore class is added in Step 3.
 *
 * **Laws:** [L02] L02-compliant store with subscribe/getSnapshot.
 *           [L23] Persists to tugbank — data survives reload and quit.
 *
 * @module lib/prompt-history-store
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A serialized atom captures the subset of atom fields needed for persistence.
 * Used to restore file references and other inline atoms when navigating history.
 *
 * Note: If tug-text-engine exports a compatible atom element type in the future,
 * consider aliasing it here instead of duplicating.
 */
export interface SerializedAtom {
  position: number;
  type: string;
  label: string;
  value: string;
}

/**
 * A single prompt history entry. Stores everything needed to restore the prompt
 * state when the user navigates Cmd+Up/Down through history.
 *
 * Metadata fields (sessionId, projectPath, route) are stored for future
 * cross-session search tiers (T3.4+).
 */
export interface HistoryEntry {
  id: string;
  sessionId: string;
  projectPath: string;
  route: string;
  text: string;
  atoms: SerializedAtom[];
  timestamp: number;
}
