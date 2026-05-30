/**
 * Model-picker data — the static fallback model list and the pure resolver
 * that turns a metadata snapshot into the picker's option list + active value.
 *
 * Split out from the React picker so it is unit-testable without a DOM
 * (pure-logic `bun:test` only — no fake-DOM render tests).
 *
 * **Selectors vs resolved ids.** The picker rows are *selectors* the
 * `model_change` frame carries (`default` / `sonnet` / `haiku`), matching the
 * Claude Code terminal's `/model` picker. The live `system_metadata.model` is
 * a *resolved* model id (e.g. `claude-opus-4-8[1m]`) — these never
 * string-match, so the active row is mapped back to its selector by family
 * (see {@link resolvePickerModels}). The account default resolves to the
 * most-capable model (Opus), so there is no standalone Opus row — Default
 * *is* Opus, exactly as the terminal presents it.
 *
 * Resumed sessions carry no `initialize` model list (the handshake is
 * new-session-only), so when the live `models` list is empty the picker falls
 * back to `KNOWN_MODELS`.
 *
 * @module lib/model-picker-data
 */

import type { CapabilityModel } from "./session-metadata-store";

/**
 * Static fallback model list for sessions without an `initialize` list,
 * mirroring the terminal's `/model` picker: three selectors with the
 * resolved-model + tagline as the description.
 */
export const KNOWN_MODELS: CapabilityModel[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context · Most capable for complex work",
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "Sonnet 4.6 · Best for everyday tasks",
  },
  {
    value: "haiku",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];

export interface PickerModels {
  /** The options to render (live list when present, else the static union). */
  options: CapabilityModel[];
  /** The value of the row to mark active, or null when there are no options. */
  activeValue: string | null;
}

/**
 * Non-default families a resolved model id can be mapped back to a selector
 * row by. Order matters only in that each is checked independently; opus and
 * anything unrecognized fall through to the default row.
 */
const NON_DEFAULT_FAMILIES = ["haiku", "sonnet"] as const;

/**
 * Representative resolved model id each picker selector currently resolves to,
 * for the chip's optimistic update (the `model_change` frame carries the
 * selector, but the chip displays a resolved id via `formatModelLabel`). The
 * `default` selector resolves to the account default, currently Opus 4.8 1M.
 * Self-correcting if the real `system_metadata` later disagrees.
 */
const SELECTOR_TO_MODEL_ID: Record<string, string> = {
  default: "claude-opus-4-8[1m]",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

/**
 * Map a picker selector (`default` / `sonnet` / `haiku`) to a representative
 * resolved model id for the chip's optimistic display. An already-resolved id
 * (or an unknown selector) is returned unchanged.
 */
export function selectorToModelId(value: string): string {
  return SELECTOR_TO_MODEL_ID[value] ?? value;
}

/**
 * Resolve the picker's option list and active row from a metadata snapshot.
 *
 * Options: the live `initialize` capability list when non-empty, else
 * `KNOWN_MODELS`. The resolved model is never injected as an extra row.
 *
 * Active row: `system_metadata.model` is a resolved id (`claude-sonnet-4-6`,
 * `claude-opus-4-8[1m]`, …) while the options are selectors, so it is mapped
 * by family — a sonnet/haiku resolved id selects that row; opus, an
 * unrecognized id, or no model at all selects the first (account-default) row.
 * This mirrors the terminal, which checkmarks "Default" while naming the
 * resolved Opus model in its description.
 */
export function resolvePickerModels(
  models: CapabilityModel[],
  activeModel: string | null,
): PickerModels {
  const options = models.length > 0 ? models : KNOWN_MODELS;
  if (options.length === 0) return { options, activeValue: null };

  if (activeModel !== null) {
    const lower = activeModel.toLowerCase();
    for (const family of NON_DEFAULT_FAMILIES) {
      if (!lower.includes(family)) continue;
      const hit = options.find(
        (m) =>
          m.value.toLowerCase().includes(family) ||
          m.displayName.toLowerCase().includes(family),
      );
      if (hit) return { options, activeValue: hit.value };
    }
  }

  // No model yet, or an opus / default / unrecognized resolved id → the first
  // option, which is the account default by convention.
  return { options, activeValue: options[0].value };
}
