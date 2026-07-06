/**
 * use-model.ts — the dev-card's model set path plus its per-card persistence
 * and mount-restore, factored out of the model picker (mirroring
 * [use-permission-mode.ts] / [use-effort.ts]).
 *
 * The chip ([model-chip.tsx]) only *displays* the model; the behavior — sending
 * the IPC, persisting per card, and restoring on relaunch — lives here so the
 * picker and a future `/model` command both funnel through one `setModel`.
 *
 * Mutations round-trip per [D03]: `setModel` sends a `model_change` frame (via
 * `CodeSessionStore.setModel`) and the chip reflects the resolved model from the
 * post-mutation `system_metadata` (owned by `SessionMetadataStore`); the
 * optimistic `applyModel` bridges the gap since claude answers with a
 * `control_response`, not a fresh `system_metadata`.
 *
 * **Seed readiness differs from permission mode.** Model is NOT carried on the
 * `spawn_session` frame (unlike permission mode's `--permission-mode`), so the
 * session always spawns on the account default and the seed must drive both a
 * NEW card (capabilities landed, still on the account default) AND a RESUMED
 * card (its `system_metadata` model has replayed). The restore therefore gates
 * on "the session's current model is knowable" — either the live capability
 * `models[]` (a new session is up, running the account `default` selector) or a
 * resolved `model` id (a resume replayed) — then re-applies the seed only when
 * it differs from the session's current selector, so an unchanged model never
 * triggers a needless `model_change`.
 *
 * Persistence mirrors `use-permission-mode.ts`: an optimistic `setLocalValue`
 * so `useTugbankValue` readers reflect instantly, plus a PUT to
 * `/api/defaults/dev.model/<cardId>` ([D07], `feedback_no_localstorage`).
 *
 * Laws: [L02] store subscription, [L07] handler reads current state through
 *       the store (no stale render closure)
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { resolvePickerModels, selectorToModelId } from "@/lib/model-picker-data";
import {
  MODEL_DEFAULT_DOMAIN,
  MODEL_DEFAULT_KEY,
  MODEL_DOMAIN,
  parsePersistedModel,
  resolveSeedModel,
} from "@/lib/model";

/**
 * Persist a card's model selector: optimistic local-cache write (so
 * `useTugbankValue` readers re-render instantly) plus an HTTP PUT to the
 * defaults endpoint. PUT failure logs and otherwise vanishes — the cache holds
 * for the session and a fresh load falls back to the default.
 */
export function writePersistedModel(cardId: string, selector: string): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(MODEL_DOMAIN, cardId, {
      kind: "string",
      value: selector,
    });
  }
  const url = `/api/defaults/${MODEL_DOMAIN}/${encodeURIComponent(cardId)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: selector }),
  }).catch((err) => {
    console.warn(`[model] PUT failed for card ${cardId}:`, err);
  });
}

export interface UseModelOptions {
  /** The card whose model is set / persisted / restored. */
  cardId: string;
  /** Store that sends the `model_change` frame. */
  codeSessionStore: CodeSessionStore;
  /** Store supplying the live model + capability list the restore aligns to. */
  sessionMetadataStore: SessionMetadataStore;
}

export interface UseModelResult {
  /** Set the model to an explicit selector (the picker / `/model` path). */
  setModel: (selector: string) => void;
}

export function useModel({
  cardId,
  codeSessionStore,
  sessionMetadataStore,
}: UseModelOptions): UseModelResult {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  const persistedModel = useTugbankValue<string | null>(
    MODEL_DOMAIN,
    cardId,
    parsePersistedModel,
    null,
  );

  // The deck-wide default a card with nothing persisted of its own adopts on
  // mount (set from the Settings card). Per-card persistence always wins, so
  // this only seeds genuinely fresh cards. Mirrors `use-permission-mode.ts`.
  const defaultModel = useTugbankValue<string | null>(
    MODEL_DEFAULT_DOMAIN,
    MODEL_DEFAULT_KEY,
    parsePersistedModel,
    null,
  );

  // Pre-armed by a manual `setModel` so the mount-restore effect below never
  // overrides a change the user just made.
  const sentRef = useRef(false);

  // Set the model to an explicit selector: reflect it optimistically on the
  // chip (claude answers with a control_response, not a fresh system_metadata),
  // persist it per card, and send the `model_change` frame. The single path the
  // picker and the mount-restore both funnel through.
  const setModel = useCallback(
    (selector: string) => {
      sentRef.current = true;
      sessionMetadataStore.applyModel(selectorToModelId(selector));
      writePersistedModel(cardId, selector);
      codeSessionStore.setModel(selector);
    },
    [cardId, codeSessionStore, sessionMetadataStore],
  );

  // Mount-restore + fresh-seed ([D07]). Once the session's current model is
  // knowable — the live capability list is up (a new session, on the account
  // `default` selector) OR a resolved model id has replayed (a resume) — align
  // it to the seed (per-card selector if any, else the deck-wide default) when
  // the seed differs from the session's current selector. Fires at most once per
  // mount (`sentRef`); a manual change pre-arms it.
  const seedModel = resolveSeedModel(persistedModel, defaultModel);
  const { models, model } = snapshot;
  useEffect(() => {
    if (sentRef.current) return;
    if (seedModel === null) return;
    // Readiness: nothing known yet (no capabilities AND no resolved model) →
    // can't tell the current model, don't race the spawn.
    if (models.length === 0 && model === null) return;
    // The session's current selector: the resolved model mapped back to its
    // family selector, or `default` (the account default a fresh session spawns
    // on) when no model id has landed yet.
    const currentSelector =
      model !== null ? resolvePickerModels(models, model).activeValue : "default";
    if (seedModel !== currentSelector) {
      setModel(seedModel);
    } else {
      sentRef.current = true;
    }
  }, [seedModel, models, model, setModel]);

  return { setModel };
}
