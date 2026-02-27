/**
 * Canonical display titles for card components.
 *
 * Single source of truth — used by main.tsx (factories + instances),
 * deck-manager.ts (titleForComponent), serialization.ts (default layout),
 * and individual card components (useCardMeta).
 */

export const CARD_TITLES: Record<string, string> = {
  code: "Code",
  terminal: "Terminal",
  git: "Git",
  files: "Files",
  stats: "Stats",
  about: "About",
  settings: "Settings",
  developer: "Developer",
};
