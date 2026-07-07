/**
 * use-unavailable-model-bulletin.ts — card-level bulletin when a saved model
 * selector is no longer offered by Claude's live catalog.
 *
 * A card seeded with a *concrete* selector (per-card persisted, else the deck
 * default — never the `default` zero-state) that is absent from the persisted
 * live catalog would otherwise fall back silently: `parsePersistedModel`
 * already drops unknown selectors, so the session just opens on the account
 * default with no explanation. This hook surfaces that breakage once per card
 * mount — it resets the card's persisted selector to `default` and presents a
 * pane-modal alert pointing the user at Settings → Assistant.
 *
 * The check runs against the **raw persisted** values, not the narrowed
 * parses: the whole point is to see the selector `parsePersistedModel` would
 * discard, and membership is tested against the *persisted* catalog only —
 * when no live catalog has ever been persisted (fresh install, only the
 * bootstrap seed exists) the check is skipped, so the seed list can never
 * produce a false "unavailable".
 *
 * Laws: [L07] the mount effect reads current state straight from the tugbank
 * cache, not a render closure; the alert rides the card's sheet host ([D15]).
 *
 * @module lib/use-unavailable-model-bulletin
 */

import { useEffect, useRef } from "react";

import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { presentAlertSheet } from "@/components/tugways/tug-alert-sheet";
import { dispatchAction } from "@/action-dispatch";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import type { TaggedValue } from "@/lib/tugbank-client";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  MODEL_CATALOG_DOMAIN,
  MODEL_CATALOG_KEY,
  parsePersistedCatalog,
} from "@/lib/model-catalog";
import {
  DEFAULT_MODEL_SELECTOR,
  MODEL_DEFAULT_DOMAIN,
  MODEL_DEFAULT_KEY,
  MODEL_DOMAIN,
} from "@/lib/model";
import { writePersistedModel } from "@/lib/use-model";

/**
 * The raw persisted selector string, with NO catalog narrowing — unlike
 * `parsePersistedModel`, an unknown selector comes through verbatim so the
 * bulletin can name it.
 */
function rawPersistedSelector(entry: TaggedValue | undefined): string | null {
  if (entry?.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return null;
}

/**
 * Whether the bulletin should fire: a persisted live catalog exists, the seed
 * is a concrete selector (not the `default` zero-state, not absent), and the
 * catalog no longer offers it. `catalog === null` means no live catalog was
 * ever persisted — the check is skipped rather than evaluated against the
 * bootstrap seed.
 */
export function shouldWarnUnavailableModel(
  seed: string | null,
  catalog: CapabilityModel[] | null,
): boolean {
  if (catalog === null) return false;
  if (seed === null || seed === DEFAULT_MODEL_SELECTOR) return false;
  return !catalog.some((m) => m.value === seed);
}

export interface UseUnavailableModelBulletinOptions {
  /** The card whose seed model is checked (and reset on a hit). */
  cardId: string;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

/**
 * Single-shot, at card mount: resolve the card's seed selector from the raw
 * persisted values (per-card wins over the deck default), and when it is a
 * concrete selector the persisted catalog no longer offers, reset the card to
 * `default` and present the bulletin. Confirming opens the Settings card.
 */
export function useUnavailableModelBulletin({
  cardId,
  showSheet,
}: UseUnavailableModelBulletinOptions): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const client = getTugbankClient();
    if (client === null) return;
    const catalog = parsePersistedCatalog(
      client.get(MODEL_CATALOG_DOMAIN, MODEL_CATALOG_KEY),
    );
    const seed =
      rawPersistedSelector(client.get(MODEL_DOMAIN, cardId)) ??
      rawPersistedSelector(client.get(MODEL_DEFAULT_DOMAIN, MODEL_DEFAULT_KEY));
    if (!shouldWarnUnavailableModel(seed, catalog)) return;

    writePersistedModel(cardId, DEFAULT_MODEL_SELECTOR);
    void presentAlertSheet(showSheet, {
      title: "Saved Model Unavailable",
      message: `The saved model "${seed}" is no longer available — this session is using Default. Review your Assistant defaults.`,
      confirmLabel: "Review Defaults",
      cancelLabel: "Not Now",
    }).then((confirmed) => {
      if (confirmed) {
        dispatchAction({ action: "show-card", component: "settings" });
      }
    });
  }, [cardId, showSheet]);
}
