/**
 * settings-sections-pref.ts — which Settings sections the reader has collapsed.
 *
 * The Settings card stacks its preference groups in one accordion. What is
 * persisted is the **collapsed** set, not the open set: an absent key means
 * nothing is collapsed, so a fresh profile opens with every section expanded,
 * and a section added later is expanded on its first appearance without a
 * migration.
 *
 * A missing entry (never set) and an empty array (the reader re-expanded
 * everything) are distinct states, so `parseSettingsCollapsedSections` returns
 * `null` for the former and `[]` for the latter. Ids outside
 * {@link SETTINGS_SECTION_IDS} are dropped on parse, which is also what retires
 * a `"keyboard"` entry written by a build that still hosted the keymap
 * configurator inside Settings.
 *
 * Persisted deck-wide through tugbank defaults
 * (`/api/defaults/dev.tugtool.settings-card/collapsedSections`, [D07],
 * `feedback_no_localstorage`), not per card: there is at most one Settings
 * card, and how a reader arranges it is about the reader.
 *
 * Laws: [L02] the tugbank cache enters React through `useTugbankValue`.
 *
 * @module lib/settings-sections-pref
 */

import { useCallback } from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";

/** One collapsible section of the Settings card. */
export type SettingsSectionId = "general" | "sessionCard" | "textCard" | "app";

export const SETTINGS_SECTIONS_DOMAIN = "dev.tugtool.settings-card";
export const SETTINGS_COLLAPSED_KEY = "collapsedSections";

/** Every section, in the order the card presents them. */
export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "general",
  "sessionCard",
  "textCard",
  "app",
];

/** Nothing collapsed — the first-run arrangement. */
export const DEFAULT_SETTINGS_COLLAPSED: readonly SettingsSectionId[] = [];

/**
 * Parse a persisted collapsed-section list; `null` when nothing has ever been
 * stored. Unknown ids are dropped, and the result keeps
 * {@link SETTINGS_SECTION_IDS} order.
 */
export function parseSettingsCollapsedSections(
  entry: TaggedValue | undefined,
): readonly SettingsSectionId[] | null {
  if (entry === undefined || !Array.isArray(entry.value)) return null;
  const stored = entry.value;
  return SETTINGS_SECTION_IDS.filter((id) => stored.includes(id));
}

/**
 * The stored form of a collapsed set: known ids only, in
 * {@link SETTINGS_SECTION_IDS} order. What {@link writeSettingsCollapsedSections}
 * puts on the wire and what {@link parseSettingsCollapsedSections} reads back.
 */
export function normalizeSettingsCollapsedSections(
  collapsed: readonly string[],
): SettingsSectionId[] {
  return SETTINGS_SECTION_IDS.filter((id) => collapsed.includes(id));
}

/**
 * Persist the collapsed set: optimistic local-cache write (so
 * `useTugbankValue` readers re-render instantly) plus the HTTP PUT. A failed
 * PUT logs and otherwise vanishes — the cache holds for the session.
 */
export function writeSettingsCollapsedSections(
  collapsed: readonly string[],
): void {
  const value = normalizeSettingsCollapsedSections(collapsed);
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(SETTINGS_SECTIONS_DOMAIN, SETTINGS_COLLAPSED_KEY, {
      kind: "json",
      value,
    });
  }
  fetch(`/api/defaults/${SETTINGS_SECTIONS_DOMAIN}/${SETTINGS_COLLAPSED_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value }),
  }).catch((err) => {
    console.warn("[settings-sections-pref] PUT failed:", err);
  });
}

/** The persisted collapsed set plus its setter — the accordion's state. */
export function useSettingsCollapsedSections(): {
  collapsed: readonly SettingsSectionId[];
  setCollapsed: (next: readonly string[]) => void;
} {
  const stored = useTugbankValue<readonly SettingsSectionId[] | null>(
    SETTINGS_SECTIONS_DOMAIN,
    SETTINGS_COLLAPSED_KEY,
    parseSettingsCollapsedSections,
    null,
  );
  const setCollapsed = useCallback((next: readonly string[]) => {
    writeSettingsCollapsedSections(next);
  }, []);
  return { collapsed: stored ?? DEFAULT_SETTINGS_COLLAPSED, setCollapsed };
}
