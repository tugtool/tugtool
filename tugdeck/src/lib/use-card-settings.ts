/**
 * use-card-settings.ts — one card's view settings, for any card kind that
 * has them: read the resolved values, and write one back when the gear
 * changes it.
 *
 * The Text card's `use-text-card-settings.ts` is the original, and this is
 * that hook with the three card-kind-specific pieces (the two domains and
 * the parser) lifted into arguments. The contract it implements is the one
 * that hook's comment states, and it is worth restating because every card
 * kind now depends on it:
 *
 *   - Per-card values persist at `<domain>/<cardId>` and always win once
 *     present.
 *   - The deck-wide defaults at `<defaultsDomain>/<defaultsKey>` apply to any
 *     card with nothing of its own.
 *   - There is NO mount-time write. A card resolves `persisted ?? defaults ??
 *     built-in` live, so an untouched card follows the deck defaults (even if
 *     the user edits them in Settings while it is open) and leaves no per-card
 *     tugbank entry to accumulate. The FIRST gear change snapshots the full
 *     current settings into the card's own slot, and from then on the card
 *     owns them — "settings apply when the file is opened; once tuned, the
 *     card owns them."
 *
 * Pure tugbank state — no IPC, no session round-trip. Writing a setting is an
 * optimistic local-cache write plus a fire-and-forget PUT.
 *
 * Laws: [L02] both reads enter through `useTugbankValue`
 * (useSyncExternalStore); no localStorage — persistence is tugbank only.
 *
 * @module lib/use-card-settings
 */

import { useCallback, useMemo } from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { putCardSettings } from "@/settings-api";
import type { TaggedValue } from "@/lib/tugbank-client";

/** What a card kind must say about itself to have per-card settings. */
export interface CardSettingsSpec<T> {
  /** tugbank domain holding per-card values, keyed by card id. */
  domain: string;
  /** tugbank domain holding the deck-wide defaults. */
  defaultsDomain: string;
  /** Key under {@link CardSettingsSpec.defaultsDomain} for those defaults. */
  defaultsKey: string;
  /** Narrow an untrusted stored blob; `null` when there is no usable value. */
  parse: (entry: TaggedValue | undefined) => T | null;
  /** Per-card, then deck-wide, then built-in. */
  resolve: (persisted: T | null, defaults: T | null) => T;
}

/** Persist a card's settings: optimistic local-cache write plus an HTTP PUT. */
export function writePersistedCardSettings<T>(
  spec: CardSettingsSpec<T>,
  cardId: string,
  settings: T,
): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(spec.domain, cardId, { kind: "json", value: settings });
  }
  putCardSettings(spec.domain, cardId, settings);
}

export interface UseCardSettingsResult<T> {
  /** The resolved, card-local settings. */
  settings: T;
  /** Merge a partial change and persist it card-local. */
  setSetting: (partial: Partial<T>) => void;
}

export function useCardSettings<T extends object>(
  spec: CardSettingsSpec<T>,
  cardId: string,
): UseCardSettingsResult<T> {
  const persisted = useTugbankValue<T | null>(
    spec.domain,
    cardId,
    spec.parse,
    null,
  );

  const defaults = useTugbankValue<T | null>(
    spec.defaultsDomain,
    spec.defaultsKey,
    spec.parse,
    null,
  );

  const settings = useMemo(
    () => spec.resolve(persisted, defaults),
    [spec, persisted, defaults],
  );

  const setSetting = useCallback(
    (partial: Partial<T>) => {
      writePersistedCardSettings(spec, cardId, { ...settings, ...partial });
    },
    [spec, cardId, settings],
  );

  return { settings, setSetting };
}
