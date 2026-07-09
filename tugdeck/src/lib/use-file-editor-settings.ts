/**
 * use-file-editor-settings.ts — one File card's editor settings: read
 * the card-local values (seeded from the deck-wide defaults on first
 * open), and write them back when the gear popup changes one.
 *
 * Default-then-card-local, mirroring `use-model.ts`:
 *
 *   - Per-card values persist at `dev.file-editor/<cardId>` and always
 *     win once present.
 *   - The deck-wide defaults at `dev.tugtool.file-editor/settings` seed
 *     a card with nothing of its own. On first mount a fresh card pins
 *     the resolved defaults into its per-card slot, so a later change to
 *     the deck defaults never disturbs an already-open card ("settings
 *     apply when the file is opened; from then on the card owns them").
 *
 * Both surfaces are pure tugbank state — no IPC, no session round-trip
 * (unlike model). Writing a setting is an optimistic local-cache write
 * plus a fire-and-forget PUT.
 *
 * Laws: [L02] both reads enter through `useTugbankValue`
 * (useSyncExternalStore); [L07] the seed effect reads current state at
 * fire time; no localStorage — persistence is tugbank only.
 *
 * @module lib/use-file-editor-settings
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { putFileEditorCardSettings } from "@/settings-api";
import {
  FILE_EDITOR_DOMAIN,
  FILE_EDITOR_DEFAULTS_DOMAIN,
  FILE_EDITOR_DEFAULTS_KEY,
  parseFileEditorDefaults,
  parseFileEditorSettings,
  resolveFileEditorSettings,
  type FileEditorSettings,
} from "./file-editor-settings";

/**
 * Persist a card's editor settings: optimistic local-cache write (so
 * `useTugbankValue` readers re-render instantly) plus an HTTP PUT.
 */
export function writePersistedFileEditorSettings(
  cardId: string,
  settings: FileEditorSettings,
): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(FILE_EDITOR_DOMAIN, cardId, {
      kind: "json",
      value: settings,
    });
  }
  putFileEditorCardSettings(cardId, settings);
}

export interface UseFileEditorSettingsResult {
  /** The resolved, card-local editor settings. */
  settings: FileEditorSettings;
  /** Merge a partial change and persist it card-local. */
  setSetting: (partial: Partial<FileEditorSettings>) => void;
}

export function useFileEditorSettings(
  cardId: string,
): UseFileEditorSettingsResult {
  const persisted = useTugbankValue<FileEditorSettings | null>(
    FILE_EDITOR_DOMAIN,
    cardId,
    parseFileEditorSettings,
    null,
  );

  const defaults = useTugbankValue(
    FILE_EDITOR_DEFAULTS_DOMAIN,
    FILE_EDITOR_DEFAULTS_KEY,
    parseFileEditorDefaults,
    null,
  );

  const settings = useMemo(
    () => resolveFileEditorSettings(persisted, defaults),
    [persisted, defaults],
  );

  // Pre-armed by a manual `setSetting` so the seed effect never clobbers
  // a change the user just made.
  const sentRef = useRef(false);

  const setSetting = useCallback(
    (partial: Partial<FileEditorSettings>) => {
      sentRef.current = true;
      const next = { ...settings, ...partial };
      writePersistedFileEditorSettings(cardId, next);
    },
    [cardId, settings],
  );

  // First-open seed: a card with nothing persisted pins the resolved
  // defaults into its per-card slot, freezing it against later changes
  // to the deck defaults. Fires at most once per mount.
  useEffect(() => {
    if (sentRef.current) return;
    if (persisted !== null) {
      sentRef.current = true;
      return;
    }
    sentRef.current = true;
    writePersistedFileEditorSettings(cardId, settings);
  }, [cardId, persisted, settings]);

  return { settings, setSetting };
}
